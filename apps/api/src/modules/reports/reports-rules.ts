/**
 * Pure rules of the reports (SRS REPORT-001…005): who sees which report, the period, and the roll-ups. The database
 * returns fine-grained rows (per branch, day, method, status…) under the caller's row-level security; every total here
 * is the sum of those rows, so a figure on screen always adds up to what it is made of. No I/O; unit-tested directly.
 */
import { hasPermission } from '../../auth/permissions';
import { addDays } from '../../shared/time/clinic-time';

export const REPORTS = ['revenue', 'expenses', 'attendance', 'outstanding', 'performance'] as const;
export type ReportKind = (typeof REPORTS)[number];

/** all = the clinic (within the member's branches); own = a doctor's own figures; today = reception's daily view */
export type Scope = 'all' | 'own' | 'today';
export type AccessDecision = { scope: Scope } | { error: 'missing_permission' | 'today_only' };

/**
 * B.1: `reports:read` sees every report; `reports:read:daily` (reception) sees revenue and collections for today only;
 * `reports:read:own` (doctors) sees attendance and performance for themselves only.
 */
export function reportAccess(perms: readonly string[] | undefined, kind: ReportKind, period: Period | null, today: string): AccessDecision {
  if (hasPermission(perms, 'reports:read')) return { scope: 'all' };
  if (kind === 'revenue' && hasPermission(perms, 'reports:read:daily')) {
    return period && (period.from !== today || period.to !== today) ? { error: 'today_only' } : { scope: 'today' };
  }
  if ((kind === 'attendance' || kind === 'performance') && hasPermission(perms, 'reports:read:own')) return { scope: 'own' };
  return { error: 'missing_permission' };
}

export interface Period { from: string; to: string }
export const MAX_PERIOD_DAYS = 366;

/** The period asked for, or the month so far (reception: today). Errors are the codes the API returns. */
export function resolvePeriod(q: { from?: string; to?: string }, today: string, dailyOnly: boolean): Period | { error: 'invalid_period' | 'period_too_long' } {
  const from = q.from ?? (dailyOnly ? today : `${today.slice(0, 8)}01`);
  const to = q.to ?? (q.from && q.from > today ? q.from : today);
  if (from > to) return { error: 'invalid_period' };
  if (addDays(from, MAX_PERIOD_DAYS - 1) < to) return { error: 'period_too_long' };
  return { from, to };
}

const add = <K extends string>(m: Map<K, number>, k: K, v: number) => m.set(k, (m.get(k) ?? 0) + v);
const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

// ---------- REPORT-001 revenue and collections ----------
export interface MoneyRow { branch_id: string; day: string; kind: 'invoiced' | 'payment' | 'refund' | 'adjustment'; method: string | null; amount: number; n: number }
interface MoneyFigures { invoiced: number; collected: number; refunded: number; net: number; adjusted: number }

function figures(rows: readonly MoneyRow[]): MoneyFigures {
  const by = (k: MoneyRow['kind']) => sum(rows.filter((r) => r.kind === k).map((r) => r.amount));
  const collected = by('payment');
  const refunded = by('refund');
  return { invoiced: by('invoiced'), collected, refunded, net: collected - refunded, adjusted: by('adjustment') };
}

function groupBy<T, K>(rows: readonly T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
}

/** Totals; collections and refunds per method (net = collected − refunded); per branch; per day (oldest first). */
export function revenueReport(rows: readonly MoneyRow[]) {
  const count = (k: MoneyRow['kind']) => sum(rows.filter((r) => r.kind === k).map((r) => r.n));
  const methods = groupBy(rows.filter((r) => r.kind === 'payment' || r.kind === 'refund'), (r) => r.method ?? 'unknown');
  return {
    totals: { ...figures(rows), invoices: count('invoiced'), payments: count('payment'), refunds: count('refund') },
    by_method: [...methods].map(([method, rs]) => {
      const f = figures(rs);
      return { method, collected: f.collected, refunded: f.refunded, net: f.net };
    }).sort((a, b) => b.collected - a.collected),
    adjustments: [...groupBy(rows.filter((r) => r.kind === 'adjustment'), (r) => r.method ?? 'unknown')].map(([kind, rs]) => ({ kind, amount: sum(rs.map((r) => r.amount)), n: sum(rs.map((r) => r.n)) })),
    by_branch: [...groupBy(rows, (r) => r.branch_id)].map(([branch_id, rs]) => ({ branch_id, ...figures(rs) })).sort((a, b) => b.net - a.net),
    by_day: [...groupBy(rows, (r) => r.day)].map(([day, rs]) => ({ day, ...figures(rs) })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

/** Collections minus refunds: what the clinic actually kept, as the cash-basis line of the expenses report uses. */
export const netCollections = (rows: readonly MoneyRow[]) => figures(rows).net;

// ---------- REPORT-002 expenses ----------
export interface ExpenseRow { branch_id: string; day: string; category_id: string; method: string | null; status: 'approved' | 'pending' | 'rejected'; amount: number; n: number }

/**
 * Counted: approved and still-pending expenses (as the expenses screen totals them). Rejected ones are listed apart:
 * the money left the drawer but the owner did not accept it. Voided ones were recorded in error and never reach here.
 * The cash-basis result is net collections minus counted expenses.
 */
export function expensesReport(rows: readonly ExpenseRow[], collectionsNet: number) {
  const counted = rows.filter((r) => r.status !== 'rejected');
  const total = sum(counted.map((r) => r.amount));
  const roll = <K>(key: (r: ExpenseRow) => K) => [...groupBy(counted, key)].map(([k, rs]) => ({ key: k, amount: sum(rs.map((r) => r.amount)), n: sum(rs.map((r) => r.n)) }))
    .sort((a, b) => b.amount - a.amount);
  return {
    totals: {
      total, count: sum(counted.map((r) => r.n)),
      approved: sum(rows.filter((r) => r.status === 'approved').map((r) => r.amount)),
      pending: sum(rows.filter((r) => r.status === 'pending').map((r) => r.amount)),
      rejected: sum(rows.filter((r) => r.status === 'rejected').map((r) => r.amount)),
      collections_net: collectionsNet, result: collectionsNet - total,
    },
    by_category: roll((r) => r.category_id).map(({ key, ...v }) => ({ category_id: key, ...v })),
    by_branch: roll((r) => r.branch_id).map(({ key, ...v }) => ({ branch_id: key, ...v })),
    by_method: roll((r) => r.method ?? 'unknown').map(({ key, ...v }) => ({ method: key, ...v })),
    by_day: roll((r) => r.day).map(({ key, ...v }) => ({ day: key, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

// ---------- REPORT-003 attendance ----------
export interface AttendanceRow { branch_id: string; doctor_id: string; status: string; n: number }
const NOT_YET = new Set(['pending', 'confirmed']);
const ATTENDED = new Set(['checked_in', 'in_progress', 'completed']);

/**
 * Booked = every appointment in the period. Cancellation rate = cancelled ÷ booked. No-show rate = no-shows ÷ the
 * appointments that came due (booked − cancelled − still pending or confirmed), so a period running into the future
 * does not dilute it. A rate is null when there is nothing to divide by.
 */
export function attendanceFigures(rows: readonly AttendanceRow[]) {
  const count = (pick: (s: string) => boolean) => sum(rows.filter((r) => pick(r.status)).map((r) => r.n));
  const booked = count(() => true);
  const cancelled = count((s) => s === 'cancelled');
  const noShow = count((s) => s === 'no_show');
  const due = booked - cancelled - count((s) => NOT_YET.has(s));
  const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10_000) / 10_000 : null);
  return {
    booked, completed: count((s) => s === 'completed'), attended: count((s) => ATTENDED.has(s)), upcoming: count((s) => NOT_YET.has(s)),
    cancelled, no_show: noShow, cancellation_rate: rate(cancelled, booked), no_show_rate: rate(noShow, due),
  };
}

export function attendanceReport(rows: readonly AttendanceRow[]) {
  const statuses = new Map<string, number>();
  for (const r of rows) add(statuses, r.status, r.n);
  return {
    totals: attendanceFigures(rows),
    by_status: [...statuses].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n),
    by_doctor: [...groupBy(rows, (r) => r.doctor_id)].map(([doctor_id, rs]) => ({ doctor_id, ...attendanceFigures(rs) })).sort((a, b) => b.booked - a.booked),
    by_branch: [...groupBy(rows, (r) => r.branch_id)].map(([branch_id, rs]) => ({ branch_id, ...attendanceFigures(rs) })).sort((a, b) => b.booked - a.booked),
  };
}

// ---------- REPORT-005 branch and doctor performance ----------
export interface ProcedureRow { branch_id: string; doctor_id: string; amount: number; n: number }

/**
 * Per branch: completed appointments, procedures (count, value) and net collections. Per doctor: completed
 * appointments and procedures (count, value) — never collections or commissions. A doctor's own view has no branches.
 */
export function performanceReport(att: readonly AttendanceRow[], procs: readonly ProcedureRow[], money: readonly MoneyRow[] | null) {
  const completed = (rs: readonly AttendanceRow[]) => sum(rs.filter((r) => r.status === 'completed').map((r) => r.n));
  const procedures = (rs: readonly ProcedureRow[]) => ({ procedures: sum(rs.map((r) => r.n)), procedures_value: sum(rs.map((r) => r.amount)) });
  const keys = <K extends 'branch_id' | 'doctor_id'>(k: K) => [...new Set([...att.map((r) => r[k]), ...procs.map((r) => r[k])])];
  const by_doctor = keys('doctor_id').map((id) => ({
    doctor_id: id, completed: completed(att.filter((r) => r.doctor_id === id)), ...procedures(procs.filter((r) => r.doctor_id === id)),
  })).sort((a, b) => b.procedures_value - a.procedures_value);
  const by_branch = money === null ? null : [...new Set([...keys('branch_id'), ...money.map((r) => r.branch_id)])].map((id) => ({
    branch_id: id, completed: completed(att.filter((r) => r.branch_id === id)), ...procedures(procs.filter((r) => r.branch_id === id)),
    collections_net: netCollections(money.filter((r) => r.branch_id === id)),
  })).sort((a, b) => b.collections_net - a.collections_net);
  return {
    totals: { completed: completed(att), ...procedures(procs), collections_net: money === null ? null : netCollections(money) },
    by_branch, by_doctor,
  };
}

// ---------- REPORT-004 outstanding balances ----------
export interface OutstandingRow { patient_id: string; branch_id: string; balance: number; invoices: number; oldest: string | null; full_name: string; file_no: number; phone: string | null }
export interface OverdueRow { installment_id: string; invoice_id: string; number: string | null; branch_id: string; patient_id: string; full_name: string; seq: number; due_date: string; remaining: number; days_overdue: number }
export const OUTSTANDING_LIST_LIMIT = 500;

/** One line per patient (their branches together), largest balance first; totals cover every patient even when the list is cut. */
export function outstandingReport(rows: readonly OutstandingRow[], overdue: readonly OverdueRow[]) {
  const patients = [...groupBy(rows, (r) => r.patient_id)].map(([patient_id, rs]) => ({
    patient_id, full_name: rs[0].full_name, file_no: rs[0].file_no, phone: rs[0].phone,
    balance: sum(rs.map((r) => r.balance)), invoices: sum(rs.map((r) => r.invoices)),
    oldest: rs.map((r) => r.oldest).filter((d): d is string => !!d).sort()[0] ?? null, branch_ids: rs.map((r) => r.branch_id),
  })).sort((a, b) => b.balance - a.balance || a.full_name.localeCompare(b.full_name));
  const sortedOverdue = [...overdue].sort((a, b) => b.days_overdue - a.days_overdue || b.remaining - a.remaining);
  return {
    totals: {
      balance: sum(patients.map((p) => p.balance)), patients: patients.length, invoices: sum(patients.map((p) => p.invoices)),
      overdue: sum(overdue.map((o) => o.remaining)), overdue_installments: overdue.length,
    },
    patients: patients.slice(0, OUTSTANDING_LIST_LIMIT),
    overdue: sortedOverdue.slice(0, OUTSTANDING_LIST_LIMIT),
    truncated: patients.length > OUTSTANDING_LIST_LIMIT || overdue.length > OUTSTANDING_LIST_LIMIT,
  };
}

// ---------- REPORT-006 the home screen per role ----------
export interface HomeSections {
  /** today's appointments: the member's own (a doctor) or every one at their branches */
  appointments: 'mine' | 'all' | null;
  followUps: 'mine' | 'all' | null;
  cash: boolean;
  /** today's collections (reception and up) */
  todayMoney: boolean;
  /** today and month: revenue, collections, expenses, outstanding, no-shows (owner, accountant) */
  finance: boolean;
}

/**
 * Which blocks a member's home shows: each is shown exactly when the API would serve its data (B.1). A doctor
 * (writes only their own appointments) sees their own day and their own follow-ups.
 */
export function homeSections(perms: readonly string[] | undefined): HomeSections {
  const has = (p: string) => hasPermission(perms, p);
  const own = !has('appointments:write') && has('appointments:write:own');
  return {
    appointments: has('appointments:read') ? (own ? 'mine' : 'all') : null,
    followUps: has('patients:read') ? (own ? 'mine' : 'all') : null,
    cash: has('cash:operate'),
    todayMoney: has('reports:read') || has('reports:read:daily'),
    finance: has('reports:read'),
  };
}
