import { useState, type ReactNode } from 'react';
import { arName } from '@dental/ui/text';
import { can, type Session } from '../../api';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { csvFileName, downloadCsv, pounds, toCsv, type CsvCell } from '../../csv';
import { localToday } from '../../finance-model';
import { t, type Key } from '../../i18n';
import { currencyLabel, money } from '../../money';
import { useProfile, useReport, useReportBranches } from '../../queries';
import { dailyOnly, percent, PRESETS, presetOf, presetPeriod, reportTabs, type ReportTab } from '../../reports-model';
import { to } from '../../router';
import type { AttendanceFigures, AttendanceReport, ExpensesReport, OutstandingReport, PerformanceReport, ReportBranch, ReportFrame, ReportName, RevenueReport } from '../../types';
import { Alert, Button, Card, EmptyState, ErrorText, Field, PageHeader, Skeleton } from '../../ui/components';
import { ChartIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';

const TAB_TITLE: Record<ReportTab, Key> = {
  revenue: 'rep_revenue', expenses: 'rep_expenses', attendance: 'rep_attendance', performance: 'rep_performance', outstanding: 'rep_outstanding',
};

/**
 * `#/reports` (SRS REPORT-001…005): revenue and collections, expenses, attendance, branch and doctor performance, and
 * outstanding balances, for a period and one branch or all of the member's branches. Every figure comes from recorded
 * transactions and adds up to the rows under it. The page is its own printout (A4): the controls do not print.
 * Reception sees today's revenue only; a doctor sees their own attendance and performance.
 */
export function Reports({ clinicId, session, query }: { clinicId: string; session: Session; query?: Record<string, string> }) {
  const has = (p: string) => can(session, p);
  const tabs = reportTabs(has);
  const daily = dailyOnly(has);
  const today = localToday();
  const [tab, setTab] = useState<ReportTab | undefined>(() => tabs.find((x) => x === query?.tab) ?? tabs[0]);
  const [period, setPeriod] = useState(() => presetPeriod(daily ? 'today' : 'thisMonth', today));
  const [branchId, setBranchId] = useState('');
  const branches = useReportBranches(clinicId);
  if (!tab) return <Card><EmptyState icon={<ChartIcon size={28} />} title={t('noReports')} text={t('noReportsText')} /></Card>;
  const list = branches.data ?? [];
  const preset = presetOf(period, today);
  const q = { ...(daily || tab === 'outstanding' ? {} : period), branchId: branchId || undefined };
  return (
    <>
      <div className="no-print">
        <PageHeader title={t('navReports')} sub={t(daily ? 'reportsSubDaily' : 'reportsSub')}
          action={<Button variant="secondary" onClick={() => window.print()}>{t('print')}</Button>} />
        <Card>
          {tabs.length > 1 && (
            <div className="seg" role="group" aria-label={t('navReports')}>
              {tabs.map((x) => (
                <button key={x} type="button" className={`seg-btn${x === tab ? ' is-on' : ''}`} aria-pressed={x === tab} onClick={() => setTab(x)}>{t(TAB_TITLE[x])}</button>
              ))}
            </div>
          )}
          <div className="report-filters mt">
            {!daily && tab !== 'outstanding' && (
              <>
                <div className="seg" aria-label={t('period')}>
                  {PRESETS.map((p) => (
                    <button key={p} type="button" className={`seg-btn${p === preset ? ' is-on' : ''}`} aria-pressed={p === preset} onClick={() => setPeriod(presetPeriod(p, today))}>
                      {t(`preset_${p}` as Key)}
                    </button>
                  ))}
                </div>
                <div className="period">
                  <DatePicker label={t('fromDate')} value={period.from} onChange={(from) => setPeriod((x) => ({ ...x, from }))} max={period.to} />
                  <DatePicker label={t('toDate')} value={period.to} onChange={(to) => setPeriod((x) => ({ ...x, to }))} min={period.from} />
                </div>
              </>
            )}
            {list.length > 1 && (
              <Field label={t('branch')}>
                {(a) => <Choice id={a.id} value={branchId} onChange={setBranchId} noneLabel={t('allBranches')}
                  options={list.map((b) => ({ value: b.id, label: arName(b.name_ar, b.name_en) }))} />}
              </Field>
            )}
          </div>
          {daily && <p className="muted small mt-sm">{t('reportsDailyNote')}</p>}
        </Card>
      </div>
      <ReportBody key={tab} clinicId={clinicId} tab={tab} q={q} branches={list} />
    </>
  );
}

type Q = { from?: string; to?: string; branchId?: string };

function ReportBody({ clinicId, tab, q, branches }: { clinicId: string; tab: ReportTab; q: Q; branches: ReportBranch[] }) {
  const r = useReport<ReportFrame>(clinicId, tab, q);
  if (r.isError) return <Card><ErrorText error={r.error} onRetry={() => void r.refetch()} /></Card>;
  if (!r.data) return <Skeleton h={96} count={3} />;
  const data = r.data;
  return (
    <>
      <style>{'@page { size: A4; margin: 12mm; }'}</style>
      <article className="rx-sheet report-sheet" dir={'rtl'}>
        <PrintHead clinicId={clinicId} title={t(TAB_TITLE[tab])} frame={data} branches={branches} />
        {tab === 'revenue' && <Revenue r={data as RevenueReport} />}
        {tab === 'expenses' && <Expenses r={data as ExpensesReport} />}
        {tab === 'attendance' && <Attendance r={data as AttendanceReport} />}
        {tab === 'performance' && <Performance r={data as PerformanceReport} />}
        {tab === 'outstanding' && <Outstanding r={data as OutstandingReport} branches={branches} />}
      </article>
    </>
  );
}

/** What only the printout carries: the clinic, the report, its period and branch, and when it was printed. */
function PrintHead({ clinicId, title, frame, branches }: { clinicId: string; title: string; frame: ReportFrame; branches: ReportBranch[] }) {
  const clinic = useProfile(clinicId).data;
  const branch = branches.find((b) => b.id === frame.branch_id);
  return (
    <header className="rx-head print-only">
      <div>
        <h1 className="rx-clinic">{clinic ? arName(clinic.nameAr, clinic.nameEn) : ''}</h1>
        <p className="rx-doc-title">{title}</p>
        <p className="rx-branch">
          {frame.period ? `${t('fromDate')} ${frame.period.from} ${t('toDate')} ${frame.period.to}` : `${t('asOf')} ${frame.today}`}
          {' · '}{branch ? arName(branch.name_ar, branch.name_en) : t('allBranches')}
        </p>
      </div>
      {clinic?.logo && <img className="rx-logo" src={clinic.logo.thumbUrl} alt="" />}
    </header>
  );
}

// ---------- building blocks ----------
const name = (n: ReportName) => (n ? arName(n.name_ar, n.name_en) : '—');
/** An expense method; expenses recorded before methods existed have none ("unknown"). */
const methodName = (m: string) => (m === 'unknown' ? t('repUnknownMethod') : t(`pm_${m}` as Key));
/** A rate as a plain percentage for a spreadsheet (12.5), as `percent()` shows it. */
const pct = (rate: number | null): number | null => (rate === null ? null : Math.round(rate * 1000) / 10);

/**
 * What a table exports (one CSV file per table): the raw cells behind what it shows, in the same order — amounts in
 * pounds, counts and rates as numbers, dates as YYYY-MM-DD. `money` and `rates` are column indexes whose header gets
 * the currency or "%" (the cells carry plain numbers).
 */
interface CsvSpec { frame: ReportFrame; table: string; rows: CsvCell[][]; foot?: CsvCell[]; money?: number[]; rates?: number[] }

function exportTable(head: string[], c: CsvSpec) {
  const header = head.map((h, i) => (c.money?.includes(i) ? `${h} (${currencyLabel(c.frame.currency)})` : c.rates?.includes(i) ? `${h} (%)` : h));
  const when = c.frame.period ? [c.frame.period.from, c.frame.period.to] : [c.frame.today];
  downloadCsv(csvFileName(c.frame.kind, c.table, ...when), toCsv(header, c.rows, c.foot));
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat report-tile">
      <span className="stat-text">
        <small>{label}</small>
        <strong><bdi>{value}</bdi></strong>
        {note && <small>{note}</small>}
      </span>
    </div>
  );
}

/** A table whose first `text` columns are words and the rest figures (aligned to the end); `csv` adds its export. */
function Table({ caption, head, rows, foot, text = 1, csv }: { caption: string; head: string[]; rows: ReactNode[][]; foot?: ReactNode[]; text?: number; csv?: CsvSpec }) {
  const cls = (i: number) => (i < text ? undefined : 'num');
  return (
    <Card className="report-card">
      <div className="row-between">
        <h2>{caption}</h2>
        {csv && <Button variant="ghost" className="no-print" onClick={() => exportTable(head, csv)} aria-label={`${t('exportCsv')}: ${caption}`}>{t('exportCsv')}</Button>}
      </div>
      <div className="table-wrap">
        <table className="report-table">
          <thead><tr>{head.map((h, i) => <th key={i} scope="col" className={cls(i)}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={cls(j)}>{c}</td>)}</tr>)}</tbody>
          {foot && <tfoot><tr>{foot.map((c, j) => <td key={j} className={cls(j)}>{c}</td>)}</tr></tfoot>}
        </table>
      </div>
    </Card>
  );
}

function Nothing() {
  return <Card><EmptyState icon={<ChartIcon size={28} />} title={t('reportEmpty')} text={t('reportEmptyText')} /></Card>;
}

// ---------- REPORT-001 revenue and collections ----------
function Revenue({ r }: { r: RevenueReport }) {
  const m = (v: number) => <bdi>{money(v, r.currency)}</bdi>;
  const T = r.totals;
  return (
    <>
      <div className="stats">
        <Tile label={t('repInvoiced')} value={money(T.invoiced, r.currency)} note={t('repInvoicesCount').replace('{n}', fmtNumber(T.invoices))} />
        <Tile label={t('repCollected')} value={money(T.collected, r.currency)} note={t('repPaymentsCount').replace('{n}', fmtNumber(T.payments))} />
        <Tile label={t('repRefunded')} value={money(T.refunded, r.currency)} />
        <Tile label={t('repNet')} value={money(T.net, r.currency)} />
      </div>
      {!T.invoices && !T.payments && !T.refunds && !T.adjusted ? <Nothing /> : (
        <>
          <Table caption={t('repByMethod')} head={[t('paymentMethod'), t('repCollected'), t('repRefunded'), t('repNet')]}
            rows={r.by_method.map((x) => [t(`pm_${x.method}` as Key), m(x.collected), m(x.refunded), m(x.net)])}
            foot={[t('total'), m(T.collected), m(T.refunded), m(T.net)]}
            csv={{ frame: r, table: 'by-method', money: [1, 2, 3],
              rows: r.by_method.map((x) => [t(`pm_${x.method}` as Key), pounds(x.collected), pounds(x.refunded), pounds(x.net)]),
              foot: [t('total'), pounds(T.collected), pounds(T.refunded), pounds(T.net)] }} />
          {r.adjustments.length > 0 && (
            <Table caption={t('repAdjustments')} head={[t('repKind'), t('repCount'), t('amount')]}
              rows={r.adjustments.map((x) => [t(`adj_${x.kind}` as Key), fmtNumber(x.n), m(x.amount)])}
              csv={{ frame: r, table: 'adjustments', money: [2], rows: r.adjustments.map((x) => [t(`adj_${x.kind}` as Key), x.n, pounds(x.amount)]) }} />
          )}
          {r.by_branch.length > 1 && (
            <Table caption={t('repByBranch')} head={[t('branch'), t('repInvoiced'), t('repCollected'), t('repRefunded'), t('repNet')]}
              rows={r.by_branch.map((x) => [name(x.branch), m(x.invoiced), m(x.collected), m(x.refunded), m(x.net)])}
              foot={[t('total'), m(T.invoiced), m(T.collected), m(T.refunded), m(T.net)]}
              csv={{ frame: r, table: 'by-branch', money: [1, 2, 3, 4],
                rows: r.by_branch.map((x) => [name(x.branch), pounds(x.invoiced), pounds(x.collected), pounds(x.refunded), pounds(x.net)]),
                foot: [t('total'), pounds(T.invoiced), pounds(T.collected), pounds(T.refunded), pounds(T.net)] }} />
          )}
          {r.by_day.length > 1 && (
            <Table caption={t('repByDay')} head={[t('date'), t('repInvoiced'), t('repCollected'), t('repRefunded'), t('repNet')]}
              rows={r.by_day.map((x) => [x.day, m(x.invoiced), m(x.collected), m(x.refunded), m(x.net)])}
              foot={[t('total'), m(T.invoiced), m(T.collected), m(T.refunded), m(T.net)]}
              csv={{ frame: r, table: 'by-day', money: [1, 2, 3, 4],
                rows: r.by_day.map((x) => [x.day, pounds(x.invoiced), pounds(x.collected), pounds(x.refunded), pounds(x.net)]),
                foot: [t('total'), pounds(T.invoiced), pounds(T.collected), pounds(T.refunded), pounds(T.net)] }} />
          )}
        </>
      )}
      <p className="muted small">{t('repRevenueNote')}</p>
    </>
  );
}

// ---------- REPORT-002 expenses ----------
function Expenses({ r }: { r: ExpensesReport }) {
  const m = (v: number) => <bdi>{money(v, r.currency)}</bdi>;
  const T = r.totals;
  return (
    <>
      <div className="stats">
        <Tile label={t('repExpensesTotal')} value={money(T.total, r.currency)}
          note={T.pending ? t('repPendingPart').replace('{amount}', money(T.pending, r.currency)) : undefined} />
        <Tile label={t('repNet')} value={money(T.collections_net, r.currency)} />
        <Tile label={t('repResult')} value={money(T.result, r.currency)} note={t('repResultNote')} />
      </div>
      {T.rejected > 0 && <Alert tone="info">{t('repRejectedNote').replace('{amount}', money(T.rejected, r.currency))}</Alert>}
      {!T.count ? <Nothing /> : (
        <>
          <Table caption={t('byCategory')} head={[t('expenseCategory'), t('repCount'), t('amount')]}
            rows={r.by_category.map((x) => [x.name ?? '—', fmtNumber(x.n), m(x.amount)])} foot={[t('total'), fmtNumber(T.count), m(T.total)]}
            csv={{ frame: r, table: 'by-category', money: [2], rows: r.by_category.map((x) => [x.name ?? '—', x.n, pounds(x.amount)]), foot: [t('total'), T.count, pounds(T.total)] }} />
          <Table caption={t('repByMethod')} head={[t('paymentMethod'), t('repCount'), t('amount')]}
            rows={r.by_method.map((x) => [methodName(x.method), fmtNumber(x.n), m(x.amount)])}
            csv={{ frame: r, table: 'by-method', money: [2], rows: r.by_method.map((x) => [methodName(x.method), x.n, pounds(x.amount)]) }} />
          {r.by_branch.length > 1 && (
            <Table caption={t('repByBranch')} head={[t('branch'), t('repCount'), t('amount')]}
              rows={r.by_branch.map((x) => [name(x.branch), fmtNumber(x.n), m(x.amount)])}
              csv={{ frame: r, table: 'by-branch', money: [2], rows: r.by_branch.map((x) => [name(x.branch), x.n, pounds(x.amount)]) }} />
          )}
          {r.by_day.length > 1 && (
            <Table caption={t('repByDay')} head={[t('date'), t('repCount'), t('amount')]}
              rows={r.by_day.map((x) => [x.day, fmtNumber(x.n), m(x.amount)])} foot={[t('total'), fmtNumber(T.count), m(T.total)]}
              csv={{ frame: r, table: 'by-day', money: [2], rows: r.by_day.map((x) => [x.day, x.n, pounds(x.amount)]), foot: [t('total'), T.count, pounds(T.total)] }} />
          )}
        </>
      )}
    </>
  );
}

// ---------- REPORT-003 attendance ----------
function Attendance({ r }: { r: AttendanceReport }) {
  const T = r.totals;
  const n = (v: number) => fmtNumber(v);
  const cells = (x: AttendanceFigures) => [n(x.booked), n(x.completed), n(x.no_show), n(x.cancelled), percent(x.no_show_rate), percent(x.cancellation_rate)];
  const raw = (x: AttendanceFigures): CsvCell[] => [x.booked, x.completed, x.no_show, x.cancelled, pct(x.no_show_rate), pct(x.cancellation_rate)];
  const head = [t('repBooked'), t('status_completed'), t('status_no_show'), t('status_cancelled'), t('repNoShowRate'), t('repCancelRate')];
  const rates = [5, 6]; // after the name column
  return (
    <>
      <div className="stats">
        <Tile label={t('repBooked')} value={n(T.booked)} note={T.upcoming ? t('repUpcoming').replace('{n}', n(T.upcoming)) : undefined} />
        <Tile label={t('status_completed')} value={n(T.completed)} />
        <Tile label={t('status_no_show')} value={n(T.no_show)} note={percent(T.no_show_rate)} />
        <Tile label={t('status_cancelled')} value={n(T.cancelled)} note={percent(T.cancellation_rate)} />
      </div>
      {!T.booked ? <Nothing /> : (
        <>
          <Table caption={t('repByDoctor')} head={[t('doctor'), ...head]} rows={r.by_doctor.map((x) => [name(x.doctor), ...cells(x)])}
            foot={r.by_doctor.length > 1 ? [t('total'), ...cells(T)] : undefined}
            csv={{ frame: r, table: 'by-doctor', rates, rows: r.by_doctor.map((x) => [name(x.doctor), ...raw(x)]), foot: r.by_doctor.length > 1 ? [t('total'), ...raw(T)] : undefined }} />
          {r.by_branch.length > 1 && (
            <Table caption={t('repByBranch')} head={[t('branch'), ...head]} rows={r.by_branch.map((x) => [name(x.branch), ...cells(x)])} foot={[t('total'), ...cells(T)]}
              csv={{ frame: r, table: 'by-branch', rates, rows: r.by_branch.map((x) => [name(x.branch), ...raw(x)]), foot: [t('total'), ...raw(T)] }} />
          )}
          <Table caption={t('repByStatus')} head={[t('status'), t('repCount')]} rows={r.by_status.map((x) => [t(`status_${x.status}` as Key), n(x.n)])}
            csv={{ frame: r, table: 'by-status', rows: r.by_status.map((x) => [t(`status_${x.status}` as Key), x.n]) }} />
        </>
      )}
      <p className="muted small">{t('repAttendanceNote')}</p>
    </>
  );
}

// ---------- REPORT-005 branch and doctor performance ----------
function Performance({ r }: { r: PerformanceReport }) {
  const T = r.totals;
  const m = (v: number) => <bdi>{money(v, r.currency)}</bdi>;
  const n = (v: number) => fmtNumber(v);
  return (
    <>
      <div className="stats">
        <Tile label={t('repCompleted')} value={n(T.completed)} />
        <Tile label={t('repProcedures')} value={n(T.procedures)} />
        <Tile label={t('repProceduresValue')} value={money(T.procedures_value, r.currency)} />
        {T.collections_net !== null && <Tile label={t('repNet')} value={money(T.collections_net, r.currency)} />}
      </div>
      {!T.completed && !T.procedures && !T.collections_net ? <Nothing /> : (
        <>
          {r.by_branch && (
            <Table caption={t('repByBranch')} head={[t('branch'), t('repCompleted'), t('repProcedures'), t('repProceduresValue'), t('repNet')]}
              rows={r.by_branch.map((x) => [name(x.branch), n(x.completed), n(x.procedures), m(x.procedures_value), m(x.collections_net)])}
              foot={[t('total'), n(T.completed), n(T.procedures), m(T.procedures_value), m(T.collections_net ?? 0)]}
              csv={{ frame: r, table: 'by-branch', money: [3, 4],
                rows: r.by_branch.map((x) => [name(x.branch), x.completed, x.procedures, pounds(x.procedures_value), pounds(x.collections_net)]),
                foot: [t('total'), T.completed, T.procedures, pounds(T.procedures_value), pounds(T.collections_net ?? 0)] }} />
          )}
          <Table caption={t('repByDoctor')} head={[t('doctor'), t('repCompleted'), t('repProcedures'), t('repProceduresValue')]}
            rows={r.by_doctor.map((x) => [name(x.doctor), n(x.completed), n(x.procedures), m(x.procedures_value)])}
            foot={r.by_doctor.length > 1 ? [t('total'), n(T.completed), n(T.procedures), m(T.procedures_value)] : undefined}
            csv={{ frame: r, table: 'by-doctor', money: [3],
              rows: r.by_doctor.map((x) => [name(x.doctor), x.completed, x.procedures, pounds(x.procedures_value)]),
              foot: r.by_doctor.length > 1 ? [t('total'), T.completed, T.procedures, pounds(T.procedures_value)] : undefined }} />
        </>
      )}
      <p className="muted small">{t(r.scope === 'own' ? 'repPerformanceOwnNote' : 'repPerformanceNote')}</p>
    </>
  );
}

// ---------- REPORT-004 outstanding balances ----------
function Outstanding({ r, branches }: { r: OutstandingReport; branches: ReportBranch[] }) {
  const T = r.totals;
  const m = (v: number) => <bdi>{money(v, r.currency)}</bdi>;
  const n = (v: number) => fmtNumber(v);
  const branchNames = (ids: string[]) => ids.map((id) => { const b = branches.find((x) => x.id === id); return b ? arName(b.name_ar, b.name_en) : '—'; }).join('، ');
  return (
    <>
      <div className="stats">
        <Tile label={t('repOwed')} value={money(T.balance, r.currency)} note={t('repPatientsCount').replace('{n}', n(T.patients))} />
        <Tile label={t('repOverdue')} value={money(T.overdue, r.currency)} note={t('repInstallmentsCount').replace('{n}', n(T.overdue_installments))} />
      </div>
      {r.truncated && <Alert tone="info">{t('repTruncated')}</Alert>}
      {!T.patients ? <Nothing /> : (
        <Table caption={t('repPatientsOwing')} text={4}
          head={[t('patient'), t('fileNo'), t('phone'), t('branch'), t('repInvoicesCol'), t('repOldest'), t('balance')]}
          rows={r.patients.map((p) => [
            <RouteLink key="p" route={to.view('patients', p.patient_id)}><bdi>{p.full_name}</bdi></RouteLink>, n(p.file_no), p.phone ? <bdi dir="ltr">{p.phone}</bdi> : '—',
            branchNames(p.branch_ids), n(p.invoices), p.oldest ?? '—', m(p.balance),
          ])}
          foot={[t('total'), '', '', '', n(T.invoices), '', m(T.balance)]}
          csv={{ frame: r, table: 'patients', money: [6],
            rows: r.patients.map((p) => [p.full_name, p.file_no, p.phone, branchNames(p.branch_ids), p.invoices, p.oldest, pounds(p.balance)]),
            foot: [t('total'), null, null, null, T.invoices, null, pounds(T.balance)] }} />
      )}
      {r.overdue.length > 0 && (
        <Table caption={t('repOverdueInstallments')} text={3}
          head={[t('patient'), t('invoiceNo'), t('branch'), t('repInstallmentNo'), t('dueDate'), t('repDaysOverdue'), t('repRemaining')]}
          rows={r.overdue.map((o) => [
            <RouteLink key="p" route={to.view('patients', o.patient_id)}><bdi>{o.full_name}</bdi></RouteLink>,
            <RouteLink key="i" route={to.invoice(o.invoice_id)}><bdi dir="ltr">{o.number ?? '—'}</bdi></RouteLink>, name(o.branch),
            n(o.seq), o.due_date, n(o.days_overdue), m(o.remaining),
          ])}
          foot={[t('total'), '', '', '', '', '', m(T.overdue)]}
          csv={{ frame: r, table: 'overdue-installments', money: [6],
            rows: r.overdue.map((o) => [o.full_name, o.number, name(o.branch), o.seq, o.due_date, o.days_overdue, pounds(o.remaining)]),
            foot: [t('total'), null, null, null, null, null, pounds(T.overdue)] }} />
      )}
    </>
  );
}
