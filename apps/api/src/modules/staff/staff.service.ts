import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { createHash, randomBytes } from 'node:crypto';
import { sql, type Tx } from '@dental/db';
import { APP_CONFIG, AUTH_POLICY, type AppConfig } from '../../config';
import type { RequestContext } from '../../shared/context/request-context';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { maskEmail } from '../../shared/mask';
import { EMAIL_SENDER, type EmailSender } from '../../shared/notifications/ports';
import { PlanLimits } from '../../shared/plans/plan-limits.service';
import type { InviteInput, UpdateMemberInput } from './staff.schemas';
import { StaffRepository, type InvitationView, type MemberView } from './staff.repository';

/** Invitation links carry 32 random bytes; only their SHA-256 is stored. */
export const newInvitationToken = () => randomBytes(32).toString('base64url');
export const hashInvitationToken = (token: string) => createHash('sha256').update(token).digest('hex');

const memberNotFound = () => Err.notFound('member_not_found', 'Member not found');

/**
 * Clinic members and invitations, for the owner (SRS ACCESS-001, ACCESS-002; permission `staff:manage`). Every change
 * is audited by the database; a role, status or branch change bumps the member's access version, so it applies on
 * their next request (ACCESS-005).
 */
@Injectable()
export class StaffService {
  private readonly logger = new Logger('Staff');

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly db: TenantDb,
    private readonly repo: StaffRepository,
    private readonly plan: PlanLimits,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  members(): Promise<MemberView[]> { return this.db.run((tx) => this.repo.listMembers(tx)); }
  roles() { return this.db.run((tx) => this.repo.roles(tx)); }
  invitations(): Promise<InvitationView[]> { return this.db.run((tx) => this.repo.listInvitations(tx)); }

  member(id: string): Promise<MemberView> {
    return this.db.run(async (tx) => {
      const m = await this.repo.getMember(tx, id);
      if (!m) throw memberNotFound();
      return m;
    });
  }

  async invite(input: InviteInput): Promise<InvitationView> {
    const token = newInvitationToken();
    const { view, clinic } = await this.db.run(async (tx, tenantId) => {
      const role = await this.repo.role(tx, input.roleId);
      if (!role) throw Err.badRequest('role_not_found', 'Role not found');
      const branchIds = input.allBranches ? [] : input.branchIds;
      if (!(await this.repo.branchesExist(tx, branchIds))) throw Err.badRequest('branch_not_found', 'Branch not found');
      if (input.doctorId) {
        const d = await this.repo.doctor(tx, input.doctorId);
        if (!d) throw Err.badRequest('doctor_not_found', 'Doctor not found');
        if (d.member_id) throw Err.conflict('doctor_already_linked', 'This doctor already has a login');
      }
      if (await this.repo.memberByEmail(tx, input.email)) throw Err.conflict('already_member', 'This person is already a member of the clinic');
      await this.repo.revokeExpired(tx, input.email);
      await this.plan.assertCanAdd(tx, tenantId, 'staff', () => this.repo.staffUsed(tx));
      const { id } = await this.repo.insertInvitation(tx, {
        tenantId, email: input.email, roleId: input.roleId, branchIds, jobTitle: input.jobTitle ?? null, doctorId: input.doctorId ?? null,
        tokenHash: hashInvitationToken(token), invitedBy: this.memberId(), ttlDays: AUTH_POLICY.invitationTtlDays,
      });
      return { view: (await this.repo.getInvitation(tx, id))!, clinic: await this.clinicName(tx) };
    });
    await this.sendInvitation(view.email, token, clinic); // after commit: a rolled-back invitation sends nothing
    return view;
  }

  /** A new link for an open invitation (the previous one stops working) and a fresh 7 days. */
  async resend(id: string): Promise<InvitationView> {
    const token = newInvitationToken();
    const { view, clinic } = await this.db.run(async (tx) => {
      if (!(await this.repo.renewInvitation(tx, id, hashInvitationToken(token), AUTH_POLICY.invitationTtlDays))) {
        throw Err.notFound('invitation_not_found', 'Invitation not found or already used');
      }
      return { view: (await this.repo.getInvitation(tx, id))!, clinic: await this.clinicName(tx) };
    });
    await this.sendInvitation(view.email, token, clinic);
    return view;
  }

  revoke(id: string): Promise<void> {
    return this.db.run(async (tx) => {
      if (!(await this.repo.revokeInvitation(tx, id))) throw Err.notFound('invitation_not_found', 'Invitation not found or already used');
    });
  }

  updateMember(id: string, input: UpdateMemberInput): Promise<MemberView> {
    return this.db.run(async (tx, tenantId) => {
      const m = await this.repo.lockMember(tx, id);
      if (!m) throw memberNotFound();
      let roleKey = m.role_key;
      if (input.roleId && input.roleId !== m.role_id) {
        const role = await this.repo.role(tx, input.roleId);
        if (!role) throw Err.badRequest('role_not_found', 'Role not found');
        roleKey = role.key;
      }
      // the clinic keeps at least one active owner (the database refuses it too)
      const stopsBeingOwner = m.role_key === 'owner' && m.status === 'active' && (input.status === 'disabled' || roleKey !== 'owner');
      if (stopsBeingOwner && (await this.repo.otherActiveOwners(tx, id)) === 0) {
        throw Err.conflict('last_owner', 'The clinic must keep at least one active owner');
      }
      if (input.status === 'active' && m.status === 'disabled') {
        await this.plan.assertCanAdd(tx, tenantId, 'staff', () => this.repo.staffUsed(tx));
      }
      if (input.branchIds && !(await this.repo.branchesExist(tx, input.branchIds))) throw Err.badRequest('branch_not_found', 'Branch not found');

      await this.repo.updateMember(tx, id, {
        ...(input.roleId !== undefined && { role_id: input.roleId }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.allBranches !== undefined && { all_branches: input.allBranches }),
        ...(input.jobTitle !== undefined && { job_title: input.jobTitle }),
      });
      if (input.allBranches === true) await this.repo.replaceBranches(tx, tenantId, id, []);
      else if (input.branchIds) await this.repo.replaceBranches(tx, tenantId, id, input.branchIds);
      return (await this.repo.getMember(tx, id))!;
    });
  }

  private memberId(): string {
    const id = this.cls.get('memberId');
    if (!id) throw Err.forbidden('no_clinic', 'No clinic selected for this request');
    return id;
  }

  private async clinicName(tx: Tx): Promise<string> {
    const { rows } = await sql<{ name: string }>`select coalesce(name_ar, name_en, slug::text) as name from tenants`.execute(tx);
    return rows[0]?.name ?? '';
  }

  /** The link email. Never fails the request: the owner can resend from the staff screen. */
  private async sendInvitation(to: string, token: string, clinic: string): Promise<void> {
    const link = `${this.cfg.DASHBOARD_URL}/#/invite/${token}`;
    try {
      await this.email.send(to, `دعوة للانضمام إلى ${clinic}`,
        `تمت دعوتك للانضمام إلى فريق ${clinic}.\n\nافتح الرابط التالي لقبول الدعوة (صالح لمدة ${AUTH_POLICY.invitationTtlDays} أيام):\n${link}\n\nإذا لم تكن تتوقع هذه الدعوة فتجاهل الرسالة.`);
    } catch (err) {
      this.logger.error(`Invitation email to ${maskEmail(to)} failed: ${(err as Error).message}`);
    }
  }
}
