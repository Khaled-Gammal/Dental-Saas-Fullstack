import { intersect, normalize, overlaps, type Interval } from './intervals';

/** Everything the slot engine needs for one doctor on one day, already converted to absolute milliseconds. */
export interface AvailabilityInput {
  /** the doctor's shifts at this branch on the day */
  shifts: readonly Interval[];
  /** the branch's opening windows on the day (several rows allow breaks) */
  branchHours: readonly Interval[];
  /** appointments, live website holds and time off */
  busy: readonly Interval[];
  durationMs: number;
  stepMs: number;
  /** earliest start a visitor may book: now + the clinic's minimum notice */
  notBefore: number;
}

/**
 * Slot starts (ms) a visitor can book (SRS BOOK-02). Pure: the riskiest logic in the product is testable with
 * hundreds of cases and no database. The grid is anchored on each working window's start, so a 17:00 shift offers
 * 17:00, 17:15, … whatever the existing bookings look like; a slot is offered only when the whole visit fits
 * inside the window and touches nothing busy.
 */
export function computeSlots(i: AvailabilityInput): number[] {
  if (i.durationMs <= 0 || i.stepMs <= 0) return [];
  const working = intersect(i.shifts, i.branchHours);
  const busy = normalize(i.busy);
  const out: number[] = [];
  for (const w of working) {
    for (let t = w.start; t + i.durationMs <= w.end; t += i.stepMs) {
      if (t < i.notBefore) continue;
      const slot = { start: t, end: t + i.durationMs };
      if (busy.some((b) => overlaps(slot, b))) continue;
      out.push(t);
    }
  }
  return out;
}
