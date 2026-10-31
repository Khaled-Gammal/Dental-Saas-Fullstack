import type { ClinicPlanSummary } from './types';

/**
 * Phase 1D (BIL-01): the "your plan" card's figures. Each limited resource with its use; `level` warns at 80% and says
 * "full" at the limit (the next add is refused with plan_limit_reached).
 */
export interface UsageRow { key: keyof ClinicPlanSummary['usage']; used: number; limit: number | null; percent: number; level: 'ok' | 'near' | 'full' }

const ORDER: (keyof ClinicPlanSummary['usage'])[] = ['branches', 'doctors', 'staff', 'patients', 'storageMb'];

export function usageRows(s: Pick<ClinicPlanSummary, 'usage' | 'limits'> & { storageBytes?: number }): UsageRow[] {
  return ORDER.map((key) => {
    const used = s.usage[key];
    const limit = s.limits[key];
    // storage is enforced in bytes: compare bytes when known, so "full" means the next upload really is refused
    const exact = key === 'storageMb' && s.storageBytes !== undefined ? s.storageBytes / 1024 / 1024 : used;
    const percent = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, Math.floor((exact / limit) * 100));
    const level = limit === null ? 'ok' : exact >= limit ? 'full' : percent >= 80 ? 'near' : 'ok';
    return { key, used, limit, percent, level };
  });
}

/** Whole days left in the trial (a part of a day counts as a day; 0 once it has ended). */
export function trialDaysLeft(trialEndsAt: string | null, now: number): number | null {
  if (!trialEndsAt) return null;
  return Math.max(0, Math.ceil((Date.parse(trialEndsAt) - now) / 86_400_000));
}

/**
 * Phase 2B: the renewal notice on the plan card. Active and ending within `soonDays`: a reminder; past due: when the
 * clinic stops. Nothing otherwise (a trial has its own line).
 */
export function renewalNotice(s: Pick<ClinicPlanSummary, 'status' | 'currentPeriodEnd' | 'graceEndsAt'>, now: number, soonDays = 7):
{ kind: 'soon'; days: number; endsAt: string } | { kind: 'past_due'; stopsAt: string; days: number } | null {
  if (s.status === 'active' && s.currentPeriodEnd) {
    const left = Date.parse(s.currentPeriodEnd) - now;
    if (left > 0 && left <= soonDays * 86_400_000) return { kind: 'soon', days: Math.ceil(left / 86_400_000), endsAt: s.currentPeriodEnd };
  }
  if (s.status === 'past_due' && s.graceEndsAt) {
    return { kind: 'past_due', stopsAt: s.graceEndsAt, days: Math.max(0, Math.ceil((Date.parse(s.graceEndsAt) - now) / 86_400_000)) };
  }
  return null;
}
