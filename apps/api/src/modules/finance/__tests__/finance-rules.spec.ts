import { canVoid, dayTotals, expectedCash, expenseEntry, needsNote } from '../finance-rules';

describe('expense entry (CLR-03)', () => {
  const owner = { full: true, cash: false };
  const reception = { full: false, cash: true };
  it('owner and accountant expenses are approved on entry, any method and amount', () => {
    expect(expenseEntry(owner, { method: 'bank_transfer', amountMinor: 5_000_000 }, 50_000)).toEqual({ status: 'approved' });
  });
  it('reception records cash expenses up to the limit, waiting for the owner', () => {
    expect(expenseEntry(reception, { method: 'cash', amountMinor: 50_000 }, 50_000)).toEqual({ status: 'pending' });
    expect(expenseEntry(reception, { method: 'cash', amountMinor: 50_001 }, 50_000)).toEqual({ error: 'over_reception_limit' });
    expect(expenseEntry(reception, { method: 'card', amountMinor: 100 }, 50_000)).toEqual({ error: 'cash_only' });
    expect(expenseEntry(reception, { method: 'cash', amountMinor: 1 }, 0)).toEqual({ error: 'over_reception_limit' });
  });
  it('without a right, nothing', () => {
    expect(expenseEntry({ full: false, cash: false }, { method: 'cash', amountMinor: 1 }, 50_000)).toEqual({ error: 'missing_permission' });
  });
});

describe('voiding (EXP-004)', () => {
  it('a full writer voids any; the author voids their own while it waits', () => {
    expect(canVoid({ full: true }, { status: 'approved', created_by: 'x' }, 'me')).toBe(true);
    expect(canVoid({ full: false }, { status: 'pending', created_by: 'me' }, 'me')).toBe(true);
    expect(canVoid({ full: false }, { status: 'approved', created_by: 'me' }, 'me')).toBe(false);
    expect(canVoid({ full: false }, { status: 'pending', created_by: 'other' }, 'me')).toBe(false);
    expect(canVoid({ full: true }, { status: 'void', created_by: 'x' }, 'me')).toBe(false);
  });
});

describe('the cash day (CASH-002, CASH-003)', () => {
  it('the SRS example: 1 000 + 500 cash − 100 cash expense = 1 400; the card 200 stays apart', () => {
    const t = dayTotals({ payments: { cash: 50_000, card: 20_000 }, expenses: { cash: 10_000 }, refunds: {}, cash_in: 50_000, cash_refunds: 0, cash_expenses: 10_000 });
    expect(expectedCash(100_000, t)).toBe(140_000);
    expect(t.payments.card).toBe(20_000);
  });
  it('cash refunds come off; missing fields count as zero', () => {
    expect(expectedCash(10_000, dayTotals({ cash_in: 5_000, cash_refunds: 2_000 }))).toBe(13_000);
    expect(dayTotals(null)).toEqual({ payments: {}, refunds: {}, expenses: {}, cash_in: 0, cash_refunds: 0, cash_expenses: 0 });
  });
  it('a difference needs a note of three letters or more', () => {
    expect(needsNote(100, 100, null)).toBe(false);
    expect(needsNote(90, 100, null)).toBe(true);
    expect(needsNote(90, 100, ' نق ')).toBe(true);
    expect(needsNote(90, 100, 'نقص فكة')).toBe(false);
  });
});
