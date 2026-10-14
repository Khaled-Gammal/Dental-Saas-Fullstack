import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../config';
import { TokenService } from '../../auth/token.service';
import { Err } from '../../shared/errors/app-error';
import { maskPhone } from '../../shared/phone';
import { AuthEventsRepository } from './auth-events.repository';
import { newRefreshToken, sha256 } from './crypto';
import { IdentityRepository } from './identity.repository';
import type { RequestMeta, Rotation, Session } from './identity.types';

const DAY_MS = 24 * 60 * 60 * 1000;
const sessionExpired = () => Err.unauthorized('session_expired', 'Session expired. Sign in again.');

/**
 * Sessions = short access token (memory) + rotating refresh token (httpOnly cookie).
 * Rotation with reuse detection: a refresh token works once; an old one coming back ends the whole family.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly repo: IdentityRepository,
    private readonly tokens: TokenService,
    private readonly events: AuthEventsRepository,
  ) {}

  /**
   * Picks the clinic, reads the role's current permissions, signs the access token and stores a new refresh token.
   * `rotation` = this is a refresh: keep the family and its start time, and never fall back to another clinic.
   */
  async start(userId: string, clinicSlug: string | undefined, meta: RequestMeta, rotation?: Rotation): Promise<Session> {
    const user = await this.repo.getUser(userId);
    if (!user) throw sessionExpired();
    if (!user.is_active) throw Err.unauthorized('account_disabled', 'Account disabled');

    const active = (await this.repo.memberships(userId)).filter((m) => m.member_status === 'active' && m.tenant_status !== 'cancelled');
    const wanted = clinicSlug ? active.find((m) => m.slug === clinicSlug) : undefined;
    if (clinicSlug && !wanted) {
      // never switch clinic silently: on refresh the session ends, on login the slug is reported as wrong
      if (rotation) throw sessionExpired();
      throw Err.forbidden('clinic_not_found', 'You are not a member of this clinic');
    }
    const m = wanted ?? active[0];
    if (!m) throw Err.forbidden('no_clinic', 'Your account is not linked to an active clinic');

    const member = await this.repo.activeMember(m.tenant_id, userId);
    if (!member) throw Err.forbidden('no_clinic', 'Your account is not linked to an active clinic');
    const accessToken = await this.tokens.signAccess({ sub: userId, tid: m.tenant_id, mid: member.id, perms: member.permissions });

    const refreshToken = newRefreshToken();
    await this.repo.insertRefreshToken({
      userId, tenantId: m.tenant_id, tokenHash: sha256(refreshToken),
      familyId: rotation?.familyId ?? randomUUID(), familyStartedAt: rotation?.familyStartedAt, meta,
    });
    if (!rotation) {
      await this.repo.touchLastLogin(userId);
      await this.events.record('login_ok', meta, userId);
    }

    return {
      accessToken,
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken,
      user: { id: user.id, name: user.full_name, email: user.email, phone: user.phone ? maskPhone(user.phone) : null },
      clinic: { id: m.tenant_id, slug: m.slug, nameAr: m.name_ar, nameEn: m.name_en, role: m.role_key, status: m.tenant_status },
      clinics: active.map((r) => ({ slug: r.slug, nameAr: r.name_ar, nameEn: r.name_en })),
    };
  }

  async refresh(token: string | undefined, meta: RequestMeta): Promise<Session> {
    const notSignedIn = () => Err.unauthorized('no_session', 'Not signed in');
    if (!token) throw notSignedIn();
    const row = await this.repo.findRefreshToken(sha256(token));
    if (!row || !row.tenant_id) throw notSignedIn();

    if (row.revoked_at) {
      if (Date.now() - new Date(row.revoked_at).getTime() < this.cfg.REFRESH_RACE_GRACE_MS) {
        // two tabs refreshed at once: the other tab already rotated it; don't punish the user.
        // Only a race while the family still has a live token (not after logout / family revocation).
        if (await this.repo.familyHasLiveToken(row.family_id)) throw Err.unauthorized('refresh_race', 'Session refreshed elsewhere, retry');
        throw Err.unauthorized('session_revoked', 'Session ended. Sign in again.');
      }
      // an old token came back: it was stolen or leaked. End every session in this family.
      await this.repo.revokeFamily(row.family_id);
      await this.events.record('token_reuse', meta, row.user_id);
      throw Err.unauthorized('session_revoked', 'Session ended for security. Sign in again.');
    }
    const familyAge = Date.now() - new Date(row.family_started_at).getTime();
    if (new Date(row.expires_at).getTime() < Date.now() || familyAge > this.cfg.SESSION_MAX_DAYS * DAY_MS) {
      throw sessionExpired(); // expired, or past the absolute limit: refreshing cannot keep a session alive forever
    }
    if (!(await this.repo.revokeIfLive(row.id))) throw Err.unauthorized('refresh_race', 'Session refreshed elsewhere, retry');

    const clinic = await this.repo.tenantSlug(row.tenant_id);
    if (!clinic) throw sessionExpired();
    return this.start(row.user_id, clinic.slug, meta, { familyId: row.family_id, familyStartedAt: new Date(row.family_started_at) });
  }

  async logout(token: string | undefined, meta: RequestMeta): Promise<void> {
    if (!token) return;
    const row = await this.repo.revokeByHash(sha256(token));
    if (!row) return;
    await this.repo.revokeFamily(row.family_id);
    await this.events.record('logout', meta, row.user_id);
  }
}
