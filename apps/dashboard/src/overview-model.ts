import type { Appointment, AppointmentStatus, HomeData } from './types';

/**
 * The overview's choices, apart from the screen (overview redesign, 2026-10-21). Nothing here computes a figure: the
 * counts and amounts are the API's (`/reports/home`, the day's appointments, the approval queues); this only picks
 * what to list and in which order.
 */

/** Still ahead in the day, as the appointments page reads it (the statuses it lets reception change). */
export const REMAINING: readonly AppointmentStatus[] = ['checked_in', 'in_progress', 'pending', 'confirmed'];

/** The day's remaining appointments by start time, at most `limit` (the page lists the rest). */
export function remainingToday(day: readonly Appointment[], limit = 8): { rows: Appointment[]; total: number } {
  const all = day.filter((a) => REMAINING.includes(a.status)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return { rows: all.slice(0, limit), total: all.length };
}

export type AttentionKey = 'waiting' | 'unconfirmed' | 'followUps' | 'overdue' | 'discounts' | 'expenses' | 'cash';
export interface AttentionItem { key: AttentionKey; n: number; branch?: { name_ar: string | null; name_en: string | null } }

/**
 * What is waiting for someone, in the order a clinic deals with it: people in the building first, then calls and
 * money. Only what the member's data holds (a block the API did not send, or a queue they may not see, adds nothing).
 */
export function attentionItems(h: HomeData, extra: { unconfirmed?: number; discounts?: number; expenses?: number }): AttentionItem[] {
  const items: AttentionItem[] = [];
  const add = (key: AttentionKey, n: number | undefined) => { if (n && n > 0) items.push({ key, n }); };
  add('waiting', h.appointments?.waiting);
  add('unconfirmed', extra.unconfirmed);
  add('followUps', h.follow_ups?.due);
  add('overdue', h.finance?.outstanding.overdue_installments);
  add('discounts', extra.discounts);
  add('expenses', extra.expenses);
  for (const c of h.cash ?? []) if (c.status === 'none') items.push({ key: 'cash', n: 1, branch: { name_ar: c.name_ar, name_en: c.name_en } });
  return items;
}

/**
 * How a figure moved against the period before, as a fraction (0.125 = +12.5%), for the «vs last period» badges. Null
 * when there is nothing to compare with (the period before was zero): no invented percentage. A display comparison,
 * not a business figure; the two numbers are the API's.
 */
export function change(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
