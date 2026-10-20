import {
  attendanceFigures, bucketKeys, expensesReport, homeSections, outstandingReport, performanceReport, previousPeriod, reportAccess, resolvePeriod, revenueReport,
  statsBucket, statsReport,
  type AttendanceRow, type ExpenseRow, type MoneyRow, type OutstandingRow,
} from '../reports-rules';

const today = '2026-10-19';

describe('who sees which report (B.1)', () => {
  it('reports:read sees everything; owners hold *', () => {
    expect(reportAccess(['reports:read'], 'outstanding', null, today)).toEqual({ scope: 'all' });
    expect(reportAccess(['*'], 'performance', { from: '2026-01-01', to: today }, today)).toEqual({ scope: 'all' });
  });
  it('reception sees today’s revenue and collections only', () => {
    const reception = ['reports:read:daily'];
    expect(reportAccess(reception, 'revenue', null, today)).toEqual({ scope: 'today' });
    expect(reportAccess(reception, 'revenue', { from: today, to: today }, today)).toEqual({ scope: 'today' });
    expect(reportAccess(reception, 'revenue', { from: '2026-10-18', to: today }, today)).toEqual({ error: 'today_only' });
    expect(reportAccess(reception, 'expenses', null, today)).toEqual({ error: 'missing_permission' });
  });
  it('a doctor sees their own attendance and performance, nothing else', () => {
    const doctor = ['reports:read:own'];
    expect(reportAccess(doctor, 'attendance', null, today)).toEqual({ scope: 'own' });
    expect(reportAccess(doctor, 'performance', null, today)).toEqual({ scope: 'own' });
    expect(reportAccess(doctor, 'revenue', null, today)).toEqual({ error: 'missing_permission' });
    expect(reportAccess(doctor, 'outstanding', null, today)).toEqual({ error: 'missing_permission' });
  });
  it('without a report right, nothing', () => {
    expect(reportAccess(['patients:read'], 'revenue', null, today)).toEqual({ error: 'missing_permission' });
    expect(reportAccess(undefined, 'attendance', null, today)).toEqual({ error: 'missing_permission' });
  });
});

describe('the period', () => {
  it('defaults to the month so far, or today for reception', () => {
    expect(resolvePeriod({}, today, false)).toEqual({ from: '2026-10-01', to: today });
    expect(resolvePeriod({}, today, true)).toEqual({ from: today, to: today });
    expect(resolvePeriod({ from: '2026-09-01' }, today, false)).toEqual({ from: '2026-09-01', to: today });
  });
  it('ends after it starts and covers at most a year', () => {
    expect(resolvePeriod({ from: '2026-10-05', to: '2026-10-04' }, today, false)).toEqual({ error: 'invalid_period' });
    expect(resolvePeriod({ from: '2025-10-19', to: '2026-10-19' }, today, false)).toEqual({ from: '2025-10-19', to: '2026-10-19' });
    expect(resolvePeriod({ from: '2025-10-18', to: '2026-10-19' }, today, false)).toEqual({ error: 'period_too_long' });
  });
});

const row = (r: Partial<MoneyRow> & Pick<MoneyRow, 'kind' | 'amount'>): MoneyRow => ({ branch_id: 'A', day: '2026-10-01', method: null, n: 1, ...r });

describe('revenue and collections (REPORT-001)', () => {
  const rows: MoneyRow[] = [
    row({ kind: 'invoiced', amount: 100_000, n: 2 }),
    row({ kind: 'payment', method: 'cash', amount: 50_000, n: 2 }),
    row({ kind: 'payment', method: 'card', amount: 20_000 }),
    row({ kind: 'refund', method: 'cash', amount: 5_000 }),
    row({ kind: 'payment', method: 'cash', amount: 30_000, branch_id: 'B', day: '2026-10-02' }),
    row({ kind: 'adjustment', method: 'write_off', amount: 1_000 }),
  ];
  const r = revenueReport(rows);
  it('totals are the sums of the rows; net = collected − refunded', () => {
    expect(r.totals).toEqual({ invoiced: 100_000, collected: 100_000, refunded: 5_000, net: 95_000, adjusted: 1_000, invoices: 2, payments: 4, refunds: 1 });
  });
  it('per method, branch and day add up to the totals', () => {
    expect(r.by_method).toEqual([{ method: 'cash', collected: 80_000, refunded: 5_000, net: 75_000 }, { method: 'card', collected: 20_000, refunded: 0, net: 20_000 }]);
    expect(r.by_branch.map((b) => b.net).reduce((a, b) => a + b)).toBe(r.totals.net);
    expect(r.by_day.map((d) => d.day)).toEqual(['2026-10-01', '2026-10-02']);
    expect(r.by_day.map((d) => d.collected).reduce((a, b) => a + b)).toBe(r.totals.collected);
    expect(r.adjustments).toEqual([{ kind: 'write_off', amount: 1_000, n: 1 }]);
  });
  it('an empty period is all zeros', () => {
    expect(revenueReport([]).totals).toMatchObject({ invoiced: 0, collected: 0, net: 0 });
  });
});

describe('expenses (REPORT-002)', () => {
  const r = expensesReport([
    { branch_id: 'A', day: '2026-10-01', category_id: 'rent', method: 'bank_transfer', status: 'approved', amount: 300_000, n: 1 },
    { branch_id: 'A', day: '2026-10-02', category_id: 'supplies', method: 'cash', status: 'pending', amount: 20_000, n: 2 },
    { branch_id: 'B', day: '2026-10-02', category_id: 'supplies', method: 'cash', status: 'rejected', amount: 7_000, n: 1 },
  ], 400_000);
  it('counts approved and pending; rejected stays apart; the cash-basis result is collections − expenses', () => {
    expect(r.totals).toEqual({ total: 320_000, count: 3, approved: 300_000, pending: 20_000, rejected: 7_000, collections_net: 400_000, result: 80_000 });
    expect(r.by_category).toEqual([{ category_id: 'rent', amount: 300_000, n: 1 }, { category_id: 'supplies', amount: 20_000, n: 2 }]);
    expect(r.by_branch).toEqual([{ branch_id: 'A', amount: 320_000, n: 3 }]);
    expect(r.by_method.map((m) => m.amount).reduce((a, b) => a + b)).toBe(r.totals.total);
  });
});

describe('attendance (REPORT-003)', () => {
  const a = (status: string, n: number, doctor_id = 'd1'): AttendanceRow => ({ branch_id: 'A', doctor_id, status, n });
  it('cancellation rate over everything booked; no-show rate over what came due', () => {
    const f = attendanceFigures([a('completed', 6), a('no_show', 2), a('cancelled', 2), a('confirmed', 10)]);
    expect(f).toEqual({ booked: 20, completed: 6, attended: 6, upcoming: 10, cancelled: 2, no_show: 2, cancellation_rate: 0.1, no_show_rate: 0.25 });
  });
  it('nothing to divide by gives no rate', () => {
    expect(attendanceFigures([])).toMatchObject({ booked: 0, cancellation_rate: null, no_show_rate: null });
    expect(attendanceFigures([a('pending', 3)])).toMatchObject({ cancellation_rate: 0, no_show_rate: null });
  });
});

describe('branch and doctor performance (REPORT-005)', () => {
  const att: AttendanceRow[] = [{ branch_id: 'A', doctor_id: 'd1', status: 'completed', n: 3 }, { branch_id: 'B', doctor_id: 'd2', status: 'completed', n: 1 }];
  const procs = [{ branch_id: 'A', doctor_id: 'd1', amount: 90_000, n: 4 }, { branch_id: 'B', doctor_id: 'd1', amount: 10_000, n: 1 }];
  it('per branch with net collections; per doctor without', () => {
    const r = performanceReport(att, procs, [row({ kind: 'payment', method: 'cash', amount: 50_000 }), row({ kind: 'refund', method: 'cash', amount: 10_000 })]);
    expect(r.totals).toEqual({ completed: 4, procedures: 5, procedures_value: 100_000, collections_net: 40_000 });
    expect(r.by_branch).toEqual([
      { branch_id: 'A', completed: 3, procedures: 4, procedures_value: 90_000, collections_net: 40_000 },
      { branch_id: 'B', completed: 1, procedures: 1, procedures_value: 10_000, collections_net: 0 },
    ]);
    expect(r.by_doctor).toEqual([
      { doctor_id: 'd1', completed: 3, procedures: 5, procedures_value: 100_000 },
      { doctor_id: 'd2', completed: 1, procedures: 0, procedures_value: 0 },
    ]);
  });
  it('a doctor’s own view has no branches and no collections', () => {
    const r = performanceReport(att.slice(0, 1), procs, null);
    expect(r.by_branch).toBeNull();
    expect(r.totals.collections_net).toBeNull();
  });
});

describe('outstanding balances (REPORT-004)', () => {
  const o = (patient_id: string, branch_id: string, balance: number, oldest: string): OutstandingRow =>
    ({ patient_id, branch_id, balance, invoices: 1, oldest, full_name: patient_id, file_no: 1, phone: null });
  it('one line per patient across branches, largest first; totals cover everyone', () => {
    const r = outstandingReport([o('p1', 'A', 1_000, '2026-09-01'), o('p2', 'A', 5_000, '2026-10-01'), o('p1', 'B', 500, '2026-08-01')], [
      { installment_id: 'i1', invoice_id: 'v1', number: 'INV-1', branch_id: 'A', patient_id: 'p1', full_name: 'p1', seq: 1, due_date: '2026-10-01', remaining: 300, days_overdue: 18 },
      { installment_id: 'i2', invoice_id: 'v1', number: 'INV-1', branch_id: 'A', patient_id: 'p1', full_name: 'p1', seq: 2, due_date: '2026-10-10', remaining: 300, days_overdue: 9 },
    ]);
    expect(r.totals).toEqual({ balance: 6_500, patients: 2, invoices: 3, overdue: 600, overdue_installments: 2 });
    expect(r.patients.map((p) => [p.patient_id, p.balance, p.oldest, p.branch_ids])).toEqual([['p2', 5_000, '2026-10-01', ['A']], ['p1', 1_500, '2026-08-01', ['A', 'B']]]);
    expect(r.overdue.map((x) => x.days_overdue)).toEqual([18, 9]);
    expect(r.truncated).toBe(false);
  });
});

describe('home screen per role (REPORT-006)', () => {
  const roles = {
    owner: ['*'],
    reception: ['branches:read', 'patients:read', 'appointments:read', 'appointments:write', 'invoices:read', 'payments:write', 'reports:read:daily', 'cash:operate'],
    doctor: ['patients:read', 'clinical:read', 'appointments:read', 'appointments:write:own', 'reports:read:own'],
    accountant: ['patients:read', 'appointments:read', 'invoices:read', 'reports:read', 'cash:operate'],
    assistant: ['patients:read', 'appointments:read', 'appointments:write'],
  };
  it('reception: today’s appointments and waiting list, today’s collections, the cash box', () => {
    expect(homeSections(roles.reception)).toEqual({ appointments: 'all', followUps: 'all', cash: true, todayMoney: true, finance: false });
  });
  it('doctor: my day, waiting for me, my follow-ups — no money', () => {
    expect(homeSections(roles.doctor)).toEqual({ appointments: 'mine', followUps: 'mine', cash: false, todayMoney: false, finance: false });
  });
  it('owner and accountant: the money of today and the month', () => {
    expect(homeSections(roles.owner)).toEqual({ appointments: 'all', followUps: 'all', cash: true, todayMoney: true, finance: true });
    expect(homeSections(roles.accountant)).toMatchObject({ todayMoney: true, finance: true, cash: true });
  });
  it('an assistant sees the day, nothing financial', () => {
    expect(homeSections(roles.assistant)).toEqual({ appointments: 'all', followUps: 'all', cash: false, todayMoney: false, finance: false });
  });
});

describe('statistics (owner 2026-10-21)', () => {
  it('only reports:read opens them (owner and accountant)', () => {
    expect(reportAccess(['reports:read'], 'stats', null, today)).toEqual({ scope: 'all' });
    expect(reportAccess(['reports:read:daily'], 'stats', null, today)).toEqual({ error: 'missing_permission' });
    expect(reportAccess(['reports:read:own'], 'stats', null, today)).toEqual({ error: 'missing_permission' });
  });

  it('this month so far is compared with the same days of last month, cut at the end of that month', () => {
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-21' })).toEqual({ from: '2026-09-01', to: '2026-09-21' });
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriod({ from: '2028-03-01', to: '2028-03-31' })).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(previousPeriod({ from: '2026-01-01', to: '2026-01-15' })).toEqual({ from: '2025-12-01', to: '2025-12-15' });
  });

  it('any other period is compared with as many days just before it', () => {
    expect(previousPeriod({ from: '2026-10-10', to: '2026-10-19' })).toEqual({ from: '2026-09-30', to: '2026-10-09' });
    expect(previousPeriod({ from: '2026-09-01', to: '2026-10-21' })).toEqual({ from: '2026-07-12', to: '2026-08-31' });
    expect(previousPeriod({ from: today, to: today })).toEqual({ from: '2026-10-18', to: '2026-10-18' });
  });

  it('the chart goes by day up to 62 days, by month beyond, with every bucket present', () => {
    expect(statsBucket({ from: '2026-09-01', to: '2026-10-31' })).toBe('day'); // 61 days
    expect(statsBucket({ from: '2026-08-01', to: '2026-10-31' })).toBe('month');
    expect(bucketKeys({ from: '2026-10-30', to: '2026-11-02' }, 'day')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(bucketKeys({ from: '2025-11-15', to: '2026-02-03' }, 'month')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('every figure comes from its own report, and the series adds up to the totals', () => {
    const money: MoneyRow[] = [
      { branch_id: 'a', day: '2026-10-02', kind: 'invoiced', method: null, amount: 50000, n: 1 },
      { branch_id: 'a', day: '2026-10-02', kind: 'payment', method: 'cash', amount: 30000, n: 1 },
      { branch_id: 'a', day: '2026-10-03', kind: 'refund', method: 'cash', amount: 5000, n: 1 },
    ];
    const expenses: ExpenseRow[] = [
      { branch_id: 'a', day: '2026-10-03', category_id: 'c', method: 'cash', status: 'approved', amount: 8000, n: 1 },
      { branch_id: 'a', day: '2026-10-03', category_id: 'c', method: 'cash', status: 'rejected', amount: 9999, n: 1 },
    ];
    const attendance: AttendanceRow[] = [{ branch_id: 'a', doctor_id: 'd', status: 'completed', n: 3 }, { branch_id: 'a', doctor_id: 'd', status: 'no_show', n: 1 }];
    const empty = { money: [], expenses: [], attendance: [], newPatients: [] };
    const period = { from: '2026-10-01', to: '2026-10-03' };
    const r = statsReport({ money, expenses, attendance, newPatients: [{ branch_id: 'a', day: '2026-10-02', n: 2 }] }, empty, period, previousPeriod(period));

    const rev = revenueReport(money).totals;
    expect(r.totals).toMatchObject({ invoiced: rev.invoiced, collections_net: rev.net, expenses: 8000, result: expensesReport(expenses, rev.net).totals.result, new_patients: 2 });
    expect(r.totals.result).toBe(25000 - 8000); // the expenses report's result: net collections − counted expenses
    expect(r.totals.appointments).toEqual(attendanceFigures(attendance));
    expect(r.previous).toMatchObject({ invoiced: 0, collections_net: 0, expenses: 0, result: 0, new_patients: 0 });
    expect(r).toMatchObject({ bucket: 'day', previous_period: { from: '2026-09-01', to: '2026-09-03' } });
    expect(r.series.map((x) => x.key)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    for (const k of ['invoiced', 'collections_net', 'expenses', 'result', 'new_patients'] as const) {
      expect(r.series.reduce((t, x) => t + x[k], 0)).toBe(r.totals[k]);
    }
  });
});
