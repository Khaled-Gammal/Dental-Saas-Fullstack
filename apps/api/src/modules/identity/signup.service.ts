import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../config';
import { Err } from '../../shared/errors/app-error';
import { maskPhone, normalizePhone } from '../../shared/phone';
import { hashPassword, passwordProblem } from './crypto';
import { IdentityRepository } from './identity.repository';
import type { RequestMeta, Session, SignupInput } from './identity.types';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';

const invalidPhone = () => Err.badRequest('invalid_phone', 'Phone number is not valid');

/** Sign-up and phone verification (SRS AUTH-01..03): account + clinic in one step, then the phone is confirmed by SMS. */
@Injectable()
export class SignupService {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly repo: IdentityRepository,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
  ) {}

  slugAvailable(slug: string): Promise<boolean> {
    return this.repo.slugAvailable(slug.toLowerCase());
  }

  async signup(input: SignupInput, meta: RequestMeta) {
    const phone = normalizePhone(input.phone);
    if (!phone) throw invalidPhone();
    const pwProblem = passwordProblem(input.password);
    if (pwProblem) throw Err.badRequest('weak_password', pwProblem);
    const email = input.email.trim().toLowerCase();
    const slug = input.slug.trim().toLowerCase();

    if (await this.repo.findUserIdByEmailOrPhone(email, phone)) {
      throw Err.conflict('account_exists', 'An account with this email or phone already exists. Sign in instead.');
    }
    if (!(await this.repo.slugAvailable(slug))) {
      throw Err.conflict('slug_taken', `The address ${slug}.${this.cfg.ROOT_DOMAIN} is not available`);
    }

    const locale = input.locale ?? 'ar';
    const { userId, hostname } = await this.repo.createUserWithClinic(
      randomUUID(),
      { email, phone, fullName: input.fullName.trim(), passwordHash: await hashPassword(input.password), locale },
      { slug, nameAr: input.clinicNameAr, nameEn: input.clinicNameEn ?? null, rootDomain: this.cfg.ROOT_DOMAIN },
    );

    await this.otp.send(phone, 'verify_phone', meta, userId);
    return { userId, phone: maskPhone(phone), website: `http://${hostname}`, next: 'verify_phone' as const };
  }

  /** Same answer whether or not the phone exists, so this endpoint cannot be used to discover accounts. */
  async resendOtp(rawPhone: string, meta: RequestMeta) {
    const phone = normalizePhone(rawPhone);
    if (!phone) return { sent: true };
    const user = await this.repo.findUserByPhone(phone);
    if (user && !user.phone_verified_at) await this.otp.send(phone, 'verify_phone', meta, user.id);
    return { sent: true };
  }

  async verifyPhone(rawPhone: string, code: string, meta: RequestMeta): Promise<Session> {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw invalidPhone();
    // consuming the code and marking the phone verified commit together
    const user = await this.otp.verify(phone, 'verify_phone', code, meta, async (tx) => {
      const u = await this.repo.markPhoneVerified(phone, tx);
      if (!u) throw Err.badRequest('otp_invalid', 'No account for this phone'); // rolls back: the code stays usable
      return u;
    });
    return this.sessions.start(user.id, undefined, meta);
  }
}
