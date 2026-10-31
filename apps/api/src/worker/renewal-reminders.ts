import { sql, type Db } from '@dental/db';
import { BILLING_POLICY } from '../config';
import { emailMoney, emailWhen } from '../shared/notifications/arabic-mail';
import { safeTimeZone } from '../shared/time/clinic-time';

/**
 * Phase 2B (owner 2026-10-31: subscriptions are paid outside the system and recorded by the platform). A paid period
 * that runs out makes the clinic past due, and BILLING_POLICY.graceDays later it is suspended as unpaid
 * (expire_subscriptions). Its owners are told four times:
 *
 *   'r7'  about a week before the end        'due' when the period has ended (still working)
 *   'r1'  on the last day                    'g1'  on the last day before the suspension
 *
 * Run with the trial job (every 15 minutes), after expire_subscriptions has set the grace (subscriptions.grace_ends_at).
 * Each email is keyed by the subscription, the period's end, the step (and the grace's end after the period) and the
 * owner, so it is sent once; a renewed period, or a fresh grace after a reactivation, is told about again. The payment
 * instructions the platform set are in every email.
 */
export interface RenewalRow {
  subscription_id: string; tenant_id: string; status: 'active' | 'past_due'; current_period_end: Date; grace_ends_at: Date | null; billing_cycle: string | null;
  price_monthly_minor: string | number; price_yearly_minor: string | number; currency: string; plan_ar: string | null;
  clinic_ar: string | null; clinic_en: string | null; timezone: string | null; owners: string[] | null;
}
export type RenewalStep = 'r7' | 'r1' | 'due' | 'g1';

const DAY = 86_400_000;

/** When a past-due clinic is suspended: its grace as the worker set it, else (before the worker's run) the end plus the grace days. */
export const suspensionAt = (periodEnd: Date, graceEndsAt: Date | null, graceDays = BILLING_POLICY.graceDays): number =>
  graceEndsAt ? new Date(graceEndsAt).getTime() : new Date(periodEnd).getTime() + graceDays * DAY;

/** Which email is due now, if any. Pure. */
export function renewalStep(status: string, periodEnd: Date, now: number, graceDays = BILLING_POLICY.graceDays, remindDays = BILLING_POLICY.remindDays,
  graceEndsAt: Date | null = null): RenewalStep | null {
  const end = periodEnd.getTime();
  if (status === 'active') {
    const left = end - now;
    if (left <= 0) return null; // the worker makes it past due
    if (left <= DAY) return 'r1';
    return left <= remindDays * DAY ? 'r7' : null;
  }
  if (status === 'past_due') {
    const toSuspension = suspensionAt(periodEnd, graceEndsAt, graceDays) - now;
    if (toSuspension <= 0) return null; // suspended at the next run
    return toSuspension <= DAY ? 'g1' : 'due';
  }
  return null;
}

/** The emails for one clinic: one per owner. Pure. */
export function renewalMessages(r: RenewalRow, now: number, instructions: string | null, graceDays = BILLING_POLICY.graceDays):
{ recipient: string; subject: string; body: string; dedupe: string }[] {
  const end = new Date(r.current_period_end);
  const step = renewalStep(r.status, end, now, graceDays, BILLING_POLICY.remindDays, r.grace_ends_at);
  if (!step) return [];
  const tz = safeTimeZone(r.timezone);
  const clinic = r.clinic_ar ?? r.clinic_en ?? '';
  const ends = emailWhen(end, tz);
  const cutAt = suspensionAt(end, r.grace_ends_at, graceDays);
  const cut = emailWhen(cutAt, tz);
  const yearly = r.billing_cycle === 'yearly';
  const price = Number(yearly ? r.price_yearly_minor : r.price_monthly_minor);
  const plan = r.plan_ar ? `باقة ${r.plan_ar}` : 'الباقة';
  const cost = price > 0 ? `قيمة التجديد: ${emailMoney(price, r.currency)} ${yearly ? 'للسنة' : 'للشهر'} (${plan}).` : null;
  const howToPay = instructions?.trim()
    ? `طريقة الدفع:\n${instructions.trim()}\nبعد الدفع أرسل لنا رقم العملية ليتم تسجيله وتجديد الاشتراك.`
    : 'للتجديد تواصل معنا، وبعد الدفع يتم تسجيله وتجديد الاشتراك.';
  const stops = 'يتوقف دخول فريق العيادة إلى النظام، ويتوقف موقع العيادة والحجز عبر الإنترنت حتى يُسجَّل الدفع. بياناتك محفوظة كما هي ولن يُحذف شيء.';
  const text: Record<RenewalStep, { subject: string; lead: string }> = {
    r7: { subject: `تذكير: اشتراك ${clinic} ينتهي خلال أيام`, lead: `ينتهي اشتراك ${clinic} يوم ${ends}.` },
    r1: { subject: `تذكير: اشتراك ${clinic} ينتهي خلال أقل من يوم`, lead: `ينتهي اشتراك ${clinic} خلال أقل من يوم، يوم ${ends}.` },
    due: { subject: `انتهى اشتراك ${clinic} – جدِّده قبل ${cut}`, lead: `انتهى اشتراك ${clinic} يوم ${ends} ولم يُسجَّل التجديد بعد. تستمر العيادة في العمل حتى ${cut}، وبعدها:` },
    g1: { subject: `تنبيه أخير: إيقاف ${clinic} خلال أقل من يوم`, lead: `لم يُسجَّل تجديد اشتراك ${clinic} بعد، ويتم إيقاف العيادة ${cut}. بعد الإيقاف:` },
  };
  const before = step === 'r7' || step === 'r1';
  const body = [
    text[step].lead,
    before ? `بعد انتهائه تستمر العيادة في العمل ${graceDays} أيام، ثم ${stops}` : stops,
    cost,
    howToPay,
  ].filter(Boolean).join('\n');
  const endKey = end.toISOString();
  return (r.owners ?? []).map((email) => ({
    recipient: email, subject: text[step].subject, body,
    dedupe: `renewal:${r.subscription_id}:${endKey}:${step}${before ? '' : `@${new Date(cutAt).toISOString()}`}:${email.toLowerCase()}`,
  }));
}

/**
 * Queues the emails that are due; returns how many new ones were queued. Runs as the worker (every clinic);
 * `onlyTenant` limits it to one clinic (tests).
 */
export async function queueRenewalReminders(db: Db, now = Date.now(), onlyTenant?: string): Promise<number> {
  const at = now / 1000;
  const { rows } = await sql<RenewalRow>`
    select s.id as subscription_id, s.tenant_id, s.status, s.current_period_end, s.grace_ends_at, s.billing_cycle, p.price_monthly_minor, p.price_yearly_minor, p.currency,
           p.name_ar as plan_ar, t.name_ar as clinic_ar, t.name_en as clinic_en, t.timezone,
           (select array_agg(distinct u.email::text) from tenant_members m
              join roles r on r.id = m.role_id join users u on u.id = m.user_id
             where m.tenant_id = s.tenant_id and r.key = 'owner' and m.status = 'active' and u.is_active and u.email is not null) as owners
      from subscriptions s join tenants t on t.id = s.tenant_id join plans p on p.id = s.plan_id
     where s.current_period_end is not null and t.deleted_at is null
       and ((s.status = 'active' and t.status = 'active'
             and s.current_period_end > to_timestamp(${at}) and s.current_period_end <= to_timestamp(${at}) + make_interval(days => ${BILLING_POLICY.remindDays}))
         or (s.status = 'past_due' and t.status = 'past_due'
             and coalesce(s.grace_ends_at, s.current_period_end + make_interval(days => ${BILLING_POLICY.graceDays})) > to_timestamp(${at})))
       and (${onlyTenant ?? null}::uuid is null or s.tenant_id = ${onlyTenant ?? null}::uuid)`.execute(db);
  if (!rows.length) return 0;
  const { rows: [ins] } = await sql<{ text: string | null }>`select billing_instructions() as text`.execute(db);
  let queued = 0;
  for (const r of rows) {
    for (const m of renewalMessages(r, now, ins?.text ?? null)) {
      const res = await db.insertInto('notifications').values({
        tenant_id: r.tenant_id, event: 'subscription.renewal', channel: 'email', recipient: m.recipient, subject: m.subject, body: m.body,
        dedupe_key: m.dedupe, related_type: 'subscription', related_id: r.subscription_id, scheduled_at: sql<Date>`now()`,
      }).onConflict((oc) => oc.columns(['tenant_id', 'dedupe_key']).doNothing()).executeTakeFirst();
      queued += Number(res.numInsertedOrUpdatedRows ?? 0);
    }
  }
  return queued;
}
