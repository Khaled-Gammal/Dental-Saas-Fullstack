/**
 * Times of day for the dashboard's time field (redesign R5). The value stays the 24-hour "HH:MM" the API takes; only
 * the label is Arabic ("5:30 م"), where the browser's own time input showed "05:30 PM" in the browser's language.
 */

/** "17:30" → "5:30 م"; midnight is "12:00 ص", noon "12:00 م". Anything that is not HH:MM is returned as it is. */
export function timeLabel(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'ص' : 'م'}`;
}

/**
 * Every time of the day, `step` minutes apart, in order. A current value between two steps (an older "17:07") is kept
 * in the list, so opening a form never changes a saved time.
 */
export function timeOptions(step: number, current?: string): { value: string; label: string }[] {
  const values: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += step) {
    values.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  }
  if (current && /^\d{2}:\d{2}$/.test(current) && !values.includes(current)) values.push(current);
  return values.sort().map((value) => ({ value, label: timeLabel(value) }));
}
