import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';
import { AUTH_POLICY } from '../../config';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { clipUserAgent } from './auth-events.repository';
import type { Membership, RequestMeta } from './identity.types';

/**
 * All identity SQL. users and refresh_tokens have no RLS (a person exists before and across clinics),
 * so they go through `platform()`; clinic tables go through `runAs` with the clinic's id.
 */
@Injectable()
export class IdentityRepository {
  constructor(private readonly db: TenantDb) {}

  // ------------------------------------------------------------- users

  async slugAvailable(slug: string): Promise<boolean> {
    const { rows } = await sql<{ ok: boolean }>`select slug_available(${slug}) as ok`.execute(this.db.platform());
    return rows[0]?.ok === true;
  }

  findUserIdByEmailOrPhone(email: string, phone: string) {
    return this.db.platform().selectFrom('users').select('id')
      .where((eb) => eb.or([eb('email', '=', email), eb('phone', '=', phone)]))
      .executeTakeFirst();
  }

  findUserIdByEmail(email: string) {
    return this.db.platform().selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
  }

  findUserByPhone(phone: string) {
    return this.db.platform().selectFrom('users').select(['id', 'phone_verified_at']).where('phone', '=', phone).executeTakeFirst();
  }

  /** Login lookup: by email, or by email/phone when the identifier is a phone number. */
  findUserForLogin(emailOrId: string, phone: string | null) {
    return this.db.platform().selectFrom('users')
      .select(['id', 'password_hash', 'is_active', 'phone_verified_at', 'phone'])
      .where((eb) => (phone ? eb.or([eb('email', '=', emailOrId), eb('phone', '=', phone)]) : eb('email', '=', emailOrId)))
      .executeTakeFirst();
  }

  getUser(userId: string) {
    return this.db.platform().selectFrom('users').select(['id', 'full_name', 'email', 'phone', 'is_active'])
      .where('id', '=', userId).executeTakeFirst();
  }

  /** Sets phone_verified_at once (keeps the first time) and returns the user id, if any user has this phone. */
  markPhoneVerified(phone: string, tx: Tx) {
    return tx.updateTable('users').set({ phone_verified_at: sql<Date>`coalesce(phone_verified_at, now())` })
      .where('phone', '=', phone).returning('id').executeTakeFirst();
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.db.platform().updateTable('users').set({ last_login_at: sql<Date>`now()` }).where('id', '=', userId).execute();
  }

  /**
   * Creates the user and the clinic in ONE transaction, inside the new clinic's context:
   * the user, the clinic and everything provision_tenant() seeds commit together or not at all.
   */
  createUserWithClinic(tenantId: string, u: { email: string; phone: string; fullName: string; passwordHash: string; locale: 'ar' | 'en' },
    clinic: { slug: string; nameAr: string; nameEn: string | null; rootDomain: string }) {
    return this.db.runAs(tenantId, async (tx) => {
      const user = await tx.insertInto('users')
        .values({ email: u.email, phone: u.phone, full_name: u.fullName, password_hash: u.passwordHash, locale: u.locale })
        .returning('id').executeTakeFirstOrThrow();
      const { rows } = await sql<{ tenant_id: string; hostname: string }>`
        select * from provision_tenant(${clinic.slug}, ${clinic.nameAr}, ${clinic.nameEn}, ${user.id}::uuid,
                                       ${clinic.rootDomain}, ${AUTH_POLICY.signupPlan}, ${u.locale})`.execute(tx);
      return { userId: user.id, hostname: rows[0].hostname };
    });
  }

  // ------------------------------------------------------------- memberships

  async memberships(userId: string): Promise<Membership[]> {
    const { rows } = await sql<Membership>`select * from memberships_for_user(${userId}::uuid)`.execute(this.db.platform());
    return rows;
  }

  /** The member row and its role's current permissions (read inside the clinic: RLS applies). */
  activeMember(tenantId: string, userId: string) {
    return this.db.runAs(tenantId, (tx) =>
      tx.selectFrom('tenant_members as tm').innerJoin('roles as r', 'r.id', 'tm.role_id')
        .select(['tm.id', 'r.permissions'])
        .where('tm.user_id', '=', userId).where('tm.status', '=', 'active')
        .executeTakeFirst(),
    );
  }

  /** tenants has FORCE RLS (id = current_tenant_id()), so the slug is read inside that clinic's context. */
  tenantSlug(tenantId: string) {
    return this.db.runAs(tenantId, (tx) => tx.selectFrom('tenants').select('slug').where('id', '=', tenantId).executeTakeFirst());
  }

  // ------------------------------------------------------------- refresh tokens

  async insertRefreshToken(t: { userId: string; tenantId: string; tokenHash: string; familyId: string; familyStartedAt?: Date; meta: RequestMeta }) {
    await this.db.platform().insertInto('refresh_tokens')
      .values({
        user_id: t.userId, tenant_id: t.tenantId, token_hash: t.tokenHash, family_id: t.familyId,
        family_started_at: t.familyStartedAt ?? sql<Date>`now()`,
        user_agent: clipUserAgent(t.meta.userAgent), ip: t.meta.ip ?? null,
        expires_at: sql<Date>`now() + make_interval(days => ${AUTH_POLICY.refreshTtlDays})`,
      })
      .execute();
  }

  findRefreshToken(tokenHash: string) {
    return this.db.platform().selectFrom('refresh_tokens').selectAll().where('token_hash', '=', tokenHash).executeTakeFirst();
  }

  async familyHasLiveToken(familyId: string): Promise<boolean> {
    const row = await this.db.platform().selectFrom('refresh_tokens').select('id')
      .where('family_id', '=', familyId).where('revoked_at', 'is', null).executeTakeFirst();
    return !!row;
  }

  /** Revokes one token if it is still live; false when another request rotated it first. */
  async revokeIfLive(id: string): Promise<boolean> {
    const row = await this.db.platform().updateTable('refresh_tokens').set({ revoked_at: sql<Date>`now()` })
      .where('id', '=', id).where('revoked_at', 'is', null).returning('id').executeTakeFirst();
    return !!row;
  }

  revokeByHash(tokenHash: string) {
    return this.db.platform().updateTable('refresh_tokens').set({ revoked_at: sql<Date>`now()` })
      .where('token_hash', '=', tokenHash).where('revoked_at', 'is', null)
      .returning(['user_id', 'family_id']).executeTakeFirst();
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db.platform().updateTable('refresh_tokens').set({ revoked_at: sql<Date>`now()` })
      .where('family_id', '=', familyId).where('revoked_at', 'is', null).execute();
  }
}
