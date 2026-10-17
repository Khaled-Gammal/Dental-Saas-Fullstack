import type { AppError } from '../../../shared/errors/app-error';
import { appendCallNote, cleanSurfaces, currentChart, isToothCode, planSummary, priceFor } from '../clinical-rules';

const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as AppError).code; } return null; };

describe('isToothCode (FDI)', () => {
  it('accepts permanent 11–48 and primary 51–85 only', () => {
    expect([11, 18, 21, 36, 48, 51, 55, 85].every(isToothCode)).toBe(true);
    expect([10, 19, 49, 56, 86, 90, 9, 0].some(isToothCode)).toBe(false);
  });
});

describe('cleanSurfaces', () => {
  it('keeps the standard order without repeats', () => {
    expect(cleanSurfaces(['D', 'O', 'D', 'M'])).toEqual(['M', 'O', 'D']);
    expect(cleanSurfaces(undefined)).toEqual([]);
  });
});

describe('priceFor (CLR-16)', () => {
  const fixed = { price_minor: 60000, price_max_minor: null };
  const range = { price_minor: 80000, price_max_minor: 120000 };
  const consult = { price_minor: 0, price_max_minor: null };
  it('defaults to the service price and accepts a price within the range', () => {
    expect(priceFor(fixed)).toBe(60000);
    expect(priceFor(range, 100000)).toBe(100000);
    expect(priceFor(range, 120000)).toBe(120000);
  });
  it('refuses a price outside the range: a lower price is a discount on the invoice', () => {
    expect(code(() => priceFor(fixed, 50000))).toBe('price_out_of_range');
    expect(code(() => priceFor(range, 130000))).toBe('price_out_of_range');
  });
  it('a service priced on consultation takes the doctor\'s price, which is then required', () => {
    expect(priceFor(consult, 45000)).toBe(45000);
    expect(code(() => priceFor(consult))).toBe('price_required');
  });
});

describe('currentChart (CHART-001)', () => {
  it('is the latest entry per tooth, in tooth order', () => {
    const e = (id: string, tooth: number, condition: string, at: string) => ({ id, tooth_code: tooth, condition, surfaces: [], recorded_at: at });
    const entries = [e('3', 36, 'filled', '2031-02-01'), e('2', 11, 'crown', '2031-01-15'), e('1', 36, 'caries', '2031-01-01')]; // newest first
    expect(currentChart(entries).map((x) => [x.tooth_code, x.condition])).toEqual([[11, 'crown'], [36, 'filled']]);
  });
});

describe('planSummary (TPLAN-003/004)', () => {
  it('counts done and remaining; cancelled items count for nothing; discounts reduce the estimate', () => {
    const s = planSummary([
      { status: 'done', price_minor: 100000, discount_minor: 10000 },
      { status: 'scheduled', price_minor: 60000, discount_minor: 0 },
      { status: 'planned', price_minor: 50000, discount_minor: 0 },
      { status: 'cancelled', price_minor: 999999, discount_minor: 0 },
    ]);
    expect(s).toEqual({ items_total: 3, items_done: 1, items_cancelled: 1, estimate_minor: 200000, done_estimate_minor: 90000, remaining_estimate_minor: 110000 });
  });
});

describe('appendCallNote (VISIT-005)', () => {
  it('adds one dated line per call and keeps the newest lines when full', () => {
    expect(appendCallNote(null, '2031-06-01', 'سارة', ' لم يرد ')).toBe('2031-06-01 — سارة: لم يرد');
    expect(appendCallNote('a', '2031-06-02', 'سارة', 'سيتصل غدًا')).toBe('a\n2031-06-02 — سارة: سيتصل غدًا');
    const long = appendCallNote('x'.repeat(4000), '2031-06-03', 'م', 'آخر مكالمة');
    expect(long.length).toBe(4000);
    expect(long.endsWith('آخر مكالمة')).toBe(true);
  });
});
