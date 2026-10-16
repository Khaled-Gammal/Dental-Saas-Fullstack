import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Tx } from '@dental/db';
import { APP_CONFIG, AUTH_POLICY, type AppConfig } from '../../config';
import { Err } from '../../shared/errors/app-error';
import { EMAIL_SENDER, SMS_SENDER, type EmailSender, type SmsSender } from '../../shared/notifications/ports';
import { maskEmail } from '../../shared/mask';
import { maskPhone } from '../../shared/phone';
import { AuthEventsRepository } from './auth-events.repository';
import { hmac, newOtp, safeEqualHex } from './crypto';
import type { OtpPurpose, RequestMeta } from './identity.types';
import { OtpRepository } from './otp.repository';

const { otp: P } = AUTH_POLICY;

/**
 * One-time codes for any purpose (phone verification, booking confirmation, password reset). The target is a phone
 * or an email; only a keyed hash of the code is stored, the plain code exists in memory and in the message.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger('Otp');

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly codes: OtpRepository,
    private readonly events: AuthEventsRepository,
  ) {}

  private hash(purpose: OtpPurpose, target: string, code: string) {
    return hmac(this.cfg.OTP_SECRET, `${purpose}:${target}:${code}`);
  }

  /** Stores a code for `target` (max 3 per 10 minutes) and returns it for the caller to deliver. */
  private async issue(target: string, purpose: OtpPurpose, meta: RequestMeta, userId?: string): Promise<string> {
    const code = newOtp();
    const stored = await this.codes.insertUnderLimit({
      target, purpose, codeHash: this.hash(purpose, target, code),
      ttlMinutes: P.ttlMinutes, maxSends: P.sendsPerWindow, windowMinutes: P.sendWindowMinutes,
    });
    if (!stored) throw Err.tooMany('otp_rate_limited', `Too many codes requested. Wait ${P.sendWindowMinutes} minutes and try again.`);
    await this.events.record('otp_sent', meta, userId, target);
    return code;
  }

  async send(phone: string, purpose: OtpPurpose, meta: RequestMeta, userId?: string): Promise<void> {
    const code = await this.issue(phone, purpose, meta, userId);
    try {
      await this.sms.send(phone, `رمز التحقق: ${code} — صالح لمدة ${P.ttlMinutes} دقائق. Your code: ${code}`);
    } catch (err) {
      // the code is stored; the user can ask for a resend. Never fail sign-up because SMS is down.
      this.logger.error(`SMS to ${maskPhone(phone)} failed: ${(err as Error).message}`);
    }
  }

  /** The same code, delivered by email (online booking verifies the visitor's email address). */
  async sendByEmail(email: string, purpose: OtpPurpose, meta: RequestMeta, subject = 'رمز التحقق | Verification code'): Promise<void> {
    const target = email.toLowerCase();
    const code = await this.issue(target, purpose, meta);
    try {
      await this.email.send(target, subject, `رمز التحقق: ${code}\nصالح لمدة ${P.ttlMinutes} دقائق. إذا لم تطلب هذا الرمز فتجاهل الرسالة.\n\nYour verification code: ${code} (valid ${P.ttlMinutes} minutes).`);
    } catch (err) {
      this.logger.error(`Email code to ${maskEmail(target)} failed: ${(err as Error).message}`);
    }
  }

  /**
   * Checks a code, then consumes it and runs `then` in the same transaction (what the code unlocks).
   * Throws otp_expired / otp_locked / otp_invalid / otp_used.
   */
  async verify<T>(target: string, purpose: OtpPurpose, code: string, meta: RequestMeta, then: (tx: Tx) => Promise<T>): Promise<T> {
    const open = await this.codes.latestOpen(target, purpose);
    if (!open) throw Err.badRequest('otp_expired', 'The code expired. Request a new one.');
    if (!(await this.codes.claimAttempt(open.id, P.maxAttempts))) {
      // a parallel correct submission may have consumed it a moment ago: that is "used", not "locked"
      if (await this.codes.isConsumed(open.id)) throw Err.badRequest('otp_used', 'The code was already used');
      throw Err.tooMany('otp_locked', 'Too many wrong codes. Request a new one.');
    }
    if (!safeEqualHex(this.hash(purpose, target, code), open.code_hash)) {
      await this.events.record('otp_failed', meta, undefined, target);
      throw Err.badRequest('otp_invalid', 'The code is not correct');
    }
    return this.codes.consumeAllThen(open.id, target, purpose, then);
  }
}
