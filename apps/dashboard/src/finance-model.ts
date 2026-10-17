/** Pure helpers of the expenses and cash-box screens (SRS EXP-*, CASH-*). Unit-tested; no React. */
import type { DayTotals, PaymentMethod } from './types';

export const EXPENSE_METHODS: PaymentMethod[] = ['cash', 'card', 'bank_transfer', 'wallet', 'instapay'];
/** the reference rule of payments (PAY-001) applies to expenses too */
export const needsReference = (m: PaymentMethod) => m === 'bank_transfer' || m === 'wallet' || m === 'instapay';

/** CASH-002: the methods other than cash, listed beside expected cash (never part of it). */
export function otherMethods(t: DayTotals): { method: PaymentMethod; inMinor: number; outMinor: number }[] {
  return EXPENSE_METHODS.filter((m) => m !== 'cash')
    .map((m) => ({ method: m, inMinor: t.payments[m] ?? 0, outMinor: (t.refunds[m] ?? 0) + (t.expenses[m] ?? 0) }))
    .filter((r) => r.inMinor || r.outMinor);
}

/** CASH-003: what the screen shows while the cash is being counted; null until a valid amount is typed. */
export const difference = (countedMinor: number | null, expectedMinor: number) => (countedMinor === null ? null : countedMinor - expectedMinor);

/** The month around a date, as the expenses list's default period. */
export function monthOf(isoDate: string): { from: string; to: string } {
  const [y, m] = isoDate.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

/** Today in the browser's calendar ("YYYY-MM-DD"); the server re-checks every date against the clinic's own zone. */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
