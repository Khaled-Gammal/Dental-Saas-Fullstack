import type { Appointment, AppointmentStatus, BookingSettings, Doctor, Room } from './types';

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

// ---------- Phase 1C (DSH-02): the calendar grid — a day per doctor or per chair, and the week ----------

export type CalendarLayout = 'list' | 'doctors' | 'chairs' | 'week';
export const LAYOUTS: CalendarLayout[] = ['list', 'doctors', 'chairs', 'week'];

/** "2026-10-31" plus n days, as a calendar date (no time zone involved). */
export function addDaysIso(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, as the doctors' schedules store it. */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The Saturday that starts the week holding `date`: the clinics' week runs Saturday to Friday. */
export function weekStart(date: string): string {
  return addDaysIso(date, -((weekdayOf(date) + 1) % 7));
}

export const weekDays = (date: string): string[] => Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart(date), i));

// one formatter per zone: building one costs far more than using it, and a week of bookings asks thousands of times
const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(timeZone, f);
  }
  return f;
};

/** The calendar date and the minutes since midnight of an instant, in the clinic's time zone. */
export function zonedParts(iso: string, timeZone: string): { date: string; minutes: number } {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(iso))) parts[p.type] = p.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** "17:30" or "17:30:00" -> 1050 */
export const clockMinutes = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };

export interface Span { start: number; end: number }
export interface Block extends Span { appointment: Appointment; lane: number; lanes: number }

/**
 * Where an appointment sits on its day: minutes from midnight, its length from the real duration (so the night the
 * clocks go back does not shrink it); one that runs past midnight stops at the day's end (its tail is not drawn on the
 * next day).
 */
export function spanOf(a: Appointment, timeZone: string): Span & { date: string } {
  const s = zonedParts(a.starts_at, timeZone);
  const length = Math.max(5, Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000));
  return { date: s.date, start: s.minutes, end: Math.min(s.minutes + length, 24 * 60) };
}

/**
 * Side by side when they overlap: each block gets a lane, and the number of lanes of the group of blocks it overlaps
 * with (so two at the same time take half the column each, and the rest of the day keeps the full width).
 */
export function layoutLanes(items: { appointment: Appointment; start: number; end: number }[], minMinutes = 0): Block[] {
  // a short booking is drawn taller than its time (its text must fit): lanes follow the drawn size, so the next one
  // does not cover it
  const sorted = items.map((it) => ({ ...it, end: Math.max(it.end, it.start + minMinutes) })).sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Block[] = [];
  let group: Block[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const close = () => { for (const b of group) b.lanes = laneEnds.length; group = []; laneEnds = []; };
  for (const it of sorted) {
    if (it.start >= groupEnd) { close(); groupEnd = -1; }
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(it.end); } else laneEnds[lane] = it.end;
    const b: Block = { ...it, lane, lanes: 1 };
    group.push(b);
    out.push(b);
    groupEnd = Math.max(groupEnd, it.end);
  }
  close();
  return out;
}

/**
 * The hours the grid shows: from the hour of the earliest start to the hour after the latest end, over working hours
 * and appointments; 09:00–21:00 when the day has neither; at least six hours.
 */
export function gridRange(spans: Span[]): Span {
  if (!spans.length) return { start: 9 * 60, end: 21 * 60 };
  let start = Math.floor(Math.min(...spans.map((s) => s.start)) / 60) * 60;
  let end = Math.min(24 * 60, Math.ceil(Math.max(...spans.map((s) => s.end)) / 60) * 60);
  if (end - start < 6 * 60) end = Math.min(24 * 60, start + 6 * 60);
  if (end - start < 6 * 60) start = Math.max(0, end - 6 * 60);
  return { start, end };
}

/** The parts of the shown range outside the working spans (shaded on a doctor's column; all of it on a day off). */
export function offHours(working: Span[], range: Span): Span[] {
  const out: Span[] = [];
  let cursor = range.start;
  for (const w of [...working].sort((a, b) => a.start - b.start)) {
    if (w.start > cursor) out.push({ start: cursor, end: Math.min(w.start, range.end) });
    cursor = Math.max(cursor, w.end);
  }
  if (cursor < range.end) out.push({ start: cursor, end: range.end });
  return out.filter((s) => s.end > s.start);
}

/** Statuses that no longer take the time (shown faded on the grid). */
export const RELEASED: AppointmentStatus[] = ['cancelled', 'no_show', 'expired'];

export interface GridColumn { key: string; title: string; date: string; appointments: Appointment[]; working?: Span[] }

const doctorName = (d: { name_ar: string | null; name_en: string | null }) => d.name_ar || d.name_en || '—';

/**
 * A day per doctor: the doctors who work that weekday (in the branch, when one is chosen) and any doctor with a booking
 * that day, in the clinic's order. Each column carries the doctor's working hours, so the rest of the day is shaded.
 * `onlyBooked`: just the doctors with bookings (a doctor's own day).
 */
export function doctorColumns(appointments: Appointment[], doctors: Doctor[], date: string, branchId?: string, onlyBooked = false): GridColumn[] {
  const weekday = weekdayOf(date);
  const rowsOf = (d: Doctor) => d.schedule.filter((r) => r.weekday === weekday && (!branchId || r.branch_id === branchId));
  const booked = new Set(appointments.map((a) => a.doctor_id));
  const known = new Map(doctors.map((d) => [d.id, d]));
  const cols: (GridColumn & { order: number })[] = [];
  for (const d of [...doctors].sort((a, b) => a.sort_order - b.sort_order || doctorName(a).localeCompare(doctorName(b), 'ar'))) {
    const rows = rowsOf(d);
    if (!booked.has(d.id) && (onlyBooked || !d.is_active || !rows.length)) continue;
    cols.push({ key: d.id, title: doctorName(d), date, order: cols.length, appointments: [],
      working: rows.map((r) => ({ start: clockMinutes(r.starts_at), end: clockMinutes(r.ends_at) })).sort((a, b) => a.start - b.start) });
  }
  // a booking with a doctor not in the list (removed from the team since): a column of its own
  for (const a of appointments) {
    if (!known.has(a.doctor_id) && !cols.some((c) => c.key === a.doctor_id)) cols.push({ key: a.doctor_id, title: doctorName(a.doctor), date, order: cols.length, appointments: [] });
  }
  for (const a of appointments) cols.find((c) => c.key === a.doctor_id)?.appointments.push(a);
  return cols;
}

export const NO_CHAIR = 'no-chair';

/** A day per chair of the branch (active ones and any with a booking), and "no chair" when a booking has none. */
export function chairColumns(appointments: Appointment[], rooms: Room[], date: string): GridColumn[] {
  const cols: GridColumn[] = rooms.filter((r) => r.is_active || appointments.some((a) => a.room_id === r.id))
    .map((r) => ({ key: r.id, title: r.name, date, appointments: [] }));
  for (const a of appointments) {
    if (a.room && !cols.some((c) => c.key === a.room!.id)) cols.push({ key: a.room.id, title: a.room.name, date, appointments: [] });
  }
  if (appointments.some((a) => !a.room_id)) cols.push({ key: NO_CHAIR, title: 'بدون كرسي', date, appointments: [] });
  for (const a of appointments) cols.find((c) => c.key === (a.room_id ?? NO_CHAIR))?.appointments.push(a);
  return cols;
}

/** The seven days of the week holding `date`, each with its bookings (by the clinic's calendar date). */
export function weekColumns(appointments: Appointment[], date: string, timeZone: string, dayTitle: (d: string) => string): GridColumn[] {
  return weekDays(date).map((d) => ({
    key: d, title: dayTitle(d), date: d,
    appointments: appointments.filter((a) => zonedParts(a.starts_at, timeZone).date === d),
  }));
}
