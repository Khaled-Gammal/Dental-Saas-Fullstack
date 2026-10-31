import { describe, expect, it } from 'vitest';
import { addDaysIso, chairColumns, doctorColumns, gridRange, layoutLanes, NO_CHAIR, offHours, spanOf, weekColumns, weekDays, weekStart, zonedParts } from '../calendar-model';
import type { Appointment, Doctor, Room } from '../types';

const appt = (id: string, starts: string, ends: string, extra: Partial<Appointment> = {}): Appointment => ({
  id, status: 'confirmed', source: 'phone', starts_at: starts, ends_at: ends, branch_id: 'b1', doctor_id: 'd1', service_id: null, room_id: null, room: null,
  payment_mode: 'at_clinic', quoted_price_minor: null, patient_notes: null, internal_notes: null, cancel_reason: null, confirmed_at: null, checked_in_at: null,
  completed_at: null, has_code: false, visit_id: null, patient: null, doctor: { name_ar: 'د. منى', name_en: null }, service: null, ...extra,
});
const doctor = (id: string, extra: Partial<Doctor> = {}): Doctor => ({
  id, name_ar: id === 'd1' ? 'د. منى' : 'د. أحمد', name_en: null, title_ar: null, title_en: null, bio_ar: null, bio_en: null, specialties: [],
  show_on_website: true, accepts_online_booking: true, is_active: true, sort_order: 0, photo: null, branch_ids: ['b1'], schedule: [], ...extra,
});

describe('calendar weeks and times (Phase 1C)', () => {
  it('the week runs Saturday to Friday', () => {
    expect(weekStart('2026-10-31')).toBe('2026-10-31'); // a Saturday
    expect(weekStart('2026-11-06')).toBe('2026-10-31'); // the Friday after
    expect(weekStart('2026-11-01')).toBe('2026-10-31'); // Sunday
    expect(weekDays('2026-11-03')).toEqual(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('reads date and minutes in the clinic time zone, not the browser\'s', () => {
    expect(zonedParts('2026-10-31T15:30:00Z', 'Africa/Cairo')).toEqual({ date: '2026-10-31', minutes: 17 * 60 + 30 });
    expect(zonedParts('2026-10-31T22:30:00Z', 'Africa/Cairo')).toEqual({ date: '2026-11-01', minutes: 30 });
  });
  it('a visit that runs past midnight stops at the end of its day; the length is the real duration', () => {
    expect(spanOf(appt('a', '2026-10-31T21:30:00Z', '2026-10-31T22:30:00Z'), 'Africa/Cairo')).toEqual({ date: '2026-10-31', start: 23 * 60 + 30, end: 24 * 60 });
    expect(spanOf(appt('b', '2026-10-31T15:00:00Z', '2026-10-31T15:45:00Z'), 'Africa/Cairo')).toEqual({ date: '2026-10-31', start: 17 * 60, end: 17 * 60 + 45 });
  });
});

describe('overlapping bookings side by side (Phase 1C)', () => {
  const at = (id: string, start: number, end: number) => ({ appointment: appt(id, '2026-10-31T15:00:00Z', '2026-10-31T15:30:00Z'), start, end });
  it('two at the same time share the width; a later one alone takes it all', () => {
    const out = layoutLanes([at('a', 600, 630), at('b', 600, 660), at('c', 700, 720)]);
    const by = Object.fromEntries(out.map((b) => [b.appointment.id, [b.lane, b.lanes]]));
    expect(by).toEqual({ b: [0, 2], a: [1, 2], c: [0, 1] });
  });
  it('short back-to-back bookings drawn taller than their time go side by side, not on top of each other', () => {
    const out = layoutLanes([at('a', 600, 615), at('b', 615, 630)], 21);
    expect(out.map((b) => [b.appointment.id, b.lane, b.lanes])).toEqual([['a', 0, 2], ['b', 1, 2]]);
    expect(layoutLanes([at('a', 600, 615), at('b', 615, 630)]).map((b) => b.lanes)).toEqual([1, 1]); // without a minimum
  });
  it('a freed lane is reused inside the same group', () => {
    const out = layoutLanes([at('a', 600, 700), at('b', 600, 630), at('c', 640, 660)]);
    const by = Object.fromEntries(out.map((b) => [b.appointment.id, [b.lane, b.lanes]]));
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [1, 2] });
  });
  it('shades what is outside the working hours, a break included; all of a day off', () => {
    const range = { start: 540, end: 1320 };
    expect(offHours([{ start: 1020, end: 1320 }, { start: 600, end: 780 }], range)).toEqual([{ start: 540, end: 600 }, { start: 780, end: 1020 }]);
    expect(offHours([], range)).toEqual([range]);
  });
  it('the grid spans working hours and bookings, whole hours, at least six', () => {
    expect(gridRange([])).toEqual({ start: 540, end: 1260 });
    expect(gridRange([{ start: 17 * 60, end: 22 * 60 }, { start: 16 * 60 + 45, end: 17 * 60 + 15 }])).toEqual({ start: 16 * 60, end: 22 * 60 });
    expect(gridRange([{ start: 22 * 60, end: 23 * 60 + 30 }])).toEqual({ start: 18 * 60, end: 24 * 60 });
  });
});

describe('calendar columns (Phase 1C)', () => {
  const sat = '2026-10-31'; // weekday 6
  it('doctors who work that day in the branch, plus any doctor with a booking; working hours per column', () => {
    const doctors = [
      doctor('d1', { schedule: [{ branch_id: 'b1', weekday: 6, starts_at: '17:00:00', ends_at: '22:00:00' }] }),
      doctor('d2', { sort_order: 1, schedule: [{ branch_id: 'b2', weekday: 6, starts_at: '10:00', ends_at: '14:00' }] }),
      doctor('d3', { sort_order: 2, schedule: [] }),
    ];
    const a = appt('a', '2026-10-31T15:00:00Z', '2026-10-31T15:30:00Z', { doctor_id: 'd3' });
    const cols = doctorColumns([a], doctors, sat, 'b1');
    expect(cols.map((c) => c.key)).toEqual(['d1', 'd3']); // d2 works elsewhere that day; d3 has a booking
    expect(cols[0].working).toEqual([{ start: 1020, end: 1320 }]);
    expect(cols[1].appointments.map((x) => x.id)).toEqual(['a']);
    expect(doctorColumns([a], doctors, sat).map((c) => c.key)).toEqual(['d1', 'd2', 'd3']); // all branches
    expect(doctorColumns([a], doctors, sat, undefined, true).map((c) => c.key)).toEqual(['d3']); // a doctor's own day
  });
  it('a booking with a doctor no longer in the team still gets a column', () => {
    const a = appt('a', '2026-10-31T15:00:00Z', '2026-10-31T15:30:00Z', { doctor_id: 'gone', doctor: { name_ar: 'د. سابق', name_en: null } });
    expect(doctorColumns([a], [], sat).map((c) => [c.key, c.title, c.appointments.length])).toEqual([['gone', 'د. سابق', 1]]);
  });
  it('chairs: active ones and any with a booking, and "no chair" only when needed', () => {
    const rooms: Room[] = [{ id: 'r1', branch_id: 'b1', name: 'كرسي 1', is_active: true }, { id: 'r2', branch_id: 'b1', name: 'كرسي 2', is_active: false }];
    const onR1 = appt('a', '2026-10-31T15:00:00Z', '2026-10-31T15:30:00Z', { room_id: 'r1', room: { id: 'r1', name: 'كرسي 1' } });
    expect(chairColumns([onR1], rooms, sat).map((c) => c.key)).toEqual(['r1']);
    const none = appt('b', '2026-10-31T16:00:00Z', '2026-10-31T16:30:00Z');
    const cols = chairColumns([onR1, none], rooms, sat);
    expect(cols.map((c) => [c.key, c.appointments.length])).toEqual([['r1', 1], [NO_CHAIR, 1]]);
  });
  it('the week: seven days, each with its bookings by the clinic\'s date', () => {
    const late = appt('late', '2026-10-31T22:30:00Z', '2026-10-31T23:00:00Z'); // 00:30 on Sunday in Cairo
    const cols = weekColumns([late], '2026-11-02', 'Africa/Cairo', (d) => d);
    expect(cols.map((c) => c.key)[0]).toBe('2026-10-31');
    expect(cols.find((c) => c.appointments.length)?.key).toBe('2026-11-01');
  });
});
