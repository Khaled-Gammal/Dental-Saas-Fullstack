import { Injectable } from '@nestjs/common';
import { Accounts } from '../identity/accounts.service';
import type { RequestMeta, Session } from '../identity/identity.types';
import { SessionService } from '../identity/session.service';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import type { AcceptInput } from './staff.schemas';
import { hashInvitationToken } from './staff.service';
import { StaffRepository } from './staff.repository';

/** Wrong, used, revoked or expired: one answer, so a link reveals nothing about other invitations. */
const invalid = () => Err.notFound('invitation_invalid', 'This invitation link is not valid any more. Ask the clinic for a new one.');

/**
 * The invitee's side of SRS ACCESS-001: open the emailed link, then join with a new account (name + password; the link
 * proves the email) or an existing one (its password). Joining is one transaction: the link is used up, the member and
 * their branches are created, and the doctor record is linked.
 */
@Injectable()
export class InvitationAcceptance {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: StaffRepository,
    private readonly accounts: Accounts,
    private readonly sessions: SessionService,
  ) {}

  async preview(token: string) {
    const inv = await this.repo.openInvitation(this.db.platform(), hashInvitationToken(token));
    if (!inv) throw invalid();
    return {
      clinic: { slug: inv.clinic_slug, nameAr: inv.clinic_name_ar, nameEn: inv.clinic_name_en },
      role: { key: inv.role_key, nameAr: inv.role_name_ar },
      email: inv.email, jobTitle: inv.job_title, expiresAt: inv.expires_at,
      allBranches: inv.branch_ids.length === 0,
      accountExists: await this.accounts.exists(inv.email),
    };
  }

  async accept(token: string, input: AcceptInput, meta: RequestMeta): Promise<Session> {
    const inv = await this.repo.openInvitation(this.db.platform(), hashInvitationToken(token));
    if (!inv) throw invalid();
    const existing = await this.accounts.exists(inv.email);
    // an existing login proves itself with its password (outside the transaction: scrypt is slow, and a wrong
    // password must not use up the link)
    let userId = existing ? (await this.accounts.checkPassword(inv.email, input.password)).id : null;
    if (!existing && !input.fullName) throw Err.badRequest('full_name_required', 'Enter your name');

    await this.db.runAs(inv.tenant_id, async (tx) => {
      if (!(await this.repo.claimInvitation(tx, inv.invitation_id))) throw invalid(); // single use, even under a double click
      if (userId) {
        if (await this.repo.memberOfUser(tx, userId)) throw Err.conflict('already_member', 'You are already a member of this clinic');
      } else {
        userId = await this.accounts.createVerifiedUser(tx, { email: inv.email, fullName: input.fullName!, password: input.password });
      }
      await this.db.actAs(tx, userId); // the audit trail shows the invitee joining
      const { id: memberId } = await this.repo.insertMember(tx, {
        tenantId: inv.tenant_id, userId, roleId: inv.role_id, allBranches: inv.branch_ids.length === 0, jobTitle: inv.job_title,
      });
      if (inv.branch_ids.length) await this.repo.replaceBranches(tx, inv.tenant_id, memberId, inv.branch_ids);
      if (inv.doctor_id) await this.repo.linkDoctor(tx, inv.doctor_id, memberId);
    });
    return this.sessions.start(userId!, inv.clinic_slug, meta);
  }
}
