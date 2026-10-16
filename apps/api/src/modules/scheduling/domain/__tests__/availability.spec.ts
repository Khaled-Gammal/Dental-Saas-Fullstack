import { computeSlots } from '../availability';
import { intersect, normalize, subtract } from '../intervals';
import { addDays, dateInZone, dayWindow, endOfDay, timeInZone, weekdayOf, zonedToUtc } from '../../../../shared/time/clinic-time';
import { canTransition, isFinal } from '../appointment-status';
import { bookableDates, dateProblem, type BookingPolicy } from '../booking-policy';

const MIN = 60_000;
const at = (h: number, m = 0) => (h * 60 + m) * MIN; // minutes since an arbitrary midnight
const iv = (s: number, e: number) => ({ start: s, end: e });

describe('intervals', () => {
  it('normalize sorts, merges and drops empty', () => {
    expect(normalize([iv(5, 10), iv(1, 3), iv(3, 6), iv(8, 8)])).toEqual([iv(1, 10)]);
  });
  it('intersect keeps only shared time', () => {
    expect(intersect([iv(0, 10), iv(20, 30)], [iv(5, 25)])).toEqual([iv(5, 10), iv(20, 25)]);
  });
  it('subtract cuts holes and edges', () => {
    expect(subtract([iv(0, 10)], [iv(3, 4), iv(8, 12)])).toEqual([iv(0, 3), iv(4, 8)]);
    expect(subtract([iv(0, 10)], [iv(0, 10)])).toEqual([]);
  });
});

describe('computeSlots', () => {
  const shift = [iv(at(17), at(22))];
  const open = [iv(at(10), at(14)), iv(at(17), at(22))];

  it('offers a grid from the shift start while the whole visit fits', () => {
    const slots = computeSlots({ shifts: shift, branchHours: open, busy: [], durationMs: 20 * MIN, stepMs: 15 * MIN, notBefore: 0 });
    expect(slots[0]).toBe(at(17));
    expect(slots[slots.length - 1]).toBe(at(21, 30)); // 21:45 + 20 min would end after closing
    expect(slots).toHaveLength(19);
  });
  it('is limited by branch hours, not only the shift', () => {
    const slots = computeSlots({ shifts: [iv(at(9), at(13))], branchHours: [iv(at(10), at(12))], busy: [], durationMs: 30 * MIN, stepMs: 30 * MIN, notBefore: 0 });
    expect(slots).toEqual([at(10), at(10, 30), at(11), at(11, 30)]);
  });
  it('skips anything that touches a booking or a hold', () => {
    const busy = [iv(at(17, 30), at(18))];
    const slots = computeSlots({ shifts: shift, branchHours: open, busy, durationMs: 20 * MIN, stepMs: 15 * MIN, notBefore: 0 });
    expect(slots).not.toContain(at(17, 15)); // 17:15–17:35 overlaps
    expect(slots).not.toContain(at(17, 30));
    expect(slots).not.toContain(at(17, 45));
    expect(slots).toContain(at(17));
    expect(slots).toContain(at(18));
  });
  it('respects the minimum notice', () => {
    const slots = computeSlots({ shifts: shift, branchHours: open, busy: [], durationMs: 20 * MIN, stepMs: 30 * MIN, notBefore: at(19, 10) });
    expect(slots[0]).toBe(at(19, 30));
  });
  it('gives nothing without a shift, on a closed day, or for a visit longer than the window', () => {
    expect(computeSlots({ shifts: [], branchHours: open, busy: [], durationMs: 20 * MIN, stepMs: 15 * MIN, notBefore: 0 })).toEqual([]);
    expect(computeSlots({ shifts: shift, branchHours: [], busy: [], durationMs: 20 * MIN, stepMs: 15 * MIN, notBefore: 0 })).toEqual([]);
    expect(computeSlots({ shifts: [iv(at(17), at(18))], branchHours: open, busy: [], durationMs: 90 * MIN, stepMs: 15 * MIN, notBefore: 0 })).toEqual([]);
  });
  it('a full day is blocked by one long time-off interval', () => {
    const slots = computeSlots({ shifts: shift, branchHours: open, busy: [iv(0, at(24))], durationMs: 20 * MIN, stepMs: 15 * MIN, notBefore: 0 });
    expect(slots).toEqual([]);
  });
});

describe('clinic-time', () => {
  const TZ = 'Africa/Cairo';
  it('converts wall-clock to an instant and back (DST and standard time)', () => {
    const summer = zonedToUtc('2026-07-01', '17:00', TZ); // UTC+3
    expect(new Date(summer).toISOString()).toBe('2026-07-01T14:00:00.000Z');
    const winter = zonedToUtc('2026-12-01', '17:00', TZ); // UTC+2
    expect(new Date(winter).toISOString()).toBe('2026-12-01T15:00:00.000Z');
    expect(timeInZone(summer, TZ)).toBe('17:00');
    expect(dateInZone(winter, TZ)).toBe('2026-12-01');
  });
  it('day window and end of day follow the zone', () => {
    const w = dayWindow('2026-10-14', TZ);
    expect(new Date(w.start).toISOString()).toBe('2026-10-13T21:00:00.000Z');
    expect(w.end - w.start).toBe(24 * 60 * MIN);
    expect(timeInZone(endOfDay('2026-10-14', TZ), TZ)).toBe('23:59');
  });
  it('calendar helpers', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekdayOf('2026-10-16')).toBe(5); // Friday
  });
});

describe('appointment status', () => {
  it('follows the SRS lifecycle', () => {
    expect(canTransition('held', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'checked_in')).toBe(true);
    expect(canTransition('completed', 'held')).toBe(false);
    expect(canTransition('pending', 'in_progress')).toBe(false);
    expect(isFinal('cancelled')).toBe(true);
    expect(isFinal('pending')).toBe(false);
  });
});

describe('booking policy', () => {
  const p: BookingPolicy = { timezone: 'Africa/Cairo', autoConfirm: true, otpRequired: true, minNoticeMinutes: 120, maxDaysAhead: 60, slotStepMinutes: 15, paymentMode: 'at_clinic' };
  const now = zonedToUtc('2026-10-16', '12:00', p.timezone);
  it('allows today through today + maxDaysAhead in the clinic zone', () => {
    expect(bookableDates(now, p)).toEqual({ first: '2026-10-16', last: '2026-12-15' });
    expect(dateProblem('2026-10-15', now, p)).toBe('past');
    expect(dateProblem('2026-10-16', now, p)).toBeNull();
    expect(dateProblem('2026-12-16', now, p)).toBe('too_far');
  });
});
