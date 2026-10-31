import { describe, expect, it } from 'vitest';
import { difference, movementsFor, localToday, monthOf, needsReference, otherMethods, periodFromQuery, presetOf, presetPeriod } from '../finance-model';

describe('finance model', () => {
  it('lists the other methods apart from cash, only when something moved (CASH-002)', () => {
    const t = { payments: { cash: 50000, card: 20000 }, refunds: { card: 500 }, expenses: { bank_transfer: 3000 }, cash_in: 50000, cash_refunds: 0, cash_expenses: 0 };
    expect(otherMethods(t)).toEqual([
      { method: 'card', inMinor: 20000, outMinor: 500 },
      { method: 'bank_transfer', inMinor: 0, outMinor: 3000 },
    ]);
  });
  it('shows the difference only once an amount is typed', () => {
    expect(difference(null, 1000)).toBeNull();
    expect(difference(900, 1000)).toBe(-100);
    expect(difference(1000, 1000)).toBe(0);
  });
  it('knows which methods need a reference', () => {
    expect(needsReference('cash')).toBe(false);
    expect(needsReference('card')).toBe(false);
    expect(needsReference('instapay')).toBe(true);
  });
  it('gives the month of a date, leap years included', () => {
    expect(monthOf('2026-10-17')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthOf('2028-02-05')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(localToday(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('quick periods (redesign R8)', () => {
  it('gives today, the week from Saturday, this month so far and the whole last month', () => {
    // 2026-11-04 is a Wednesday: the week started on Saturday 2026-10-31
    expect(presetPeriod('today', '2026-11-04')).toEqual({ from: '2026-11-04', to: '2026-11-04' });
    expect(presetPeriod('week', '2026-11-04')).toEqual({ from: '2026-10-31', to: '2026-11-04' });
    expect(presetPeriod('week', '2026-10-31')).toEqual({ from: '2026-10-31', to: '2026-10-31' }); // a Saturday
    expect(presetPeriod('week', '2026-11-06')).toEqual({ from: '2026-10-31', to: '2026-11-06' }); // a Friday
    expect(presetPeriod('month', '2026-11-04')).toEqual({ from: '2026-11-01', to: '2026-11-04' });
    expect(presetPeriod('last_month', '2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(presetPeriod('last_month', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('names the preset a period matches, or none for a custom range', () => {
    expect(presetOf({ from: '2026-11-01', to: '2026-11-04' }, '2026-11-04')).toBe('month');
    expect(presetOf({ from: '2026-11-02', to: '2026-11-04' }, '2026-11-04')).toBeNull();
  });
  it('reads the period from the link only when it is a valid range', () => {
    expect(periodFromQuery({ from: '2026-10-01', to: '2026-10-15' }, '2026-11-04')).toEqual({ from: '2026-10-01', to: '2026-10-15' });
    expect(periodFromQuery({ from: '2026-10-15', to: '2026-10-01' }, '2026-11-04')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(periodFromQuery(undefined, '2026-11-04')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });
});

describe('movementsFor (redesign R9)', () => {
  const m = (kind: 'payment' | 'refund' | 'expense', method: string, amount: number) =>
    ({ kind, method, amount_minor: amount, id: `${kind}-${method}-${amount}` }) as never;
  const items = [m('payment', 'cash', 50000), m('payment', 'card', 20000), m('refund', 'card', 500), m('expense', 'cash', 10000), m('payment', 'cash', 1500)];
  it('lists one kind in one method, adding up to its figure', () => {
    const cashIn = movementsFor(items, { kind: 'payment', method: 'cash' });
    expect(cashIn.rows).toHaveLength(2);
    expect(cashIn).toMatchObject({ inMinor: 51500, outMinor: 0 });
    expect(movementsFor(items, { kind: 'expense', method: 'cash' })).toMatchObject({ inMinor: 0, outMinor: 10000 });
  });
  it('lists everything in another method, in and out apart (CASH-002)', () => {
    expect(movementsFor(items, { method: 'card' })).toMatchObject({ inMinor: 20000, outMinor: 500 });
  });
});
