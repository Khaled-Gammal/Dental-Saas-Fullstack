import { describe, expect, it } from 'vitest';
import { difference, localToday, monthOf, needsReference, otherMethods } from '../finance-model';

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
