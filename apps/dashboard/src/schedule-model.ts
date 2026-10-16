import { WEEK_ORDER } from './hours-model';
import type { ScheduleRow } from './types';

/** Pure logic for a doctor's weekly schedule across branches (no React): mirrors the API's rules. */

/** `id` is local to the editor (stable React keys); it is never sent to the API. */
export interface Slot { id: string; branchId: string; starts: string; ends: string }
export interface ScheduleDay { weekday: number; slots: Slot[] }

export const MAX_SLOTS_PER_DAY = 4; // the API allows 28 slots a week
const DEFAULT_SLOT = { starts: '10:00', ends: '14:00' };
let seq = 0;
const slot = (branchId: string, starts: string, ends: string): Slot => ({ id: `d${++seq}`, branchId, starts, ends });

const TIME_RE = /^\d\d:\d\d$/;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Rows from the API grouped by weekday in display order; every day is present (empty = day off). */
export function fromRows(rows: ScheduleRow[]): ScheduleDay[] {
  return WEEK_ORDER.map((weekday) => ({
    weekday,
    slots: rows.filter((r) => r.weekday === weekday).map((r) => slot(r.branch_id, r.starts_at.slice(0, 5), r.ends_at.slice(0, 5))),
  }));
}

/** The API body: a flat list, days without slots simply do not appear. */
export function toPayload(days: ScheduleDay[]) {
  return { slots: days.flatMap((d) => d.slots.map((s) => ({ branchId: s.branchId, weekday: d.weekday, starts: s.starts, ends: s.ends }))) };
}

export type SlotError = 'order' | 'overlap' | 'branch' | null;
/**
 * Same rules as the API and the EXCLUDE constraint: a slot ends after it starts, the branch is one the doctor works at,
 * and slots on the same day never overlap, whatever the branch (a doctor cannot be in two places at once).
 */
export function dayError(d: ScheduleDay, branchIds: readonly string[]): SlotError {
  if (d.slots.some((s) => !branchIds.includes(s.branchId))) return 'branch';
  if (d.slots.some((s) => !TIME_RE.test(s.starts) || !TIME_RE.test(s.ends) || minutes(s.ends) <= minutes(s.starts))) return 'order';
  const sorted = [...d.slots].sort((a, b) => minutes(a.starts) - minutes(b.starts));
  for (let i = 1; i < sorted.length; i++) if (minutes(sorted[i].starts) < minutes(sorted[i - 1].ends)) return 'overlap';
  return null;
}

const LATEST_START = 22 * 60;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const lastEnd = (d: ScheduleDay) => {
  const ends = d.slots.map((s) => (TIME_RE.test(s.ends) ? minutes(s.ends) : NaN)).filter((m) => !Number.isNaN(m));
  return ends.length ? Math.max(...ends) : null;
};

export const canAddSlot = (d: ScheduleDay) => d.slots.length < MAX_SLOTS_PER_DAY && (lastEnd(d) ?? 0) + 60 <= LATEST_START;

/** A sensible next slot: same branch as the last one, an hour after it ends, 4 hours long, capped at 23:59. */
export function nextSlot(d: ScheduleDay, defaultBranchId: string): Slot {
  const last = d.slots[d.slots.length - 1];
  const end = lastEnd(d);
  if (!last || end === null) return slot(last?.branchId ?? defaultBranchId, DEFAULT_SLOT.starts, DEFAULT_SLOT.ends);
  const start = end + 60;
  return slot(last.branchId, hhmm(start), hhmm(Math.min(start + 4 * 60, 23 * 60 + 59)));
}

/** Short summary for a doctor card: how many days a week they are scheduled. */
export const scheduledDays = (rows: ScheduleRow[]) => new Set(rows.map((r) => r.weekday)).size;
