import { describe, expect, it } from 'vitest';
import { blockText, MANAGE_ERRORS, pickerDates, STATUS_TEXT, TOKEN_RE } from '../manage';

describe('the patient\'s own booking page (Phase 2E)', () => {
  it('every message is Arabic', () => {
    for (const [code, text] of [...Object.entries(MANAGE_ERRORS), ...Object.entries(STATUS_TEXT)]) {
      expect([code, /[؀-ۿ]/.test(text) && !/[A-Za-z]{3,}/.test(text)]).toEqual([code, true]);
    }
    for (const b of ['too_late', 'started', 'limit', 'not_online', 'odd']) expect(blockText(b, 'reschedule')).toMatch(/[؀-ۿ]/);
  });
  it('says why a change is not offered; nothing when it is', () => {
    expect(blockText(null, 'cancel')).toBeNull();
    expect(blockText('limit', 'cancel')).toBeNull(); // the limit is on moves only
    expect(blockText('not_active', 'reschedule')).toBeNull(); // the status badge says it
  });
  it('only a well-formed token reaches the API', () => {
    expect(TOKEN_RE.test('a'.repeat(43))).toBe(true);
    expect(TOKEN_RE.test('a'.repeat(42))).toBe(false);
    expect(TOKEN_RE.test(`${'a'.repeat(40)}../`)).toBe(false);
  });
  it('the days offered for a new time: inside the clinic\'s horizon, three weeks at most', () => {
    expect(pickerDates('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(pickerDates('2026-12-01', '2027-03-01')).toHaveLength(21);
    expect(pickerDates('2026-12-02', '2026-12-01')).toEqual([]);
  });
});
