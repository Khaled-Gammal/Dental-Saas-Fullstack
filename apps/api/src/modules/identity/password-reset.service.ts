import { Injectable } from '@nestjs/common';
import { sql } from '@dental/db';
import { Err } from '../../shared/errors/app-error';
import { AuthEventsRepository } from './auth-events.repository';
import { hashPassword, passwordProblem } from './crypto';
import { IdentityRepository } from './identity.repository';
import type { RequestMeta } from './identity.types';
import { OtpService } from './otp.service';

/** Subject of the password-reset code email. */
export const RESET_SUBJECT = 'رمز إعادة تعيين كلمة المرور';

/**
 * Forgot password (SRS AUTH-06 / AUTH-102): a 6-digit code by email, then a new password. Same answer whether or not
 * the email has an account; a successful reset ends every session of that user.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly repo: IdentityRepository,
    private readonly otp: OtpService,
    private readonly events: AuthEventsRepository,
  ) {}

  async request(rawEmail: string, meta: RequestMeta): Promise<{ sent: true }> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.repo.findUserForLogin(email, null);
    if (user?.is_active) await this.otp.sendByEmail(email, 'reset_password', meta, RESET_SUBJECT, user.id);
    return { sent: true };
  }

  async reset(rawEmail: string, code: string, password: string, meta: RequestMeta): Promise<void> {
    const problem = passwordProblem(password);
    if (problem) throw Err.badRequest('weak_password', problem); // before the code is spent
    const email = rawEmail.trim().toLowerCase();
    const passwordHash = await hashPassword(password);
    // consuming the code, changing the password and ending every session commit together (review R11: the access
    // tokens already handed out stop at once too — sessions_revoked_at is checked on every request)
    const userId = await this.otp.verify(email, 'reset_password', code, meta, async (tx) => {
      const u = await tx.updateTable('users').set({ password_hash: passwordHash, sessions_revoked_at: sql<Date>`now()` })
        .where('email', '=', email).where('is_active', '=', true).returning('id').executeTakeFirst();
      if (!u) throw Err.badRequest('otp_invalid', 'No active account for this email'); // rolls back: the code stays usable
      await this.repo.revokeAllSessions(u.id, tx);
      return u.id;
    });
    await this.events.record('password_reset', meta, userId, email);
  }
}
