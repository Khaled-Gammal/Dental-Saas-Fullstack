/** Pure rules of expenses and the cash day (SRS EXP-*, CASH-*, CLR-03/04). No I/O, so they are unit-tested directly. */

export const EXPENSE_METHODS = ['cash', 'card', 'bank_transfer', 'wallet', 'instapay'] as const;
export type ExpenseMethod = (typeof EXPENSE_METHODS)[number];

export type EntryDecision =
  | { status: 'approved' | 'pending' }
  | { error: 'missing_permission' | 'cash_only' | 'over_reception_limit' };

/**
 * CLR-03: the owner and the accountant (`expenses:write`) record any expense, approved on entry. A receptionist
 * (`expenses:write:cash`) records cash expenses only, up to the clinic's limit, and they wait for the owner.
 */
export function expenseEntry(rights: { full: boolean; cash: boolean }, e: { method: ExpenseMethod; amountMinor: number }, receptionLimitMinor: number): EntryDecision {
  if (rights.full) return { status: 'approved' };
  if (!rights.cash) return { error: 'missing_permission' };
  if (e.method !== 'cash') return { error: 'cash_only' };
  if (e.amountMinor > receptionLimitMinor) return { error: 'over_reception_limit' };
  return { status: 'pending' };
}

/** EXP-004: a recorded expense is voided, never edited — by a full writer, or by its author while it still waits. */
export function canVoid(rights: { full: boolean }, e: { status: string; created_by: string | null }, memberId: string): boolean {
  if (e.status === 'void') return false;
  return rights.full || (e.status === 'pending' && e.created_by === memberId);
}

/**
 * EXP-001 (H2): the supporting document is attached once, while the expense is not void, by whoever may record any
 * expense (expenses:write) or by the member who recorded this one (reception's receipt arriving later).
 */
export function canAttachDocument(rights: { full: boolean }, e: { status: string; created_by: string | null; file_id: string | null }, memberId: string): boolean {
  if (e.status === 'void' || e.file_id) return false;
  return rights.full || e.created_by === memberId;
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
