import { Injectable } from '@nestjs/common';
import { sql, type Db, type Tx } from '@dental/db';

export interface MemberView {
  id: string; status: 'active' | 'disabled'; all_branches: boolean; branch_ids: string[]; job_title: string | null; joined_at: Date;
  role: { id: string; key: string; name_ar: string; name_en: string };
  user: { full_name: string; email: string | null; phone: string | null };
  doctor: { id: string; name_ar: string | null; name_en: string | null } | null;
}

export interface InvitationView {
  id: string; email: string; branch_ids: string[]; job_title: string | null; expires_at: Date; created_at: Date; expired: boolean;
  role: { id: string; key: string; name_ar: string; name_en: string };
  doctor: { id: string; name_ar: string | null; name_en: string | null } | null;
  invited_by: string | null;
}

/** What an invitation link opens (open_invitation(), before the invitee has a session). */
export interface OpenInvitation {
  invitation_id: string; tenant_id: string; email: string; role_id: string; role_key: string; role_name_ar: string;
  branch_ids: string[]; job_title: string | null; doctor_id: string | null; expires_at: Date;
  clinic_slug: string; clinic_name_ar: string | null; clinic_name_en: string | null;
}

export interface RoleView {
  id: string; key: string; name_ar: string; name_en: string; is_system: boolean; permissions: string[]; archived_at: Date | null;
  created_at: Date; updated_at: Date; members: number; invitations: number;
}

const roleJson = sql<MemberView['role']>`json_build_object('id', r.id, 'key', r.key, 'name_ar', r.name_ar, 'name_en', r.name_en)`;

/** All SQL for clinic members and invitations (SRS 8.2 `tenancy`: tenant_members, member_branches, invitations). */
@Injectable()
export class StaffRepository {
  private members(tx: Tx) {
    return tx.selectFrom('tenant_members as m')
      .innerJoin('roles as r', 'r.id', 'm.role_id')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .leftJoin('doctors as d', 'd.member_id', 'm.id')
      .select([
        'm.id', 'm.status', 'm.all_branches', 'm.job_title', 'm.joined_at', roleJson.as('role'),
        sql<MemberView['user']>`json_build_object('full_name', u.full_name, 'email', u.email, 'phone', u.phone)`.as('user'),
        sql<MemberView['doctor']>`case when d.id is null then null else json_build_object('id', d.id, 'name_ar', d.name_ar, 'name_en', d.name_en) end`.as('doctor'),
        sql<string[]>`coalesce((select array_agg(mb.branch_id) from member_branches mb where mb.member_id = m.id), '{}')`.as('branch_ids'),
      ]);
  }

  async listMembers(tx: Tx): Promise<MemberView[]> {
    return (await this.members(tx).orderBy('m.status').orderBy('u.full_name').execute()) as MemberView[];
  }

  async getMember(tx: Tx, id: string): Promise<MemberView | undefined> {
    return (await this.members(tx).where('m.id', '=', id).executeTakeFirst()) as MemberView | undefined;
  }

  /** The member row, locked for an update (role/status/branches). */
  lockMember(tx: Tx, id: string) {
    return tx.selectFrom('tenant_members as m').innerJoin('roles as r', 'r.id', 'm.role_id')
      .select(['m.id', 'm.status', 'm.role_id', 'r.key as role_key']).where('m.id', '=', id).forUpdate('m').executeTakeFirst();
  }

  async otherActiveOwners(tx: Tx, memberId: string): Promise<number> {
    const r = await tx.selectFrom('tenant_members as m').innerJoin('roles as r', 'r.id', 'm.role_id')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('r.key', '=', 'owner').where('m.status', '=', 'active').where('m.id', '<>', memberId).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async updateMember(tx: Tx, id: string, p: { role_id?: string; status?: 'active' | 'disabled'; all_branches?: boolean; job_title?: string | null }) {
    if (Object.keys(p).length) await tx.updateTable('tenant_members').set(p).where('id', '=', id).execute();
  }

  /** Makes the member's branch list exactly `branchIds` (only the differences are written, so the audit shows them). */
  async replaceBranches(tx: Tx, tenantId: string, memberId: string, branchIds: string[]): Promise<void> {
    let drop = tx.deleteFrom('member_branches').where('member_id', '=', memberId);
    if (branchIds.length) drop = drop.where('branch_id', 'not in', branchIds);
    await drop.execute();
    if (branchIds.length) {
      await tx.insertInto('member_branches').values(branchIds.map((branch_id) => ({ tenant_id: tenantId, member_id: memberId, branch_id })))
        .onConflict((oc) => oc.columns(['member_id', 'branch_id']).doNothing()).execute();
    }
  }

  /** Every role with its permissions and how many hold it (active members, open invitations). Built-in first, in B.1 order. */
  roles(tx: Tx): Promise<RoleView[]> {
    return tx.selectFrom('roles as r')
      .select([
        'r.id', 'r.key', 'r.name_ar', 'r.name_en', 'r.is_system', 'r.permissions', 'r.archived_at', 'r.created_at', 'r.updated_at',
        sql<number>`(select count(*)::int from tenant_members m where m.role_id = r.id and m.status = 'active')`.as('members'),
        sql<number>`(select count(*)::int from invitations i where i.role_id = r.id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())`.as('invitations'),
      ])
      .orderBy(sql`array_position(array['owner','doctor','receptionist','assistant','accountant'], r.key::text)`)
      .orderBy('r.name_ar').execute();
  }

  role(tx: Tx, id: string) {
    return tx.selectFrom('roles').select(['id', 'key', 'is_system', 'permissions', 'archived_at']).where('id', '=', id).executeTakeFirst();
  }

  async memberRoleId(tx: Tx, memberId: string): Promise<string | null> {
    return (await tx.selectFrom('tenant_members').select('role_id').where('id', '=', memberId).executeTakeFirst())?.role_id ?? null;
  }

  /** The role row, locked for an edit or removal. */
  lockRole(tx: Tx, id: string) {
    return tx.selectFrom('roles').select(['id', 'key', 'is_system', 'permissions', 'archived_at']).where('id', '=', id).forUpdate().executeTakeFirst();
  }

  insertRole(tx: Tx, r: { tenantId: string; key: string; nameAr: string; permissions: string[] }) {
    // name_en is required by the v3 schema; the product is Arabic only, so it carries the same name (CLR-07)
    return tx.insertInto('roles').values({ tenant_id: r.tenantId, key: r.key, name_ar: r.nameAr, name_en: r.nameAr, permissions: r.permissions })
      .returning('id').executeTakeFirstOrThrow();
  }

  updateRole(tx: Tx, id: string, p: { nameAr?: string; permissions?: string[] }) {
    return tx.updateTable('roles')
      .set({ ...(p.nameAr !== undefined && { name_ar: p.nameAr, name_en: p.nameAr }), ...(p.permissions !== undefined && { permissions: p.permissions }) })
      .where('id', '=', id).execute();
  }

  /** Who refers to the role: members (any status) and invitations (any state); a role nobody ever held is deleted. */
  async roleUsage(tx: Tx, id: string) {
    const { rows } = await sql<{ active: number; members: number; open: number; invitations: number }>`
      select (select count(*)::int from tenant_members where role_id = ${id} and status = 'active') as active,
             (select count(*)::int from tenant_members where role_id = ${id}) as members,
             (select count(*)::int from invitations where role_id = ${id} and accepted_at is null and revoked_at is null and expires_at > now()) as open,
             (select count(*)::int from invitations where role_id = ${id}) as invitations`.execute(tx);
    return rows[0]!;
  }

  deleteRole(tx: Tx, id: string) {
    return tx.deleteFrom('roles').where('id', '=', id).execute();
  }

  archiveRole(tx: Tx, id: string) {
    return tx.updateTable('roles').set({ archived_at: sql<Date>`now()` }).where('id', '=', id).execute();
  }

  async branchesExist(tx: Tx, ids: string[]): Promise<boolean> {
    if (!ids.length) return true;
    const r = await tx.selectFrom('branches').select((eb) => eb.fn.countAll<string>().as('n')).where('id', 'in', ids).executeTakeFirstOrThrow();
    return Number(r.n) === new Set(ids).size;
  }

  doctor(tx: Tx, id: string) {
    return tx.selectFrom('doctors').select(['id', 'member_id', 'is_active']).where('id', '=', id).executeTakeFirst();
  }

  /** Plan `staff`: active members plus open (unexpired) invitations. */
  async staffUsed(tx: Tx): Promise<number> {
    const { rows } = await sql<{ n: string }>`
      select (select count(*) from tenant_members where status = 'active')
           + (select count(*) from invitations where accepted_at is null and revoked_at is null and expires_at > now()) as n`.execute(tx);
    return Number(rows[0]?.n ?? 0);
  }

  /** Whether someone with this email is already a member of the clinic (active or disabled). */
  async memberByEmail(tx: Tx, email: string): Promise<boolean> {
    return !!(await tx.selectFrom('tenant_members as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id')
      .where('u.email', '=', email).executeTakeFirst());
  }

  async memberOfUser(tx: Tx, userId: string): Promise<boolean> {
    return !!(await tx.selectFrom('tenant_members').select('id').where('user_id', '=', userId).executeTakeFirst());
  }

  /** An invitation that ran out keeps its row (history) but stops blocking a new one for the same email. */
  async revokeExpired(tx: Tx, email: string): Promise<void> {
    await tx.updateTable('invitations').set({ revoked_at: sql<Date>`now()` })
      .where('email', '=', email).where('accepted_at', 'is', null).where('revoked_at', 'is', null).where('expires_at', '<=', sql<Date>`now()`)
      .execute();
  }

  insertInvitation(tx: Tx, i: { tenantId: string; email: string; roleId: string; branchIds: string[]; jobTitle: string | null; doctorId: string | null;
    tokenHash: string; invitedBy: string; ttlDays: number }) {
    return tx.insertInto('invitations').values({
      tenant_id: i.tenantId, email: i.email, role_id: i.roleId, branch_ids: i.branchIds, job_title: i.jobTitle, doctor_id: i.doctorId,
      token_hash: i.tokenHash, invited_by: i.invitedBy, expires_at: sql<Date>`now() + make_interval(days => ${i.ttlDays})`,
    }).returning('id').executeTakeFirstOrThrow();
  }

  private invitations(tx: Tx) {
    return tx.selectFrom('invitations as i')
      .innerJoin('roles as r', 'r.id', 'i.role_id')
      .leftJoin('doctors as d', 'd.id', 'i.doctor_id')
      .leftJoin('tenant_members as im', 'im.id', 'i.invited_by')
      .leftJoin('users as iu', 'iu.id', 'im.user_id')
      .select([
        'i.id', sql<string>`i.email::text`.as('email'), 'i.branch_ids', 'i.job_title', 'i.expires_at', 'i.created_at',
        sql<boolean>`i.expires_at <= now()`.as('expired'), roleJson.as('role'), 'iu.full_name as invited_by',
        sql<InvitationView['doctor']>`case when d.id is null then null else json_build_object('id', d.id, 'name_ar', d.name_ar, 'name_en', d.name_en) end`.as('doctor'),
      ])
      .where('i.accepted_at', 'is', null).where('i.revoked_at', 'is', null);
  }

  async listInvitations(tx: Tx): Promise<InvitationView[]> {
    return (await this.invitations(tx).orderBy('i.created_at', 'desc').execute()) as InvitationView[];
  }

  async getInvitation(tx: Tx, id: string): Promise<InvitationView | undefined> {
    return (await this.invitations(tx).where('i.id', '=', id).executeTakeFirst()) as InvitationView | undefined;
  }

  /** A fresh link for an open invitation: the old link stops working at once. */
  async renewInvitation(tx: Tx, id: string, tokenHash: string, ttlDays: number): Promise<boolean> {
    const r = await tx.updateTable('invitations').set({ token_hash: tokenHash, expires_at: sql<Date>`now() + make_interval(days => ${ttlDays})` })
      .where('id', '=', id).where('accepted_at', 'is', null).where('revoked_at', 'is', null).returning('id').executeTakeFirst();
    return !!r;
  }

  async revokeInvitation(tx: Tx, id: string): Promise<boolean> {
    const r = await tx.updateTable('invitations').set({ revoked_at: sql<Date>`now()` })
      .where('id', '=', id).where('accepted_at', 'is', null).where('revoked_at', 'is', null).returning('id').executeTakeFirst();
    return !!r;
  }

  // ---------------------------------------------------------- accepting (no session yet)

  async openInvitation(db: Db | Tx, tokenHash: string): Promise<OpenInvitation | undefined> {
    const { rows } = await sql<OpenInvitation>`select * from open_invitation(${tokenHash})`.execute(db);
    return rows[0];
  }

  /** Marks the invitation used; false when someone else used, revoked or outran it a moment ago (single use). */
  async claimInvitation(tx: Tx, id: string): Promise<boolean> {
    const r = await tx.updateTable('invitations').set({ accepted_at: sql<Date>`now()` })
      .where('id', '=', id).where('accepted_at', 'is', null).where('revoked_at', 'is', null).where('expires_at', '>', sql<Date>`now()`)
      .returning('id').executeTakeFirst();
    return !!r;
  }

  insertMember(tx: Tx, m: { tenantId: string; userId: string; roleId: string; allBranches: boolean; jobTitle: string | null }) {
    return tx.insertInto('tenant_members').values({
      tenant_id: m.tenantId, user_id: m.userId, role_id: m.roleId, all_branches: m.allBranches, job_title: m.jobTitle,
    }).returning('id').executeTakeFirstOrThrow();
  }

  /** Links the doctor record to the new member, unless another login took it meanwhile. */
  async linkDoctor(tx: Tx, doctorId: string, memberId: string): Promise<void> {
    await tx.updateTable('doctors').set({ member_id: memberId }).where('id', '=', doctorId).where('member_id', 'is', null).execute();
  }
}
