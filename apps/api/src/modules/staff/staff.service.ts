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
import { PERMISSION_GROUPS, REQUIRES, type Permission } from '../../auth/permission-catalogue';
import { hasPermission } from '../../auth/permissions';
import { added, checkRolePermissions, mixesClinicalAndMoney, notHeld } from './role-rules';
import type { EditRoleInput, InviteInput, NewRoleInput, UpdateMemberInput } from './staff.schemas';
import { StaffRepository, type InvitationView, type MemberView, type RoleView } from './staff.repository';

/** Invitation links carry 32 random bytes; only their SHA-256 is stored. */
export const newInvitationToken = () => randomBytes(32).toString('base64url');
export const hashInvitationToken = (token: string) => createHash('sha256').update(token).digest('hex');

const memberNotFound = () => Err.notFound('member_not_found', 'Member not found');
const roleNotFound = () => Err.notFound('role_not_found', 'Role not found');
const notHeldError = (permission: string) =>
  Err.forbidden('permission_not_held', 'You can give only permissions you hold yourself', { permission });

/**
 * Clinic members, invitations and roles (SRS ACCESS-001, ACCESS-002, H4; permission `staff:manage`). Every change is
 * audited by the database; a role, status or branch change — or an edit of a role's permissions — bumps the members'
 * access version, so it applies on their next request (ACCESS-005).
 *
 * Owner 2026-10-20: staff:manage may be given to a custom role. So that nobody raises their own rights, a member who
 * is not the owner ('*') gives only permissions they hold, never changes their own role or status nor edits the role
 * they hold, and never gives or takes the owner role. The built-in roles stay as B.1 sets them.
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
  invitations(): Promise<InvitationView[]> { return this.db.run((tx) => this.repo.listInvitations(tx)); }

  // ---------- roles (H4) ----------
  private perms() { return this.cls.get('permissions'); }
  private isOwner() { return hasPermission(this.perms(), '*'); }

  /** The permission catalogue: groups in screen order, what each permission needs, and the separation-rule kinds. */
  permissions() {
    return PERMISSION_GROUPS.map((g) => ({ key: g.key, permissions: g.permissions.map((p) => ({ key: p, requires: REQUIRES[p as Permission] ?? [] })) }));
  }

  /** Every role, with `can.edit` for the caller and the separation-rule warning. */
  roles() {
    return this.db.run(async (tx) => {
      const mine = await this.repo.memberRoleId(tx, this.memberId());
      return (await this.repo.roles(tx)).map((r) => this.roleView(r, mine));
    });
  }

  createRole(input: NewRoleInput) {
    return this.db.run(async (tx, tenantId) => {
      this.assertGrantable(input.permissions, []);
      const { id } = await this.repo.insertRole(tx, { tenantId, key: `custom-${randomBytes(6).toString('hex')}`, nameAr: input.nameAr, permissions: input.permissions });
      return this.oneRole(tx, id);
    });
  }

  updateRole(id: string, input: EditRoleInput) {
    return this.db.run(async (tx) => {
      const r = await this.editableRole(tx, id);
      if (input.permissions) this.assertGrantable(input.permissions, r.permissions);
      await this.repo.updateRole(tx, id, input);
      return this.oneRole(tx, id);
    });
  }

  /** Deleted when nobody ever held it; archived (kept, given to nobody new) when only past members or invitations refer to it. */
  removeRole(id: string): Promise<{ archived: boolean }> {
    return this.db.run(async (tx) => {
      await this.editableRole(tx, id);
      const u = await this.repo.roleUsage(tx, id);
      if (u.active || u.open) throw Err.conflict('role_in_use', 'Members or open invitations still have this role', { members: u.active, invitations: u.open });
      if (u.members || u.invitations) {
        await this.repo.archiveRole(tx, id);
        return { archived: true };
      }
      await this.repo.deleteRole(tx, id);
      return { archived: false };
    });
  }

  /** A custom role in use, and not the caller's own (unless they are the owner). */
  private async editableRole(tx: Tx, id: string) {
    const r = await this.repo.lockRole(tx, id);
    if (!r) throw roleNotFound();
    if (r.is_system) throw Err.conflict('role_builtin', 'Built-in roles keep their permissions; create a role instead');
    if (r.archived_at) throw Err.conflict('role_archived', 'This role is archived');
    if (!this.isOwner() && r.id === (await this.repo.memberRoleId(tx, this.memberId()))) {
      throw Err.forbidden('own_role', 'You cannot change your own role');
    }
    return r;
  }

  private assertGrantable(perms: readonly string[], before: readonly string[]) {
    const problem = checkRolePermissions(perms);
    if (problem?.error === 'permission_unknown') throw Err.badRequest('permission_unknown', 'This permission cannot be given to a role', { permission: problem.permission });
    if (problem) throw Err.badRequest('permission_requires', 'A permission needs another one', { permission: problem.permission, requires: problem.requires });
    const missing = notHeld(this.perms(), added(before, perms));
    if (missing) throw notHeldError(missing);
  }

  /** Who may give a role to a member: the owner role only by an owner; any other only if its permissions are the giver's too. */
  private assertAssignable(role: { key: string; is_system: boolean; permissions: string[]; archived_at: Date | null }) {
    if (role.archived_at) throw Err.conflict('role_archived', 'This role is archived');
    if (this.isOwner()) return;
    if (role.is_system && role.key === 'owner') throw Err.forbidden('owner_role_only', 'Only an owner gives or takes the owner role');
    const missing = notHeld(this.perms(), role.permissions);
    if (missing) throw notHeldError(missing);
  }

  private async oneRole(tx: Tx, id: string) {
    const r = (await this.repo.roles(tx)).find((x) => x.id === id);
    if (!r) throw roleNotFound();
    return this.roleView(r, await this.repo.memberRoleId(tx, this.memberId()));
  }

  private roleView(r: RoleView, myRoleId: string | null) {
    const editable = !r.is_system && !r.archived_at && (this.isOwner() || r.id !== myRoleId);
    return { ...r, mixes_clinical_and_money: mixesClinicalAndMoney(r.permissions), can: { edit: editable, remove: editable } };
  }

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
      this.assertAssignable(role);
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
      if (!this.isOwner()) {
        // a manager who is not the owner: never their own access, never an owner's
        if (id === this.memberId() && (input.roleId !== undefined || input.status !== undefined)) throw Err.forbidden('own_role', 'You cannot change your own role');
        if (m.role_key === 'owner') throw Err.forbidden('owner_role_only', 'Only an owner gives or takes the owner role');
      }
      let roleKey = m.role_key;
      if (input.roleId && input.roleId !== m.role_id) {
        const role = await this.repo.role(tx, input.roleId);
        if (!role) throw Err.badRequest('role_not_found', 'Role not found');
        this.assertAssignable(role);
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
