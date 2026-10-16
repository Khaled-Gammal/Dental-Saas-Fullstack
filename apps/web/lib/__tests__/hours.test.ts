import { describe, expect, it } from 'vitest';
import { groupWeek, localNow, openStatus, type Holiday, type HourSlot } from '../hours';

const TZ = 'Africa/Cairo'; // UTC+2 in October 2026 (Egypt observes DST only April–October; 2026-10-16 is after the last Thursday of October? no: DST ends 29 Oct)
/** Two shifts a day, Saturday–Thursday, closed Friday (the seeded clinics). */
const WEEK: HourSlot[] = [6, 0, 1, 2, 3, 4].flatMap((weekday) => [
  { weekday, opens_at: '10:00:00', closes_at: '14:00:00' },
  { weekday, opens_at: '17:00:00', closes_at: '22:00:00' },
]);
const B = 'branch-1';
/** 2026-10-14 is a Wednesday. Cairo is UTC+3 during DST, so 09:00Z = 12:00 local. */
const wedAt = (localHHMM: string) => new Date(`2026-10-14T${localHHMM}:00+03:00`);

describe('localNow', () => {
  it('reports the clinic wall clock, not the server zone', () => {
    const n = localNow(TZ, wedAt('12:30'));
    expect(n).toEqual({ weekday: 3, minutes: 12 * 60 + 30, date: '2026-10-14' });
  });
  it('falls back to Cairo for an unknown zone instead of throwing', () => {
    expect(() => localNow('Mars/Olympus', wedAt('12:30'))).not.toThrow();
  });
});

describe('openStatus', () => {
  it('is unknown without published hours', () => {
    expect(openStatus([], [], B, TZ, wedAt('12:00'))).toEqual({ kind: 'unknown' });
  });
  it('is open during a shift and says when it closes', () => {
    expect(openStatus(WEEK, [], B, TZ, wedAt('12:00'))).toEqual({ kind: 'open', closesAt: '14:00' });
  });
  it('between shifts: closed, opens later today', () => {
    expect(openStatus(WEEK, [], B, TZ, wedAt('15:00'))).toEqual({ kind: 'closed', opensAt: '17:00', opensWeekday: 3 });
  });
  it('after the last shift: opens tomorrow', () => {
    expect(openStatus(WEEK, [], B, TZ, wedAt('22:30'))).toEqual({ kind: 'closed', opensAt: '10:00', opensWeekday: 4 });
  });
  it('on the closed weekday it skips to the next working day', () => {
    const fri = new Date('2026-10-16T12:00:00+03:00');
    expect(openStatus(WEEK, [], B, TZ, fri)).toEqual({ kind: 'closed', opensAt: '10:00', opensWeekday: 6 });
  });
  it('a holiday closes the branch even inside a shift and names the holiday', () => {
    const holidays: Holiday[] = [{ date: '2026-10-14', branch_id: null, name: 'عطلة رسمية' }];
    expect(openStatus(WEEK, holidays, B, TZ, wedAt('12:00'))).toEqual({ kind: 'closed', opensAt: '10:00', opensWeekday: 4, holiday: 'عطلة رسمية' });
  });
  it('a holiday of another branch does not apply', () => {
    const holidays: Holiday[] = [{ date: '2026-10-14', branch_id: 'branch-2', name: 'x' }];
    expect(openStatus(WEEK, holidays, B, TZ, wedAt('12:00')).kind).toBe('open');
  });
  it('closing time is exclusive', () => {
    expect(openStatus(WEEK, [], B, TZ, wedAt('14:00')).kind).toBe('closed');
  });
});

describe('groupWeek', () => {
  it('merges consecutive days with the same slots', () => {
    const rows = groupWeek(WEEK, [6, 0, 1, 2, 3, 4, 5]);
    expect(rows.map((r) => r.days)).toEqual([[6, 0, 1, 2, 3, 4], [5]]);
    expect(rows[0].slots).toHaveLength(2);
    expect(rows[1].slots).toHaveLength(0);
  });
  it('keeps a different day apart', () => {
    const hours = [...WEEK, { weekday: 5, opens_at: '12:00:00', closes_at: '16:00:00' }];
    const rows = groupWeek(hours, [6, 0, 1, 2, 3, 4, 5]);
    expect(rows).toHaveLength(2);
    expect(rows[1].slots[0].opens_at).toBe('12:00:00');
  });
});
