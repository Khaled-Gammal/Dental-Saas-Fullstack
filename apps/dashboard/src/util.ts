export { toAsciiDigits } from '@dental/ui/text';

/** Numbers everywhere in the dashboard use Western digits with Egyptian grouping (6/7, 10:00, 2,500), in both languages. */
export const fmtNumber = (n: number) => n.toLocaleString('ar-EG-u-nu-latn');

/**
 * Password rules shown live under the field; the API enforces the same ones (identity/crypto.ts).
 * \p{L} counts letters of any script but not Arabic-Indic digits; \p{Nd} counts digits of any script.
 */
export function passwordChecks(pw: string) {
  return { length: pw.length >= 8 && pw.length <= 128, letter: /\p{L}/u.test(pw), digit: /\p{Nd}/u.test(pw) };
}

/** Only the fields that changed are sent; an emptied text field is sent as null (cleared). */
export function diffText<K extends string>(before: Record<K, string>, after: Record<K, string>, keys: readonly K[]): Partial<Record<K, string | null>> {
  const out: Partial<Record<K, string | null>> = {};
  for (const k of keys) {
    const a = after[k].trim();
    if (a !== before[k].trim()) out[k] = a === '' ? null : a;
  }
  return out;
}

/**
 * The instant (ms) of a wall-clock time on a date in an IANA zone, e.g. 17:00 on 2026-10-24 in Africa/Cairo.
 * Two passes over the zone offset handle DST edges. Same algorithm as the API's shared/time/clinic-time.ts.
 */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, h, mi);
  const offsetAt = (ms: number) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
    const n = (type: Intl.DateTimeFormatPartTypes) => Number(p.find((x) => x.type === type)?.value ?? '0');
    return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second')) - ms;
  };
  return asUtc - offsetAt(asUtc - offsetAt(asUtc));
}
