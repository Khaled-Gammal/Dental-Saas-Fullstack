import type { Appointment, BookingSettings } from './types';

/**
 * Reception's waiting list (SRS APPT-003): checked-in patients in arrival order with how long they have waited, and
 * who is already with the doctor. Derived from the day list, so it refreshes with it.
 */
export function waitingList(appointments: Appointment[], now: number) {
  const waiting = appointments
    .filter((a) => a.status === 'checked_in' && a.checked_in_at)
    .sort((a, b) => Date.parse(a.checked_in_at!) - Date.parse(b.checked_in_at!))
    .map((a) => ({ appointment: a, waitedMinutes: Math.max(0, Math.floor((now - Date.parse(a.checked_in_at!)) / 60_000)) }));
  const withDoctor = appointments.filter((a) => a.status === 'in_progress');
  return { waiting, withDoctor };
}

/** The move request: only what changed. A different time without a schedule slot needs the override reason. */
export function moveBody(
  orig: { startsAt: string; doctorId: string; roomId: string | null },
  next: { startsAt: string; doctorId: string; roomId: string | null; overrideReason?: string },
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (next.startsAt && Date.parse(next.startsAt) !== Date.parse(orig.startsAt)) body.startsAt = next.startsAt;
  if (next.doctorId !== orig.doctorId) body.doctorId = next.doctorId;
  if (next.roomId !== orig.roomId) body.roomId = next.roomId;
  if (next.overrideReason?.trim() && (body.startsAt || body.doctorId)) body.overrideReason = next.overrideReason.trim();
  return body;
}

/** Reminder times offered on the booking-rules screen (minutes before the visit); at most four, as the API allows. */
export const REMINDER_CHOICES = [2880, 1440, 180, 120, 60] as const;
export const MAX_REMINDERS = 4;

export function toggleReminder(current: number[], minutes: number): number[] {
  if (current.includes(minutes)) return current.filter((m) => m !== minutes);
  if (current.length >= MAX_REMINDERS) return current;
  return [...current, minutes].sort((a, b) => b - a);
}

/** "2 days", "1 day", "3 hours" — the label parts for a reminder offset. */
export function reminderParts(minutes: number): { n: number; unit: 'days' | 'hours' | 'minutes' } {
  if (minutes % 1440 === 0) return { n: minutes / 1440, unit: 'days' };
  if (minutes % 60 === 0) return { n: minutes / 60, unit: 'hours' };
  return { n: minutes, unit: 'minutes' };
}

const sameList = (a: number[], b: number[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/** Only the rules that changed. */
export function bookingPatch(orig: BookingSettings, next: BookingSettings): Partial<BookingSettings> {
  const out: Partial<BookingSettings> = {};
  for (const k of Object.keys(next) as (keyof BookingSettings)[]) {
    if (k === 'reminderOffsetsMinutes') { if (!sameList(orig[k], next[k])) out[k] = next[k]; continue; }
    if (orig[k] !== next[k]) (out as Record<string, unknown>)[k] = next[k];
  }
  return out;
}
