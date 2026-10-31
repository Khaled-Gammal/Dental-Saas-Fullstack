import { Inject, Injectable } from '@nestjs/common';
import type { Tx } from '@dental/db';
import { sql } from '@dental/db';
import { AUTH_POLICY } from '../../config';
import { Err } from '../../shared/errors/app-error';
import { RATE_LIMITER, type RateLimiter } from '../../shared/rate-limit/ports';
import { DUMMY_HASH, hashPassword, needsRehash, passwordProblem, verifyPassword } from './crypto';
import { IdentityRepository } from './identity.repository';

const { login: L } = AUTH_POLICY;

/**
 * Identity's public API for other modules (SRS 8.2: a module touches only its own tables). The staff module uses it
 * to accept invitations: check an existing login's password, or create a login whose email the invitation proved.
 */
@Injectable()
export class Accounts {
  constructor(
    private readonly repo: IdentityRepository,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  /**
   * Review R11: after a password was verified, an old (unpeppered) hash is replaced by a peppered one. Best effort:
   * a failure here never fails the sign-in; the next one tries again.
   */
  async upgradeHash(userId: string, stored: string | null | undefined, password: string): Promise<void> {
    if (!stored || !needsRehash(stored)) return;
    try {
      await this.repo.replacePasswordHash(userId, stored, await hashPassword(password));
    } catch {
      // ignored on purpose (see above)
    }
  }

  async exists(email: string): Promise<boolean> {
    return !!(await this.repo.findUserIdByEmail(email.trim().toLowerCase()));
  }

  /**
   * The user when `password` is right for `email`, otherwise 401 `invalid_credentials`. Counts against the same
   * per-account lockout as sign-in, and always runs scrypt, so it cannot be used to guess passwords faster.
   */
  async checkPassword(email: string, password: string): Promise<{ id: string }> {
    const id = email.trim().toLowerCase();
    await this.limiter.enforce(`login:${id}`, L.perAccount, L.windowSeconds, 'Too many attempts. Try again later.', 'login_locked');
    const user = await this.repo.findUserForLogin(id, null);
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) throw Err.unauthorized('invalid_credentials', 'Email or password is not correct');
    if (!user.is_active) throw Err.unauthorized('account_disabled', 'Account disabled');
    await this.upgradeHash(user.id, user.password_hash, password);
    return { id: user.id };
  }

  /** A new login whose email is already proven (the invitee opened the emailed link), inside the caller's transaction. */
  async createVerifiedUser(tx: Tx, u: { email: string; fullName: string; password: string }): Promise<string> {
    const problem = passwordProblem(u.password);
    if (problem) throw Err.badRequest('weak_password', problem);
    const email = u.email.trim().toLowerCase();
    const row = await tx.insertInto('users')
      .values({ email, full_name: u.fullName.trim(), password_hash: await hashPassword(u.password), locale: 'ar' })
      .returning('id').executeTakeFirstOrThrow();
    await tx.updateTable('users').set({ email_verified_at: sql<Date>`now()` }).where('id', '=', row.id).execute();
    return row.id;
  }
}
