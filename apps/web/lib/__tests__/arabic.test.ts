import { describe, expect, it } from 'vitest';
import { clock12, formatMoney } from '@dental/ui/text';
import { BOOKING_ERRORS } from '../booking';
import { priceText } from '../site';

describe('the website is Arabic only (L10N-001, -005, -006; CLR-08)', () => {
  it('times read on a 12-hour clock with ص/م', () => {
    expect(clock12('17:00:00')).toBe('5:00 م');
    expect(clock12('09:30')).toBe('9:30 ص');
    expect(clock12('00:15')).toBe('12:15 ص');
    expect(clock12('12:00')).toBe('12:00 م');
  });
  it('prices show in the clinic currency with Latin digits', () => {
    expect(formatMoney(125000)).toBe('1,250 ج.م');
    expect(formatMoney(9950, 'SAR')).toBe('99.50 SAR');
    expect(priceText(80000, 120000, 'EGP')).toBe('800 ج.م – 1,200 ج.م');
    expect(priceText(0, null)).toBe('السعر عند الكشف');
    expect(formatMoney(123456789)).not.toMatch(/[٠-٩]/);
  });
  it('every booking message is Arabic', () => {
    for (const [code, text] of Object.entries(BOOKING_ERRORS)) expect([code, /[\u0600-\u06FF]/.test(text) && !/[A-Za-z]{3,}/.test(text)]).toEqual([code, true]);
  });
});
