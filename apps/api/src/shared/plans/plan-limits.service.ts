import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';
import { BILLING_POLICY } from '../../config';
import { Err } from '../errors/app-error';

/** What a clinic may add under its plan. Keys are `plans.limits` JSON keys; a missing key means unlimited. */
export type LimitedResource = 'branches' | 'doctors' | 'patients' | 'staff';
/** `staff` counts active members plus open invitations, so a clinic cannot invite past its plan. */
const LIMIT_KEY: Record<LimitedResource, string> = { branches: 'branches', doctors: 'doctors', patients: 'patients', staff: 'staff' };
/** The subscription statuses under which the clinic works (and its plan applies). */
const LIVE = ['trialing', 'active', 'past_due'] as const;

/**
 * Phase 1D: the plan features the platform sells (`plans.features` keys; the platform panel edits the same three).
 * `remove_badge` is enforced (the website badge); `custom_domain` and `online_payments` are checked with
 * `assertFeature` by those features when they are built.
 */
export const PLAN_FEATURES = ['custom_domain', 'online_payments', 'remove_badge'] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export interface PlanSummary {
  plan: { code: string; name: string } | null;
  status: string | null;
  /** the clinic works under this plan (trialing, active, past due); otherwise nothing can be added and no feature applies */
  live: boolean;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  billingCycle: string | null;
  /** null = unlimited */
  limits: { branches: number | null; doctors: number | null; staff: number | null; patients: number | null; storageMb: number | null };
  features: Record<PlanFeature, boolean>;
  usage: { branches: number; doctors: number; staff: number; patients: number; storageMb: number };
  /** exact, for the storage bar (the limit is checked in bytes) */
  storageBytes: number;
  /** Phase 2B: what renewing costs (the plan's prices, minor units) */
  price: { monthlyMinor: number; yearlyMinor: number; currency: string } | null;
  /** past due: the day the clinic is suspended if the payment is not recorded by then */
  graceEndsAt: Date | null;
  /** how to pay (the text the platform sets); null when not set */
  paymentInstructions: string | null;
  /** the clinic's recorded payments, newest first */
  payments: ClinicPayment[];
}

export interface ClinicPayment {
  id: string; number: string; periodStart: string; periodEnd: string; amountMinor: number; currency: string; method: string | null;
  billingCycle: string | null; paidAt: Date | null;
}

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
   * Phase 2A (patient import): `n` more at once. Same lock and same count as `assertCanAdd`; refuses the whole batch
   * when it does not fit, saying how many more the plan allows (`room`).
   */
  async assertCanAddMany(tx: Tx, tenantId: string, resource: LimitedResource, n: number, countUsed: () => Promise<number>): Promise<void> {
    if (n <= 0) return;
    await this.lock(tx, tenantId);
    const limit = await this.limit(tx, resource);
    if (limit === null) return;
    const used = await countUsed();
    if (used + n > limit) {
      throw Err.forbidden('plan_limit_reached', `Your plan allows ${limit} ${resource}`, { resource, limit, used, adding: n, room: Math.max(0, limit - used) });
    }
  }

  /**
   * The clinic's plan lock (until the transaction ends; taking it again in the same transaction is free). An import
   * takes it before looking for duplicates, so two imports of the same rows cannot both find them new.
   */
  async lock(tx: Tx, tenantId: string): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtext('plan'), hashtext(${tenantId}))`.execute(tx);
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

  /**
   * Phase 1D (BIL-01): whether the clinic's live plan includes a feature (`plans.features`, e.g. `remove_badge`). A
   * missing key, or no live subscription, means no.
   */
  async feature(tx: Tx, key: PlanFeature): Promise<boolean> {
    const row = await tx.selectFrom('subscriptions as s').innerJoin('plans as p', 'p.id', 's.plan_id')
      .select(sql<boolean>`coalesce((p.features ->> ${key})::boolean, false)`.as('on'))
      .where('s.status', 'in', LIVE)
      .executeTakeFirst();
    return row?.on ?? false;
  }

  /** Throws 403 `plan_feature_unavailable` when the plan does not include the feature. */
  async assertFeature(tx: Tx, key: PlanFeature): Promise<void> {
    if (!(await this.feature(tx, key))) throw Err.forbidden('plan_feature_unavailable', `Your plan does not include ${key}`, { feature: key });
  }

  /**
   * Phase 1D (BIL-01): the clinic's plan, its limits and features, and what it uses against each limit, for the
   * dashboard. The counts are the ones the limits are checked against (branches.service, doctors.service, staff.service,
   * patient-directory, the uploads): active rows; staff = active members + open invitations; patients not deleted or
   * merged; storage = every stored file. When no subscription is live, the latest other one (a suspended clinic sees
   * which plan) with `live: false`, limits 0 and no features — what is enforced then.
   */
  async summary(tx: Tx, tenantId: string): Promise<PlanSummary> {
    const sub = await tx.selectFrom('subscriptions as s').innerJoin('plans as p', 'p.id', 's.plan_id')
      .select(['p.code', 'p.name_ar', 'p.name_en', 'p.limits', 'p.features', 'p.price_monthly_minor', 'p.price_yearly_minor', 'p.currency', 's.status',
        's.trial_ends_at', 's.current_period_end', 's.grace_ends_at', 's.billing_cycle'])
      .orderBy(sql`s.status in ('trialing', 'active', 'past_due')`, 'desc').orderBy(sql`s.status <> 'cancelled'`, 'desc').orderBy('s.created_at', 'desc')
      .executeTakeFirst();
    const { rows } = await sql<{ branches: string; doctors: string; staff: string; patients: string; storage_bytes: string }>`
      select (select count(*) from branches where is_active) as branches,
             (select count(*) from doctors where is_active) as doctors,
             (select count(*) from tenant_members where status = 'active')
               + (select count(*) from invitations where accepted_at is null and revoked_at is null and expires_at > now()) as staff,
             (select count(*) from patients where tenant_id = ${tenantId} and deleted_at is null and merged_into_id is null) as patients,
             (select coalesce(sum(size_bytes), 0) from files where tenant_id = ${tenantId}) as storage_bytes`.execute(tx);
    const u = rows[0];
    // Phase 2B: the clinic's own payments (row-level security: platform invoices of this clinic only) and how to pay
    const [payments, instructions] = await Promise.all([
      sql<{ id: string; number: string; period_start: string; period_end: string; amount_minor: string; currency: string; provider: string | null; billing_cycle: string | null; paid_at: Date | null }>`
        select id, number, to_char(period_start, 'YYYY-MM-DD') as period_start, to_char(period_end, 'YYYY-MM-DD') as period_end, amount_minor, currency,
               provider, billing_cycle, paid_at
          from platform_invoices where tenant_id = ${tenantId} and status = 'paid' order by issued_at desc, number desc limit 24`.execute(tx),
      sql<{ text: string | null }>`select billing_instructions() as text`.execute(tx),
    ]);
    const live = !!sub && (LIVE as readonly string[]).includes(sub.status);
    const limits = (sub?.limits ?? {}) as Record<string, unknown>;
    const features = (live ? sub.features ?? {} : {}) as Record<string, unknown>;
    // not live: nothing may be added (limitFor fails closed), so every limit reads 0
    const num = (v: unknown) => (!live ? 0 : typeof v === 'number' ? v : null);
    return {
      plan: sub ? { code: sub.code, name: sub.name_ar || sub.name_en } : null,
      status: sub?.status ?? null,
      live,
      trialEndsAt: sub?.trial_ends_at ?? null,
      currentPeriodEnd: sub?.current_period_end ?? null,
      billingCycle: sub?.billing_cycle ?? null,
      limits: { branches: num(limits.branches), doctors: num(limits.doctors), staff: num(limits.staff), patients: num(limits.patients), storageMb: num(limits.storage_mb) },
      features: Object.fromEntries(PLAN_FEATURES.map((k) => [k, features[k] === true])) as Record<PlanFeature, boolean>,
      usage: {
        branches: Number(u.branches), doctors: Number(u.doctors), staff: Number(u.staff), patients: Number(u.patients),
        storageMb: Math.ceil(Number(u.storage_bytes) / 1024 / 1024),
      },
      storageBytes: Number(u.storage_bytes),
      price: sub ? { monthlyMinor: Number(sub.price_monthly_minor), yearlyMinor: Number(sub.price_yearly_minor), currency: sub.currency } : null,
      // set by the worker when the period ran out; until its next run, the end plus the grace days
      graceEndsAt: sub?.status !== 'past_due' ? null : sub.grace_ends_at ?? (sub.current_period_end
        ? new Date(Math.max(Date.now(), new Date(sub.current_period_end).getTime()) + BILLING_POLICY.graceDays * 86_400_000) : null),
      paymentInstructions: instructions.rows[0]?.text ?? null,
      payments: payments.rows.map((r) => ({
        id: r.id, number: r.number, periodStart: r.period_start, periodEnd: r.period_end, amountMinor: Number(r.amount_minor), currency: r.currency,
        method: r.provider, billingCycle: r.billing_cycle, paidAt: r.paid_at,
      })),
    };
  }

  private async limitFor(tx: Tx, key: string): Promise<number | null> {
    const row = await tx.selectFrom('subscriptions as s').innerJoin('plans as p', 'p.id', 's.plan_id')
      .select(sql<number | null>`(p.limits ->> ${key})::int`.as('limit'))
      .where('s.status', 'in', LIVE)
      .executeTakeFirst();
    if (!row) throw Err.forbidden('subscription_inactive', 'Your subscription is not active');
    return row.limit;
  }
}
