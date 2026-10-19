import { describe, expect, it } from 'vitest';
import { bookingPatch, moveBody, reminderParts, toggleReminder, waitingList } from '../calendar-model';
import type { Appointment, BookingSettings } from '../types';

const appt = (id: string, status: Appointment['status'], checkedIn: string | null): Appointment => ({
  id, status, checked_in_at: checkedIn, source: 'phone', starts_at: '2031-01-01T15:00:00Z', ends_at: '2031-01-01T15:30:00Z',
} as unknown as Appointment);

describe('waiting list', () => {
  it('lists checked-in patients by arrival with minutes waited; in-progress ones separately', () => {
    const now = Date.parse('2031-01-01T15:30:00Z');
    const w = waitingList([
      appt('late', 'checked_in', '2031-01-01T15:20:00Z'), appt('early', 'checked_in', '2031-01-01T15:05:00Z'),
      appt('inside', 'in_progress', '2031-01-01T15:00:00Z'), appt('booked', 'confirmed', null),
    ], now);
    expect(w.waiting.map((x) => [x.appointment.id, x.waitedMinutes])).toEqual([['early', 25], ['late', 10]]);
    expect(w.withDoctor.map((a) => a.id)).toEqual(['inside']);
  });
});

describe('move body', () => {
  const orig = { startsAt: '2031-01-01T15:00:00.000Z', doctorId: 'd1', roomId: null };
  it('sends nothing when nothing changed (same instant written differently)', () => {
    expect(moveBody(orig, { ...orig, startsAt: '2031-01-01T17:00:00+02:00' })).toEqual({});
  });
  it('sends a new time, doctor or room; the reason only with a time or doctor change', () => {
    expect(moveBody(orig, { ...orig, startsAt: '2031-01-01T16:00:00.000Z', overrideReason: ' late ' })).toEqual({ startsAt: '2031-01-01T16:00:00.000Z', overrideReason: 'late' });
    expect(moveBody(orig, { ...orig, roomId: 'r1', overrideReason: 'x' })).toEqual({ roomId: 'r1' });
    expect(moveBody({ ...orig, roomId: 'r1' }, { ...orig, roomId: null })).toEqual({ roomId: null });
    expect(moveBody(orig, { ...orig, doctorId: 'd2' })).toEqual({ doctorId: 'd2' });
  });
});

describe('reminders', () => {
  it('toggles, keeps at most four, longest first', () => {
    expect(toggleReminder([1440, 120], 60)).toEqual([1440, 120, 60]);
    expect(toggleReminder([1440, 120], 120)).toEqual([1440]);
    expect(toggleReminder([2880, 1440, 180, 120], 60)).toEqual([2880, 1440, 180, 120]);
  });
  it('labels in days, hours or minutes', () => {
    expect(reminderParts(2880)).toEqual({ n: 2, unit: 'days' });
    expect(reminderParts(180)).toEqual({ n: 3, unit: 'hours' });
    expect(reminderParts(45)).toEqual({ n: 45, unit: 'minutes' });
  });
});

describe('booking rules patch', () => {
  const s: BookingSettings = { autoConfirm: true, otpRequired: true, minNoticeMinutes: 120, maxDaysAhead: 60, slotStepMinutes: 15, cancelWindowHours: 12, reminderOffsetsMinutes: [1440, 120] };
  it('sends only changes; the same reminders in another order are no change', () => {
    expect(bookingPatch(s, { ...s, reminderOffsetsMinutes: [120, 1440] })).toEqual({});
    expect(bookingPatch(s, { ...s, slotStepMinutes: 30, autoConfirm: false })).toEqual({ slotStepMinutes: 30, autoConfirm: false });
    expect(bookingPatch(s, { ...s, reminderOffsetsMinutes: [60] })).toEqual({ reminderOffsetsMinutes: [60] });
  });
});
