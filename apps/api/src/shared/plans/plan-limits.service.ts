import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';
import { Err } from '../errors/app-error';

/** What a clinic may add under its plan. Keys are `plans.limits` JSON keys; a missing key means unlimited. */
export type LimitedResource = 'branches' | 'doctors' | 'patients' | 'staff';
/** `staff` counts active members plus open invitations, so a clinic cannot invite past its plan. */
const LIMIT_KEY: Record<LimitedResource, string> = { branches: 'branches', doctors: 'doctors', patients: 'patients', staff: 'staff' };

/**
 * The one place plan limits are enforced (SRS 7.2). Read from `plans.limits` through the clinic's live
 * subscription, so a plan change applies immediately and no limit is duplicated in code.
 */
@Injectable()
export class PlanLimits {
  /**
   * Throws 403 `plan_limit_reached` when adding one more `resource` would exceed the plan.
   * Call inside the write transaction: it takes a per-clinic advisory lock so two concurrent adds cannot both pass.
   */
  async assertCanAdd(tx: Tx, tenantId: string, resource: LimitedResource, countUsed: () => Promise<number>): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtext('plan'), hashtext(${tenantId}))`.execute(tx); // namespaced: never collides with other locks
    const limit = await this.limit(tx, resource);
    if (limit === null) return;
    const used = await countUsed();
    if (used >= limit) {
      throw Err.forbidden('plan_limit_reached', `Your plan allows ${limit} ${resource}`, { resource, limit, used });
    }
  }

  /**
   * The limit for `resource`, or null when the plan does not cap it. RLS scopes the subscription to the clinic and
   * `subscriptions_one_live` guarantees at most one live row. No live subscription fails closed: nothing may be added.
   */
  limit(tx: Tx, resource: LimitedResource): Promise<number | null> {
    return this.limitFor(tx, LIMIT_KEY[resource]);
  }

  /**
   * Uploads: the clinic's stored bytes plus this upload must fit `plans.limits.storage_mb`. Same lock as the counted
   * resources, so two uploads at once cannot both squeeze under the limit.
   */
  async assertStorage(tx: Tx, tenantId: string, addBytes: number, usedBytes: () => Promise<number>): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtext('plan'), hashtext(${tenantId}))`.execute(tx);
    const limitMb = await this.limitFor(tx, 'storage_mb');
    if (limitMb === null) return;
    const used = await usedBytes();
    if (used + addBytes > limitMb * 1024 * 1024) {
      throw Err.forbidden('storage_limit_reached', `Your plan allows ${limitMb} MB of images`, { limitMb, usedMb: Math.ceil(used / 1024 / 1024) });
    }
  }

  private async limitFor(tx: Tx, key: string): Promise<number | null> {
    const row = await tx.selectFrom('subscriptions as s').innerJoin('plans as p', 'p.id', 's.plan_id')
      .select(sql<number | null>`(p.limits ->> ${key})::int`.as('limit'))
      .where('s.status', 'in', ['trialing', 'active', 'past_due'])
      .executeTakeFirst();
    if (!row) throw Err.forbidden('subscription_inactive', 'Your subscription is not active');
    return row.limit;
  }
}
