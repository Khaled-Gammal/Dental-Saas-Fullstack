/**
 * Calendar dates and wall-clock times in a clinic's time zone, with no library: Intl gives the zone's offset at an
 * instant, and two passes resolve the instant for a wall-clock time across DST edges. Dates are 'YYYY-MM-DD',
 * times 'HH:MM' (or 'HH:MM:SS' as PostgreSQL returns them), instants are epoch milliseconds.
 */
export const DEFAULT_TIMEZONE = 'Africa/Cairo';
const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try { formatter(tz); return true; } catch { return false; }
}

/** A zone from the data, or the platform default when it is missing or unknown (bad data must not stop bookings). */
export const safeTimeZone = (tz: string | null | undefined): string => (isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE);

interface WallClock { y: number; m: number; d: number; h: number; mi: number; s: number }

function wallClock(ms: number, tz: string): WallClock {
  const p = formatter(tz).formatToParts(new Date(ms));
  const n = (type: Intl.DateTimeFormatPartTypes) => Number(p.find((x) => x.type === type)?.value ?? '0');
  return { y: n('year'), m: n('month'), d: n('day'), h: n('hour') % 24, mi: n('minute'), s: n('second') };
}

/** Zone offset (ms) at an instant: wall clock read as UTC minus the instant. */
function offsetAt(ms: number, tz: string): number {
  const w = wallClock(ms, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - ms;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of an instant in the zone. */
export function dateInZone(ms: number, tz: string): string {
  const w = wallClock(ms, tz);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
}

/** 'HH:MM' of an instant in the zone. */
export function timeInZone(ms: number, tz: string): string {
  const w = wallClock(ms, tz);
  return `${pad(w.h)}:${pad(w.mi)}`;
}

/** The instant of a wall-clock time on a date in the zone. */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi, s = 0] = time.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, h, mi, s);
  const first = asUtc - offsetAt(asUtc, tz);
  return asUtc - offsetAt(first, tz); // second pass lands on the right side of a DST change
}

export const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Calendar arithmetic on 'YYYY-MM-DD' (zone-independent). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, as PostgreSQL stores weekday hours. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** [start, end) of a calendar day in the zone. */
export function dayWindow(date: string, tz: string): { start: number; end: number } {
  return { start: zonedToUtc(date, '00:00', tz), end: zonedToUtc(addDays(date, 1), '00:00', tz) };
}

/** The last instant of a calendar day in the zone (booking codes expire at the end of the appointment day). */
export const endOfDay = (date: string, tz: string): number => dayWindow(date, tz).end - 1;
