import { Inject, Injectable } from '@nestjs/common';
import { AUTH_POLICY } from '../../config';
import { Err } from '../../shared/errors/app-error';
import { maskPhone, normalizePhone } from '../../shared/phone';
import { RATE_LIMITER, type RateLimiter } from '../../shared/rate-limit/ports';
import { AuthEventsRepository } from './auth-events.repository';
import { DUMMY_HASH, verifyPassword } from './crypto';
import { IdentityRepository } from './identity.repository';
import type { RequestMeta, Session } from './identity.types';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';

const { login: L } = AUTH_POLICY;
const LOCKED = `Too many attempts. Try again in ${Math.ceil(L.windowSeconds / 60)} minutes.`;

/** Password login (SRS AUTH-04) with lockout per account+IP and per account. */
@Injectable()
export class LoginService {
  constructor(
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    private readonly repo: IdentityRepository,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly events: AuthEventsRepository,
  ) {}

  async login(identifier: string, password: string, clinicSlug: string | undefined, meta: RequestMeta): Promise<Session> {
    const phone = normalizePhone(identifier);
    // rate-limit key: the normalised phone, so 010..., +2010... and 002010... share one counter
    const id = phone ?? identifier.trim().toLowerCase();
    const deviceKey = `login:${id}:${meta.ip ?? '-'}`;

    // count the attempt BEFORE checking the password (atomic in Redis), so parallel guesses can't slip through
    await this.limiter.enforce(deviceKey, L.perAccountIp, L.windowSeconds, LOCKED, 'login_locked');
    await this.limiter.enforce(`login:${id}`, L.perAccount, L.windowSeconds, LOCKED, 'login_locked');

    const user = await this.repo.findUserForLogin(id, phone);
    // always run scrypt, so response time does not reveal whether the account exists
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok || !user.is_active) {
      await this.events.record('login_failed', meta, user?.id, id);
      throw Err.unauthorized('invalid_credentials', 'Email/phone or password is not correct');
    }
    if (!user.phone_verified_at) {
      if (user.phone) await this.otp.send(user.phone, 'verify_phone', meta, user.id).catch(() => undefined);
      // the password was correct, so it is safe to tell the client which phone to verify
      throw Err.forbidden('phone_not_verified', 'Verify your phone first. We sent you a new code.', {
        phone: user.phone, maskedPhone: user.phone ? maskPhone(user.phone) : null,
      });
    }
    await this.limiter.reset(deviceKey); // a correct password clears this device's counter
    return this.sessions.start(user.id, clinicSlug, meta);
  }
}
