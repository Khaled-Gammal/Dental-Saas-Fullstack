import { useState, type ReactNode } from 'react';
import { pickName } from '@dental/ui/text';
import { can, type Session } from '../../api';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { localToday } from '../../finance-model';
import { t, type Key, type Lang } from '../../i18n';
import { money } from '../../money';
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
export function Reports({ lang, clinicId, session, query }: { lang: Lang; clinicId: string; session: Session; query?: Record<string, string> }) {
  const has = (p: string) => can(session, p);
  const tabs = reportTabs(has);
  const daily = dailyOnly(has);
  const today = localToday();
  const [tab, setTab] = useState<ReportTab | undefined>(() => tabs.find((x) => x === query?.tab) ?? tabs[0]);
  const [period, setPeriod] = useState(() => presetPeriod(daily ? 'today' : 'thisMonth', today));
  const [branchId, setBranchId] = useState('');
  const branches = useReportBranches(clinicId);
  if (!tab) return <Card><EmptyState icon={<ChartIcon size={28} />} title={t('noReports', lang)} text={t('noReportsText', lang)} /></Card>;
  const list = branches.data ?? [];
  const preset = presetOf(period, today);
  const q = { ...(daily || tab === 'outstanding' ? {} : period), branchId: branchId || undefined };
  return (
    <>
      <div className="no-print">
        <PageHeader title={t('navReports', lang)} sub={t(daily ? 'reportsSubDaily' : 'reportsSub', lang)}
          action={<Button variant="secondary" onClick={() => window.print()}>{t('print', lang)}</Button>} />
        <Card>
          {tabs.length > 1 && (
            <div className="seg" role="tablist" aria-label={t('navReports', lang)}>
              {tabs.map((x) => (
                <button key={x} type="button" className={`seg-btn${x === tab ? ' is-on' : ''}`} role="tab" aria-selected={x === tab} onClick={() => setTab(x)}>{t(TAB_TITLE[x], lang)}</button>
              ))}
            </div>
          )}
          <div className="report-filters mt">
            {!daily && tab !== 'outstanding' && (
              <>
                <div className="seg" aria-label={t('period', lang)}>
                  {PRESETS.map((p) => (
                    <button key={p} type="button" className={`seg-btn${p === preset ? ' is-on' : ''}`} aria-pressed={p === preset} onClick={() => setPeriod(presetPeriod(p, today))}>
                      {t(`preset_${p}` as Key, lang)}
                    </button>
                  ))}
                </div>
                <div className="period">
                  <DatePicker lang={lang} label={t('fromDate', lang)} value={period.from} onChange={(from) => setPeriod((x) => ({ ...x, from }))} max={period.to} />
                  <DatePicker lang={lang} label={t('toDate', lang)} value={period.to} onChange={(to) => setPeriod((x) => ({ ...x, to }))} min={period.from} />
                </div>
              </>
            )}
            {list.length > 1 && (
              <Field label={t('branch', lang)}>
                {(a) => <Choice id={a.id} lang={lang} value={branchId} onChange={setBranchId} noneLabel={t('allBranches', lang)}
                  options={list.map((b) => ({ value: b.id, label: pickName(lang, b.name_ar, b.name_en) }))} />}
              </Field>
            )}
          </div>
          {daily && <p className="muted small mt-sm">{t('reportsDailyNote', lang)}</p>}
        </Card>
      </div>
      <ReportBody key={tab} lang={lang} clinicId={clinicId} tab={tab} q={q} branches={list} />
    </>
  );
}

type Q = { from?: string; to?: string; branchId?: string };

function ReportBody({ lang, clinicId, tab, q, branches }: { lang: Lang; clinicId: string; tab: ReportTab; q: Q; branches: ReportBranch[] }) {
  const r = useReport<ReportFrame>(clinicId, tab, q);
  if (r.isError) return <Card><ErrorText error={r.error} onRetry={() => void r.refetch()} /></Card>;
  if (!r.data) return <Skeleton h={96} count={3} />;
  const data = r.data;
  return (
    <>
      <style>{'@page { size: A4; margin: 12mm; }'}</style>
      <article className="rx-sheet report-sheet" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
        <PrintHead lang={lang} clinicId={clinicId} title={t(TAB_TITLE[tab], lang)} frame={data} branches={branches} />
        {tab === 'revenue' && <Revenue lang={lang} r={data as RevenueReport} />}
        {tab === 'expenses' && <Expenses lang={lang} r={data as ExpensesReport} />}
        {tab === 'attendance' && <Attendance lang={lang} r={data as AttendanceReport} />}
        {tab === 'performance' && <Performance lang={lang} r={data as PerformanceReport} />}
        {tab === 'outstanding' && <Outstanding lang={lang} r={data as OutstandingReport} branches={branches} />}
      </article>
    </>
  );
}

/** What only the printout carries: the clinic, the report, its period and branch, and when it was printed. */
function PrintHead({ lang, clinicId, title, frame, branches }: { lang: Lang; clinicId: string; title: string; frame: ReportFrame; branches: ReportBranch[] }) {
  const clinic = useProfile(clinicId).data;
  const branch = branches.find((b) => b.id === frame.branch_id);
  return (
    <header className="rx-head print-only">
      <div>
        <h1 className="rx-clinic">{clinic ? pickName(lang, clinic.nameAr, clinic.nameEn) : ''}</h1>
        <p className="rx-doc-title">{title}</p>
        <p className="rx-branch">
          {frame.period ? `${t('fromDate', lang)} ${frame.period.from} ${t('toDate', lang)} ${frame.period.to}` : `${t('asOf', lang)} ${frame.today}`}
          {' · '}{branch ? pickName(lang, branch.name_ar, branch.name_en) : t('allBranches', lang)}
        </p>
      </div>
      {clinic?.logo && <img className="rx-logo" src={clinic.logo.thumbUrl} alt="" />}
    </header>
  );
}

// ---------- building blocks ----------
const name = (lang: Lang, n: ReportName) => (n ? pickName(lang, n.name_ar, n.name_en) : '—');

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

/** A table whose first `text` columns are words and the rest figures (aligned to the end). */
function Table({ caption, head, rows, foot, text = 1 }: { caption: string; head: string[]; rows: ReactNode[][]; foot?: ReactNode[]; text?: number }) {
  const cls = (i: number) => (i < text ? undefined : 'num');
  return (
    <Card className="report-card">
      <h2>{caption}</h2>
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

function Nothing({ lang }: { lang: Lang }) {
  return <Card><EmptyState icon={<ChartIcon size={28} />} title={t('reportEmpty', lang)} text={t('reportEmptyText', lang)} /></Card>;
}

// ---------- REPORT-001 revenue and collections ----------
function Revenue({ lang, r }: { lang: Lang; r: RevenueReport }) {
  const m = (v: number) => <bdi>{money(v, lang, r.currency)}</bdi>;
  const T = r.totals;
  return (
    <>
      <div className="stats">
        <Tile label={t('repInvoiced', lang)} value={money(T.invoiced, lang, r.currency)} note={t('repInvoicesCount', lang).replace('{n}', fmtNumber(T.invoices, lang))} />
        <Tile label={t('repCollected', lang)} value={money(T.collected, lang, r.currency)} note={t('repPaymentsCount', lang).replace('{n}', fmtNumber(T.payments, lang))} />
        <Tile label={t('repRefunded', lang)} value={money(T.refunded, lang, r.currency)} />
        <Tile label={t('repNet', lang)} value={money(T.net, lang, r.currency)} />
      </div>
      {!T.invoices && !T.payments && !T.refunds && !T.adjusted ? <Nothing lang={lang} /> : (
        <>
          <Table caption={t('repByMethod', lang)} head={[t('paymentMethod', lang), t('repCollected', lang), t('repRefunded', lang), t('repNet', lang)]}
            rows={r.by_method.map((x) => [t(`pm_${x.method}` as Key, lang), m(x.collected), m(x.refunded), m(x.net)])}
            foot={[t('total', lang), m(T.collected), m(T.refunded), m(T.net)]} />
          {r.adjustments.length > 0 && (
            <Table caption={t('repAdjustments', lang)} head={[t('repKind', lang), t('repCount', lang), t('amount', lang)]}
              rows={r.adjustments.map((x) => [t(`adj_${x.kind}` as Key, lang), fmtNumber(x.n, lang), m(x.amount)])} />
          )}
          {r.by_branch.length > 1 && (
            <Table caption={t('repByBranch', lang)} head={[t('branch', lang), t('repInvoiced', lang), t('repCollected', lang), t('repRefunded', lang), t('repNet', lang)]}
              rows={r.by_branch.map((x) => [name(lang, x.branch), m(x.invoiced), m(x.collected), m(x.refunded), m(x.net)])}
              foot={[t('total', lang), m(T.invoiced), m(T.collected), m(T.refunded), m(T.net)]} />
          )}
          {r.by_day.length > 1 && (
            <Table caption={t('repByDay', lang)} head={[t('date', lang), t('repInvoiced', lang), t('repCollected', lang), t('repRefunded', lang), t('repNet', lang)]}
              rows={r.by_day.map((x) => [x.day, m(x.invoiced), m(x.collected), m(x.refunded), m(x.net)])}
              foot={[t('total', lang), m(T.invoiced), m(T.collected), m(T.refunded), m(T.net)]} />
          )}
        </>
      )}
      <p className="muted small">{t('repRevenueNote', lang)}</p>
    </>
  );
}

// ---------- REPORT-002 expenses ----------
function Expenses({ lang, r }: { lang: Lang; r: ExpensesReport }) {
  const m = (v: number) => <bdi>{money(v, lang, r.currency)}</bdi>;
  const T = r.totals;
  return (
    <>
      <div className="stats">
        <Tile label={t('repExpensesTotal', lang)} value={money(T.total, lang, r.currency)}
          note={T.pending ? t('repPendingPart', lang).replace('{amount}', money(T.pending, lang, r.currency)) : undefined} />
        <Tile label={t('repNet', lang)} value={money(T.collections_net, lang, r.currency)} />
        <Tile label={t('repResult', lang)} value={money(T.result, lang, r.currency)} note={t('repResultNote', lang)} />
      </div>
      {T.rejected > 0 && <Alert tone="info">{t('repRejectedNote', lang).replace('{amount}', money(T.rejected, lang, r.currency))}</Alert>}
      {!T.count ? <Nothing lang={lang} /> : (
        <>
          <Table caption={t('byCategory', lang)} head={[t('expenseCategory', lang), t('repCount', lang), t('amount', lang)]}
            rows={r.by_category.map((x) => [x.name ?? '—', fmtNumber(x.n, lang), m(x.amount)])} foot={[t('total', lang), fmtNumber(T.count, lang), m(T.total)]} />
          <Table caption={t('repByMethod', lang)} head={[t('paymentMethod', lang), t('repCount', lang), t('amount', lang)]}
            rows={r.by_method.map((x) => [x.method === 'unknown' ? t('repUnknownMethod', lang) : t(`pm_${x.method}` as Key, lang), fmtNumber(x.n, lang), m(x.amount)])} />
          {r.by_branch.length > 1 && (
            <Table caption={t('repByBranch', lang)} head={[t('branch', lang), t('repCount', lang), t('amount', lang)]}
              rows={r.by_branch.map((x) => [name(lang, x.branch), fmtNumber(x.n, lang), m(x.amount)])} />
          )}
        </>
      )}
    </>
  );
}

// ---------- REPORT-003 attendance ----------
function Attendance({ lang, r }: { lang: Lang; r: AttendanceReport }) {
  const T = r.totals;
  const n = (v: number) => fmtNumber(v, lang);
  const cells = (x: AttendanceFigures) => [n(x.booked), n(x.completed), n(x.no_show), n(x.cancelled), percent(x.no_show_rate), percent(x.cancellation_rate)];
  const head = [t('repBooked', lang), t('status_completed', lang), t('status_no_show', lang), t('status_cancelled', lang), t('repNoShowRate', lang), t('repCancelRate', lang)];
  return (
    <>
      <div className="stats">
        <Tile label={t('repBooked', lang)} value={n(T.booked)} note={T.upcoming ? t('repUpcoming', lang).replace('{n}', n(T.upcoming)) : undefined} />
        <Tile label={t('status_completed', lang)} value={n(T.completed)} />
        <Tile label={t('status_no_show', lang)} value={n(T.no_show)} note={percent(T.no_show_rate)} />
        <Tile label={t('status_cancelled', lang)} value={n(T.cancelled)} note={percent(T.cancellation_rate)} />
      </div>
      {!T.booked ? <Nothing lang={lang} /> : (
        <>
          <Table caption={t('repByDoctor', lang)} head={[t('doctor', lang), ...head]} rows={r.by_doctor.map((x) => [name(lang, x.doctor), ...cells(x)])}
            foot={r.by_doctor.length > 1 ? [t('total', lang), ...cells(T)] : undefined} />
          {r.by_branch.length > 1 && (
            <Table caption={t('repByBranch', lang)} head={[t('branch', lang), ...head]} rows={r.by_branch.map((x) => [name(lang, x.branch), ...cells(x)])} foot={[t('total', lang), ...cells(T)]} />
          )}
          <Table caption={t('repByStatus', lang)} head={[t('status', lang), t('repCount', lang)]} rows={r.by_status.map((x) => [t(`status_${x.status}` as Key, lang), n(x.n)])} />
        </>
      )}
      <p className="muted small">{t('repAttendanceNote', lang)}</p>
    </>
  );
}

// ---------- REPORT-005 branch and doctor performance ----------
function Performance({ lang, r }: { lang: Lang; r: PerformanceReport }) {
  const T = r.totals;
  const m = (v: number) => <bdi>{money(v, lang, r.currency)}</bdi>;
  const n = (v: number) => fmtNumber(v, lang);
  return (
    <>
      <div className="stats">
        <Tile label={t('repCompleted', lang)} value={n(T.completed)} />
        <Tile label={t('repProcedures', lang)} value={n(T.procedures)} />
        <Tile label={t('repProceduresValue', lang)} value={money(T.procedures_value, lang, r.currency)} />
        {T.collections_net !== null && <Tile label={t('repNet', lang)} value={money(T.collections_net, lang, r.currency)} />}
      </div>
      {!T.completed && !T.procedures && !T.collections_net ? <Nothing lang={lang} /> : (
        <>
          {r.by_branch && (
            <Table caption={t('repByBranch', lang)} head={[t('branch', lang), t('repCompleted', lang), t('repProcedures', lang), t('repProceduresValue', lang), t('repNet', lang)]}
              rows={r.by_branch.map((x) => [name(lang, x.branch), n(x.completed), n(x.procedures), m(x.procedures_value), m(x.collections_net)])}
              foot={[t('total', lang), n(T.completed), n(T.procedures), m(T.procedures_value), m(T.collections_net ?? 0)]} />
          )}
          <Table caption={t('repByDoctor', lang)} head={[t('doctor', lang), t('repCompleted', lang), t('repProcedures', lang), t('repProceduresValue', lang)]}
            rows={r.by_doctor.map((x) => [name(lang, x.doctor), n(x.completed), n(x.procedures), m(x.procedures_value)])}
            foot={r.by_doctor.length > 1 ? [t('total', lang), n(T.completed), n(T.procedures), m(T.procedures_value)] : undefined} />
        </>
      )}
      <p className="muted small">{t(r.scope === 'own' ? 'repPerformanceOwnNote' : 'repPerformanceNote', lang)}</p>
    </>
  );
}

// ---------- REPORT-004 outstanding balances ----------
function Outstanding({ lang, r, branches }: { lang: Lang; r: OutstandingReport; branches: ReportBranch[] }) {
  const T = r.totals;
  const m = (v: number) => <bdi>{money(v, lang, r.currency)}</bdi>;
  const n = (v: number) => fmtNumber(v, lang);
  const branchNames = (ids: string[]) => ids.map((id) => { const b = branches.find((x) => x.id === id); return b ? pickName(lang, b.name_ar, b.name_en) : '—'; }).join('، ');
  return (
    <>
      <div className="stats">
        <Tile label={t('repOwed', lang)} value={money(T.balance, lang, r.currency)} note={t('repPatientsCount', lang).replace('{n}', n(T.patients))} />
        <Tile label={t('repOverdue', lang)} value={money(T.overdue, lang, r.currency)} note={t('repInstallmentsCount', lang).replace('{n}', n(T.overdue_installments))} />
      </div>
      {r.truncated && <Alert tone="info">{t('repTruncated', lang)}</Alert>}
      {!T.patients ? <Nothing lang={lang} /> : (
        <Table caption={t('repPatientsOwing', lang)} text={4}
          head={[t('patient', lang), t('fileNo', lang), t('phone', lang), t('branch', lang), t('repInvoicesCol', lang), t('repOldest', lang), t('balance', lang)]}
          rows={r.patients.map((p) => [
            <RouteLink key="p" route={to.view('patients', p.patient_id)}><bdi>{p.full_name}</bdi></RouteLink>, n(p.file_no), p.phone ? <bdi dir="ltr">{p.phone}</bdi> : '—',
            branchNames(p.branch_ids), n(p.invoices), p.oldest ?? '—', m(p.balance),
          ])}
          foot={[t('total', lang), '', '', '', n(T.invoices), '', m(T.balance)]} />
      )}
      {r.overdue.length > 0 && (
        <Table caption={t('repOverdueInstallments', lang)} text={3}
          head={[t('patient', lang), t('invoiceNo', lang), t('branch', lang), t('repInstallmentNo', lang), t('dueDate', lang), t('repDaysOverdue', lang), t('repRemaining', lang)]}
          rows={r.overdue.map((o) => [
            <RouteLink key="p" route={to.view('patients', o.patient_id)}><bdi>{o.full_name}</bdi></RouteLink>,
            <RouteLink key="i" route={to.invoice(o.invoice_id)}><bdi dir="ltr">{o.number ?? '—'}</bdi></RouteLink>, name(lang, o.branch),
            n(o.seq), o.due_date, n(o.days_overdue), m(o.remaining),
          ])}
          foot={[t('total', lang), '', '', '', '', '', m(T.overdue)]} />
      )}
    </>
  );
}
