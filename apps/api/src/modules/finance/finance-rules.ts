/** Pure rules of expenses and the cash day (SRS EXP-*, CASH-*, CLR-03/04). No I/O, so they are unit-tested directly. */

export const EXPENSE_METHODS = ['cash', 'card', 'bank_transfer', 'wallet', 'instapay'] as const;
export type ExpenseMethod = (typeof EXPENSE_METHODS)[number];

// Expenses are the owner's and the accountant's (`expenses:write`, owner 2026-10-20; reception records none). Their
// expenses are approved on entry (CLR-03); "pending" remains only on expenses reception recorded before that.

/** EXP-004: a recorded expense is voided, never edited (by a member with expenses:write). */
export function canVoid(e: { status: string }): boolean {
  return e.status !== 'void';
}

/** EXP-001 (H2): the supporting document is attached once, while the expense is not void (by a member with expenses:write). */
export function canAttachDocument(e: { status: string; file_id: string | null }): boolean {
  return e.status !== 'void' && !e.file_id;
}

export interface DayTotals {
  payments: Record<string, number>;
  refunds: Record<string, number>;
  expenses: Record<string, number>;
  cash_in: number;
  cash_refunds: number;
  cash_expenses: number;
}

/** The database returns bigint sums inside jsonb as numbers; make sure every field is there. */
export function dayTotals(raw: unknown): DayTotals {
  const r = (raw ?? {}) as Partial<Record<keyof DayTotals, unknown>>;
  const map = (v: unknown) => Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).map(([k, x]) => [k, Number(x)]));
  return {
    payments: map(r.payments), refunds: map(r.refunds), expenses: map(r.expenses),
    cash_in: Number(r.cash_in ?? 0), cash_refunds: Number(r.cash_refunds ?? 0), cash_expenses: Number(r.cash_expenses ?? 0),
  };
}

/** CASH-002: opening + cash payments − cash refunds − cash expenses; the other methods are listed beside it. */
export const expectedCash = (openingMinor: number, t: DayTotals) => openingMinor + t.cash_in - t.cash_refunds - t.cash_expenses;

/** CASH-003: a difference needs a note (at least three letters, as the database checks). */
export const needsNote = (counted: number, expected: number, note: string | null | undefined) => counted !== expected && (note ?? '').trim().length < 3;
