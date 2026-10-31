/** Pure helpers of the expenses and cash-box screens (SRS EXP-*, CASH-*). Unit-tested; no React. */
import type { CashMovement, DayTotals, PaymentMethod } from './types';

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

// ---------- quick periods (redesign R8) ----------

export type PeriodPreset = 'today' | 'week' | 'month' | 'last_month';
export const PERIOD_PRESETS: PeriodPreset[] = ['today', 'week', 'month', 'last_month'];

const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The dates of a quick period around `today` ("YYYY-MM-DD"). The week starts on Saturday, as in Egypt. */
export function presetPeriod(p: PeriodPreset, today: string): { from: string; to: string } {
  if (p === 'today') return { from: today, to: today };
  if (p === 'week') {
    const day = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday … 6 = Saturday
    return { from: shift(today, -((day + 1) % 7)), to: today };
  }
  if (p === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  return monthOf(shift(`${today.slice(0, 8)}01`, -1));
}

/** Which quick period a chosen one is (to light its button), or null for a custom range. */
export function presetOf(period: { from: string; to: string }, today: string): PeriodPreset | null {
  return PERIOD_PRESETS.find((p) => { const x = presetPeriod(p, today); return x.from === period.from && x.to === period.to; }) ?? null;
}

/** A period from the link (`?from=&to=`), when both are valid dates in order; else this month so far. */
export function periodFromQuery(q: Record<string, string> | undefined, today: string): { from: string; to: string } {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (q?.from && q?.to && iso.test(q.from) && iso.test(q.to) && q.from <= q.to) return { from: q.from, to: q.to };
  return monthOf(today);
}

// ---------- what a figure is made of (redesign R9) ----------

/** A figure of the cash day: one kind in one method ("cash payments"), or everything in one other method ("card"). */
export type FigureFilter = { kind: CashMovement['kind']; method: PaymentMethod } | { method: PaymentMethod };

/** The movements behind a figure, in time order, and what they add up to (in for payments, out for refunds and expenses). */
export function movementsFor(items: readonly CashMovement[], f: FigureFilter): { rows: CashMovement[]; inMinor: number; outMinor: number } {
  const rows = items.filter((x) => x.method === f.method && (!('kind' in f) || x.kind === f.kind));
  return {
    rows,
    inMinor: rows.filter((x) => x.kind === 'payment').reduce((n, x) => n + x.amount_minor, 0),
    outMinor: rows.filter((x) => x.kind !== 'payment').reduce((n, x) => n + x.amount_minor, 0),
  };
}
