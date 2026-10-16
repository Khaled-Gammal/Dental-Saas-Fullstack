/**
 * Opening-hours logic for a clinic website. Pure functions (no React, no I/O) so they are easy to test.
 * Weekdays follow Postgres/JS: 0 = Sunday … 6 = Saturday.
 */
export interface HourSlot { weekday: number; opens_at: string; closes_at: string }
export interface Holiday { date: string; branch_id: string | null; name: string }

export const hhmm = (t: string) => t.slice(0, 5);
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface LocalNow { weekday: number; minutes: number; date: string }

/** Wall-clock time in `tz` (not the server's zone): weekday, minutes since midnight and the ISO date. */
export function localNow(tz: string, at = new Date()): LocalNow {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
  } catch {
    return localNow('Africa/Cairo', at); // an unknown zone in the data must not take the site down
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return { weekday: WD.indexOf(get('weekday')), minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')), date: `${get('year')}-${get('month')}-${get('day')}` };
}

export type OpenStatus =
  | { kind: 'open'; closesAt: string }
  /** `opensAt`/`opensWeekday` = the next opening when one exists within a week; `holiday` = today's holiday name */
  | { kind: 'closed'; opensAt?: string; opensWeekday?: number; holiday?: string }
  | { kind: 'unknown' };

const holidayOn = (holidays: Holiday[], date: string, branchId: string) =>
  holidays.find((h) => h.date === date && (h.branch_id === null || h.branch_id === branchId));

/**
 * Whether a branch is open right now, from its weekly hours and the clinic's holidays.
 * `unknown` when no hours are published, so the UI can stay silent instead of guessing.
 */
export function openStatus(hours: HourSlot[], holidays: Holiday[], branchId: string, tz: string, at = new Date()): OpenStatus {
  if (!hours.length) return { kind: 'unknown' };
  const now = localNow(tz, at);
  const slotsOf = (weekday: number) => hours.filter((h) => h.weekday === weekday).sort((a, b) => toMin(a.opens_at) - toMin(b.opens_at));
  const todayHoliday = holidayOn(holidays, now.date, branchId);

  if (!todayHoliday) {
    for (const s of slotsOf(now.weekday)) {
      if (toMin(s.opens_at) <= now.minutes && now.minutes < toMin(s.closes_at)) return { kind: 'open', closesAt: hhmm(s.closes_at) };
      if (now.minutes < toMin(s.opens_at)) return { kind: 'closed', opensAt: hhmm(s.opens_at), opensWeekday: now.weekday };
    }
  }
  for (let k = 1; k <= 7; k++) {
    const day = localNow(tz, new Date(at.getTime() + k * 86_400_000));
    if (holidayOn(holidays, day.date, branchId)) continue;
    const [first] = slotsOf(day.weekday);
    if (first) return { kind: 'closed', opensAt: hhmm(first.opens_at), opensWeekday: day.weekday, holiday: todayHoliday?.name };
  }
  return { kind: 'closed', holiday: todayHoliday?.name };
}

export interface WeekRow { days: number[]; slots: HourSlot[] }

const slotKey = (slots: HourSlot[]) => slots.map((s) => `${s.opens_at}-${s.closes_at}`).join(',');

/** Consecutive days (in `order`) that share the same slots, so "Sat – Thu 10:00–22:00 / Fri closed" takes two rows, not seven. */
export function groupWeek(hours: HourSlot[], order: number[]): WeekRow[] {
  const rows: WeekRow[] = [];
  for (const day of order) {
    const slots = hours.filter((h) => h.weekday === day).sort((a, b) => toMin(a.opens_at) - toMin(b.opens_at));
    const last = rows[rows.length - 1];
    if (last && slotKey(last.slots) === slotKey(slots)) last.days.push(day);
    else rows.push({ days: [day], slots });
  }
  return rows;
}
