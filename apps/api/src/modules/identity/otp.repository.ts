import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';
import { Err } from '../../shared/errors/app-error';
import { TenantDb } from '../../shared/database/tenant-db.service';
import type { OtpPurpose } from './identity.types';

/** otp_codes (no RLS: codes exist before a clinic is chosen). Every write here is atomic on its own. */
@Injectable()
export class OtpRepository {
  constructor(private readonly db: TenantDb) {}

  /**
   * Stores a new code unless the target already got `maxSends` codes in the window.
   * Count + insert run under a per-target advisory lock, so parallel requests cannot all pass the limit.
   * Returns false when over the limit.
   */
  insertUnderLimit(o: { target: string; purpose: OtpPurpose; codeHash: string; ttlMinutes: number; maxSends: number; windowMinutes: number }): Promise<boolean> {
    return this.db.platform().transaction().execute(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${`otp:${o.purpose}:${o.target}`}))`.execute(tx);
      const recent = await tx.selectFrom('otp_codes').select((eb) => eb.fn.countAll<string>().as('n'))
        .where('target', '=', o.target).where('purpose', '=', o.purpose)
        .where('created_at', '>', sql<Date>`now() - make_interval(mins => ${o.windowMinutes})`)
        .executeTakeFirstOrThrow();
      if (Number(recent.n) >= o.maxSends) return false;
      await tx.insertInto('otp_codes')
        .values({ target: o.target, purpose: o.purpose, code_hash: o.codeHash, expires_at: sql<Date>`now() + make_interval(mins => ${o.ttlMinutes})` })
        .execute();
      return true;
    });
  }

  /** The newest unexpired, unused code for this target and purpose. */
  latestOpen(target: string, purpose: OtpPurpose) {
    return this.db.platform().selectFrom('otp_codes').select(['id', 'code_hash'])
      .where('target', '=', target).where('purpose', '=', purpose)
      .where('consumed_at', 'is', null).where('expires_at', '>', sql<Date>`now()`)
      .orderBy('created_at', 'desc').limit(1)
      .executeTakeFirst();
  }

  /**
   * Takes one attempt BEFORE the code is compared, atomically. With read-then-increment, 200 parallel
   * guesses would all see attempts=0. Commits on its own so a wrong guess still counts.
   */
  async claimAttempt(id: string, maxAttempts: number): Promise<boolean> {
    const row = await this.db.platform().updateTable('otp_codes').set({ attempts: sql<number>`attempts + 1` })
      .where('id', '=', id).where('attempts', '<', maxAttempts).where('consumed_at', 'is', null)
      .returning('id').executeTakeFirst();
    return !!row;
  }

  async isConsumed(id: string): Promise<boolean> {
    const row = await this.db.platform().selectFrom('otp_codes').select('consumed_at').where('id', '=', id).executeTakeFirst();
    return !!row?.consumed_at;
  }

  /**
   * ONE transaction: consume this code, void every other open code for the same target/purpose, then run the
   * caller's step (e.g. mark the phone verified). If that step throws, the code is not used up.
   * Throws otp_used when another submission consumed the code first (only one of two parallel requests wins).
   */
  consumeAllThen<T>(id: string, target: string, purpose: OtpPurpose, then: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.platform().transaction().execute(async (tx) => {
      const rows = await tx.updateTable('otp_codes').set({ consumed_at: sql<Date>`now()` })
        .where('target', '=', target).where('purpose', '=', purpose).where('consumed_at', 'is', null)
        .returning('id').execute();
      if (!rows.some((r) => r.id === id)) throw Err.badRequest('otp_used', 'The code was already used');
      return then(tx);
    });
  }
}
