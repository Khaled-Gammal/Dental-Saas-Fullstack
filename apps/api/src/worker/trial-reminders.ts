import { sql, type Db } from '@dental/db';
import { emailWhen } from '../shared/notifications/arabic-mail';
import { safeTimeZone } from '../shared/time/clinic-time';

/**
 * Review R11 (NTF-03 "trial ending"): a trial that ends without activation suspends the clinic on the spot
 * (expire_trials, H5), so its owners are warned twice before: about 3 days ahead and on the last day. Run with the
 * trial job (every 15 minutes); each warning is keyed by the subscription, its end and the owner, so it is sent once,
 * and an extended trial (a new end) is warned about again. Activated or suspended clinics get nothing.
 */
export interface TrialRow {
  subscription_id: string; tenant_id: string; trial_ends_at: Date; clinic_ar: string | null; clinic_en: string | null; timezone: string | null;
  owners: string[] | null;
}

const DAY = 86_400_000;
export const TRIAL_WARN_DAYS = 3;

/** Which warning is due: '1' within the last 24 hours, '3' within the last three days, none before. */
export function trialBucket(endsAt: Date, now: number): '1' | '3' | null {
  const left = endsAt.getTime() - now;
  if (left <= 0) return null;
  if (left <= DAY) return '1';
  if (left <= TRIAL_WARN_DAYS * DAY) return '3';
  return null;
}

/** The warnings for one clinic: one per owner. Pure. */
export function trialMessages(t: TrialRow, now: number, landingUrl?: string): { recipient: string; subject: string; body: string; dedupe: string }[] {
  const bucket = trialBucket(new Date(t.trial_ends_at), now);
  if (!bucket) return [];
  const clinic = t.clinic_ar ?? t.clinic_en ?? '';
  const ends = emailWhen(new Date(t.trial_ends_at), safeTimeZone(t.timezone));
  const soon = bucket === '1' ? 'خلال أقل من يوم' : 'خلال أيام';
  const subscribe = landingUrl ? `للاشتراك واستمرار العمل: ${landingUrl.replace(/\/$/, '')}/#pricing` : 'للاشتراك واستمرار العمل تواصل معنا.';
  const body = [
    `تنتهي الفترة التجريبية لـ ${clinic} ${soon}، يوم ${ends}.`,
    'بعد انتهائها يتوقف دخول فريق العيادة إلى النظام، ويتوقف موقع العيادة والحجز عبر الإنترنت حتى يتم تفعيل الاشتراك.',
    'بياناتك محفوظة كما هي ولن يُحذف شيء.',
    subscribe,
  ].join('\n');
  const endKey = new Date(t.trial_ends_at).toISOString();
  return (t.owners ?? []).map((email) => ({
    recipient: email, subject: `تنبيه: الفترة التجريبية تنتهي ${soon} – ${clinic}`, body,
    dedupe: `trial_ending:${t.subscription_id}:${endKey}:${bucket}:${email.toLowerCase()}`,
  }));
}

/**
 * Queues the warnings that are due; returns how many new ones were queued. Runs as the worker (every clinic);
 * `onlyTenant` limits it to one clinic (tests).
 */
export async function queueTrialReminders(db: Db, landingUrl?: string, now = Date.now(), onlyTenant?: string): Promise<number> {
  const { rows } = await sql<TrialRow>`
    select s.id as subscription_id, s.tenant_id, s.trial_ends_at, t.name_ar as clinic_ar, t.name_en as clinic_en, t.timezone,
           (select array_agg(distinct u.email::text) from tenant_members m
              join roles r on r.id = m.role_id join users u on u.id = m.user_id
             where m.tenant_id = s.tenant_id and r.key = 'owner' and m.status = 'active' and u.is_active and u.email is not null) as owners
    from subscriptions s join tenants t on t.id = s.tenant_id
    where s.status = 'trialing' and t.status = 'trialing'
      and s.trial_ends_at > to_timestamp(${now / 1000}) and s.trial_ends_at <= to_timestamp(${now / 1000}) + make_interval(days => ${TRIAL_WARN_DAYS})
      and (${onlyTenant ?? null}::uuid is null or s.tenant_id = ${onlyTenant ?? null}::uuid)`.execute(db);
  let queued = 0;
  for (const t of rows) {
    for (const m of trialMessages(t, now, landingUrl)) {
      const r = await db.insertInto('notifications').values({
        tenant_id: t.tenant_id, event: 'trial.ending', channel: 'email', recipient: m.recipient, subject: m.subject, body: m.body,
        dedupe_key: m.dedupe, related_type: 'subscription', related_id: t.subscription_id, scheduled_at: sql<Date>`now()`,
      }).onConflict((oc) => oc.columns(['tenant_id', 'dedupe_key']).doNothing()).executeTakeFirst();
      queued += Number(r.numInsertedOrUpdatedRows ?? 0);
    }
  }
  return queued;
}
