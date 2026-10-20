import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../config';
import { Err } from '../../shared/errors/app-error';
import { maskEmail } from '../../shared/mask';
import { normalizePhone } from '../../shared/phone';
import { hashPassword, passwordProblem } from './crypto';
import { IdentityRepository } from './identity.repository';
import type { RequestMeta, Session, SignupInput } from './identity.types';
import { LandingService } from '../landing/landing.service';
import { kindsFor, LegalService } from '../legal/legal.service';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';

const invalidPhone = () => Err.badRequest('invalid_phone', 'Phone number is not valid');
/** Subject of the sign-up code email. */
export const VERIFY_EMAIL_SUBJECT = 'رمز تأكيد البريد الإلكتروني';

/**
 * Sign-up and email verification (SRS AUTH-01, AUTH-03, AUTH-101): account + clinic in one step, then the owner's
 * email is confirmed with a 6-digit code. No SMS is sent (decision D-01); the phone is stored, not verified.
 */
@Injectable()
export class SignupService {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly repo: IdentityRepository,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly legal: LegalService,
    private readonly landing: LandingService,
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

    // H6: the owner accepts the current Terms, Privacy Policy and DPA (recorded with the account, for this clinic)
    const legalDocs = await this.legal.requireAccepted(input.acceptedDocuments ?? [], kindsFor(true));
    const tenantId = randomUUID();
    const locale = input.locale ?? 'ar';
    const { userId, hostname } = await this.repo.createUserWithClinic(
      tenantId,
      { email, phone, fullName: input.fullName.trim(), passwordHash: await hashPassword(input.password), locale },
      { slug, nameAr: input.clinicNameAr, nameEn: input.clinicNameEn ?? null, rootDomain: this.cfg.ROOT_DOMAIN },
      (tx, newUserId) => this.legal.record(tx, newUserId, tenantId, legalDocs, meta),
    );

    if (input.subscribe) {
      await this.landing.subscribeRequest({
        clinicId: tenantId, clinicName: input.clinicNameAr, fullName: input.fullName.trim(), phone, email, ...input.subscribe,
      }, meta);
    }
    await this.otp.sendByEmail(email, 'verify_email', meta, VERIFY_EMAIL_SUBJECT, userId);
    return { userId, email: maskEmail(email), website: `http://${hostname}`, next: 'verify_email' as const };
  }

  /** Same answer whether or not the email exists, so this endpoint cannot be used to discover accounts. */
  async resendOtp(rawEmail: string, meta: RequestMeta) {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.repo.findUserByEmailForVerification(email);
    if (user && !user.email_verified_at && !user.phone_verified_at) await this.otp.sendByEmail(email, 'verify_email', meta, VERIFY_EMAIL_SUBJECT, user.id);
    return { sent: true };
  }

  async verifyEmail(rawEmail: string, code: string, meta: RequestMeta): Promise<Session> {
    const email = rawEmail.trim().toLowerCase();
    // consuming the code and marking the email verified commit together
    const user = await this.otp.verify(email, 'verify_email', code, meta, async (tx) => {
      const u = await this.repo.markEmailVerified(email, tx);
      if (!u) throw Err.badRequest('otp_invalid', 'No account for this email'); // rolls back: the code stays usable
      return u;
    });
    return this.sessions.start(user.id, undefined, meta);
  }
}
