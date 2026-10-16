import { describe, expect, it } from 'vitest';
import { canAddShift, copyShifts, dayError, fromRows, nextShift, openDays, toPayload, WEEK_ORDER, type DayState } from '../hours-model';

const day = (shifts: [string, string][], open = true): DayState => ({ weekday: 1, open, shifts: shifts.map(([opens, closes], i) => ({ id: `t${i}`, opens, closes })) });

describe('hours model', () => {
  it('builds the week Saturday-first, closed days get a default shift that is not sent', () => {
    const days = fromRows([{ weekday: 1, opens_at: '10:00:00', closes_at: '14:00:00' }]);
    expect(days.map((d) => d.weekday)).toEqual(WEEK_ORDER);
    expect(days.find((d) => d.weekday === 1)).toMatchObject({ open: true, shifts: [{ opens: '10:00', closes: '14:00' }] });
    expect(days.find((d) => d.weekday === 5)).toMatchObject({ open: false });
    expect(toPayload(days).days.find((d) => d.weekday === 5)).toEqual({ weekday: 5, shifts: [] });
  });

  it('validates like the API: order, overlap, touching allowed', () => {
    expect(dayError(day([['10:00', '14:00'], ['14:00', '18:00']]))).toBeNull();
    expect(dayError(day([['10:00', '14:00'], ['13:00', '18:00']]))).toBe('overlap');
    expect(dayError(day([['18:00', '09:00']]))).toBe('order');
    expect(dayError(day([['10:00', '']]))).toBe('order');
    expect(dayError(day([['18:00', '09:00']], false))).toBeNull(); // closed days are never wrong
  });

  it('suggests the next shift after the last one and stops at 3 or late evening', () => {
    expect(nextShift(day([['10:00', '14:00']]))).toMatchObject({ opens: '15:00', closes: '19:00' });
    expect(nextShift(day([['18:00', '22:00']]))).toMatchObject({ opens: '23:00', closes: '23:59' });
    expect(canAddShift(day([['10:00', '14:00']]))).toBe(true);
    expect(canAddShift(day([['10:00', '22:00']]))).toBe(false);
    expect(canAddShift(day([['08:00', '09:00'], ['10:00', '11:00'], ['12:00', '13:00']]))).toBe(false);
  });

  it('copies shifts to open days only, with fresh ids', () => {
    const from = day([['09:00', '12:00']]);
    const out = copyShifts(from, [from, { ...day([['16:00', '20:00']]), weekday: 2 }, { ...day([], false), weekday: 3 }]);
    expect(out[1].shifts.map((s) => [s.opens, s.closes])).toEqual([['09:00', '12:00']]);
    expect(out[1].shifts[0].id).not.toBe(from.shifts[0].id);
    expect(out[2].shifts).toHaveLength(0);
    expect(openDays([{ weekday: 1, opens_at: '10:00', closes_at: '12:00' }, { weekday: 1, opens_at: '13:00', closes_at: '15:00' }])).toBe(1);
  });
});
