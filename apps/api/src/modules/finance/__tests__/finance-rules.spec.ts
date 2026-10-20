import { ClinicalFileSigner } from '../../patients/clinical-files';
import { ExpenseFileSigner, expenseKey } from '../expense-files';
import { canAttachDocument, canVoid, dayTotals, expectedCash, needsNote } from '../finance-rules';

describe('voiding (EXP-004)', () => {
  it('any recorded expense, approved, pending or rejected, is voided once', () => {
    expect(canVoid({ status: 'approved' })).toBe(true);
    expect(canVoid({ status: 'pending' })).toBe(true);
    expect(canVoid({ status: 'rejected' })).toBe(true);
    expect(canVoid({ status: 'void' })).toBe(false);
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

describe('the supporting document (EXP-001, H2)', () => {
  const e = (x: Partial<{ status: string; file_id: string | null }>) => ({ status: 'approved', file_id: null, ...x });
  it('is attached once, at any status but void', () => {
    expect(canAttachDocument(e({}))).toBe(true);
    expect(canAttachDocument(e({ status: 'pending' }))).toBe(true);
    expect(canAttachDocument(e({ status: 'rejected' }))).toBe(true);
    expect(canAttachDocument(e({ file_id: 'f1' }))).toBe(false);
    expect(canAttachDocument(e({ status: 'void' }))).toBe(false);
  });
  it('has its own storage path and links that are never valid as clinical ones', () => {
    expect(expenseKey('t1', 'f1')).toBe('t/t1/expenses/f1');
    const now = Date.parse('2031-01-01T10:00:00Z');
    const url = new URL(new ExpenseFileSigner('test-secret-0123456789', 'https://api.example').url('t1', 'f1', 'u1', 300, now));
    expect(url.pathname).toBe('/expense-files/t1/f1');
    const p = Object.fromEntries(url.searchParams);
    expect(new ExpenseFileSigner('test-secret-0123456789', 'https://api.example').verify('t1', 'f1', 'u1', Number(p.exp), p.sig, now)).toBe(true);
    expect(new ClinicalFileSigner('test-secret-0123456789', 'https://api.example').verify('t1', 'f1', 'u1', Number(p.exp), p.sig, now)).toBe(false);
  });
});
