import type { HoursRow } from './types';

/** Pure weekly-hours logic for the editor (no React): easy to reason about and to unit test. */

/** `id` is local to the editor (stable React keys); it is never sent to the API. */
export interface Shift { id: string; opens: string; closes: string }
export interface DayState { weekday: number; open: boolean; shifts: Shift[] }

export const MAX_SHIFTS = 3; // same limit as the API
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5]; // Egyptian week: Saturday first
const DEFAULT_SHIFT = { opens: '10:00', closes: '14:00' };
let seq = 0;
const newId = () => `s${++seq}`;
const shift = (opens: string, closes: string): Shift => ({ id: newId(), opens, closes });

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function fromRows(rows: HoursRow[]): DayState[] {
  return WEEK_ORDER.map((weekday) => {
    const shifts = rows.filter((r) => r.weekday === weekday).map((r) => shift(r.opens_at.slice(0, 5), r.closes_at.slice(0, 5)));
    return { weekday, open: shifts.length > 0, shifts: shifts.length ? shifts : [shift(DEFAULT_SHIFT.opens, DEFAULT_SHIFT.closes)] };
  });
}

/** The API body: closed days are sent with no shifts so the save replaces the whole week. */
export function toPayload(days: DayState[]) {
  return { days: days.map((d) => ({ weekday: d.weekday, shifts: d.open ? d.shifts.map(({ opens, closes }) => ({ opens, closes })) : [] })) };
}

export type DayError = 'order' | 'overlap' | null;
/** Same rules as the API and the database: closes after opens, no overlap (touching is fine). */
export function dayError(d: DayState): DayError {
  if (!d.open) return null;
  if (d.shifts.some((s) => !s.opens || !s.closes || minutes(s.closes) <= minutes(s.opens))) return 'order';
  const sorted = [...d.shifts].sort((a, b) => minutes(a.opens) - minutes(b.opens));
  for (let i = 1; i < sorted.length; i++) if (minutes(sorted[i].opens) < minutes(sorted[i - 1].closes)) return 'overlap';
  return null;
}

const LATEST_START = 22 * 60;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const lastEnd = (d: DayState) => {
  const ends = d.shifts.map((s) => (/^\d\d:\d\d$/.test(s.closes) ? minutes(s.closes) : NaN)).filter((m) => !Number.isNaN(m));
  return ends.length ? Math.max(...ends) : null;
};

/** Room for another shift after the last one (an hour's gap, starting no later than 22:00). */
export const canAddShift = (d: DayState) => d.shifts.length < MAX_SHIFTS && (lastEnd(d) ?? 0) + 60 <= LATEST_START;

/** A sensible next shift: an hour after the last one ends, 4 hours long, capped at 23:59. */
export function nextShift(d: DayState): Shift {
  const end = lastEnd(d);
  if (end === null) return shift(DEFAULT_SHIFT.opens, DEFAULT_SHIFT.closes);
  const start = end + 60;
  return shift(hhmm(start), hhmm(Math.min(start + 4 * 60, 23 * 60 + 59)));
}

/** Copies a day's shifts (with fresh ids) to every open day. */
export const copyShifts = (from: DayState, days: DayState[]) =>
  days.map((d) => (d.open ? { ...d, shifts: from.shifts.map((s) => shift(s.opens, s.closes)) } : d));

/** Short summary for a branch card, e.g. 6 open days. */
export const openDays = (rows: HoursRow[]) => new Set(rows.map((r) => r.weekday)).size;
