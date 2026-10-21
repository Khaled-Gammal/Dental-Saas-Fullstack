import { useState, type ReactNode } from 'react';
import { arName } from '@dental/ui/text';
import { can, type Session } from '../../api';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { csvFileName, downloadCsv, pounds, toCsv, type CsvCell } from '../../csv';
import { localToday } from '../../finance-model';
import { adjustmentKindLabel, appointmentStatusLabel, paymentMethodLabel, periodPresetLabel } from '../../labels';
import { currencyLabel, money } from '../../money';
import { useProfile, useReport, useReportBranches } from '../../queries';
import { dailyOnly, percent, PRESETS, presetOf, presetPeriod, reportTabs, type ReportTab } from '../../reports-model';
import { to } from '../../router';
import type { AttendanceFigures, AttendanceReport, ExpensesReport, OutstandingReport, PerformanceReport, ReportBranch, ReportFrame, ReportName, RevenueReport } from '../../types';
import { Alert, Button, Card, EmptyState, ErrorText, Field, PageHeader, Skeleton } from '../../ui/components';
import { ChartIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';

const TAB_TITLE: Record<ReportTab, string> = {
  revenue: 'الإيرادات والتحصيل', expenses: 'المصروفات', attendance: 'الحضور والمواعيد', performance: 'أداء الفروع والأطباء', outstanding: 'المستحقات',
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
  if (!tab) return <Card><EmptyState icon={<ChartIcon size={28} />} title="لا تقارير متاحة لك" text="اطلب من صاحب العيادة صلاحية التقارير." /></Card>;
  const list = branches.data ?? [];
  const preset = presetOf(period, today);
  const q = { ...(daily || tab === 'outstanding' ? {} : period), branchId: branchId || undefined };
  return (
    <>
      <div className="no-print">
        <PageHeader title="التقارير" sub={daily ? 'إيرادات وتحصيلات اليوم في فرعك.' : 'من الحركات المسجلة فعلًا، لفترة ولفرع أو لكل فروعك. كل إجمالي هو مجموع ما تحته.'}
          action={<Button variant="secondary" onClick={() => window.print()}>طباعة</Button>} />
        <Card>
          {tabs.length > 1 && (
            <div className="seg" role="group" aria-label="التقارير">
              {tabs.map((x) => (
                <button key={x} type="button" className={`seg-btn${x === tab ? ' is-on' : ''}`} aria-pressed={x === tab} onClick={() => setTab(x)}>{TAB_TITLE[x]}</button>
              ))}
            </div>
          )}
          <div className="report-filters mt">
            {!daily && tab !== 'outstanding' && (
              <>
                <div className="seg" aria-label="الفترة">
                  {PRESETS.map((p) => (
                    <button key={p} type="button" className={`seg-btn${p === preset ? ' is-on' : ''}`} aria-pressed={p === preset} onClick={() => setPeriod(presetPeriod(p, today))}>
                      {periodPresetLabel[p]}
                    </button>
                  ))}
                </div>
                <div className="period">
                  <DatePicker label="من" value={period.from} onChange={(from) => setPeriod((x) => ({ ...x, from }))} max={period.to} />
                  <DatePicker label="إلى" value={period.to} onChange={(to) => setPeriod((x) => ({ ...x, to }))} min={period.from} />
                </div>
              </>
            )}
            {list.length > 1 && (
              <Field label="الفرع">
                {(a) => <Choice id={a.id} value={branchId} onChange={setBranchId} noneLabel="كل الفروع"
                  options={list.map((b) => ({ value: b.id, label: arName(b.name_ar, b.name_en) }))} />}
              </Field>
            )}
          </div>
          {daily && <p className="muted small mt-sm">يعرض الاستقبال أرقام اليوم فقط.</p>}
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
        <PrintHead clinicId={clinicId} title={TAB_TITLE[tab]} frame={data} branches={branches} />
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
          {frame.period ? `${'من'} ${frame.period.from} ${'إلى'} ${frame.period.to}` : `${'حتى'} ${frame.today}`}
          {' · '}{branch ? arName(branch.name_ar, branch.name_en) : 'كل الفروع'}
        </p>
      </div>
      {clinic?.logo && <img className="rx-logo" src={clinic.logo.thumbUrl} alt="" />}
    </header>
  );
}

// ---------- building blocks ----------
const name = (n: ReportName) => (n ? arName(n.name_ar, n.name_en) : '—');
/** An expense method; expenses recorded before methods existed have none ("unknown"). */
const methodName = (m: string) => (m === 'unknown' ? 'غير محددة' : paymentMethodLabel[m]);
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
        {csv && <Button variant="ghost" className="no-print" onClick={() => exportTable(head, csv)} aria-label={`${'تصدير CSV'}: ${caption}`}>تصدير CSV</Button>}
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
  return <Card><EmptyState icon={<ChartIcon size={28} />} title="لا حركات في هذه الفترة" text="جرّب فترة أطول أو فرعًا آخر." /></Card>;
}

// ---------- REPORT-001 revenue and collections ----------
function Revenue({ r }: { r: RevenueReport }) {
  const m = (v: number) => <bdi>{money(v, r.currency)}</bdi>;
  const T = r.totals;
  return (
    <>
      <div className="stats">
        <Tile label="الفواتير الصادرة" value={money(T.invoiced, r.currency)} note={'{n} فاتورة'.replace('{n}', fmtNumber(T.invoices))} />
        <Tile label="المحصّل" value={money(T.collected, r.currency)} note={'{n} دفعة'.replace('{n}', fmtNumber(T.payments))} />
        <Tile label="المرتجع" value={money(T.refunded, r.currency)} />
        <Tile label="صافي التحصيل" value={money(T.net, r.currency)} />
      </div>
      {!T.invoices && !T.payments && !T.refunds && !T.adjusted ? <Nothing /> : (
        <>
          <Table caption="حسب طريقة الدفع" head={['طريقة الدفع', 'المحصّل', 'المرتجع', 'صافي التحصيل']}
            rows={r.by_method.map((x) => [paymentMethodLabel[x.method], m(x.collected), m(x.refunded), m(x.net)])}
            foot={['الإجمالي', m(T.collected), m(T.refunded), m(T.net)]}
            csv={{ frame: r, table: 'by-method', money: [1, 2, 3],
              rows: r.by_method.map((x) => [paymentMethodLabel[x.method], pounds(x.collected), pounds(x.refunded), pounds(x.net)]),
              foot: ['الإجمالي', pounds(T.collected), pounds(T.refunded), pounds(T.net)] }} />
          {r.adjustments.length > 0 && (
            <Table caption="الإعفاءات" head={['النوع', 'العدد', 'المبلغ']}
              rows={r.adjustments.map((x) => [adjustmentKindLabel[x.kind], fmtNumber(x.n), m(x.amount)])}
              csv={{ frame: r, table: 'adjustments', money: [2], rows: r.adjustments.map((x) => [adjustmentKindLabel[x.kind], x.n, pounds(x.amount)]) }} />
          )}
          {r.by_branch.length > 1 && (
            <Table caption="حسب الفرع" head={['الفرع', 'الفواتير الصادرة', 'المحصّل', 'المرتجع', 'صافي التحصيل']}
              rows={r.by_branch.map((x) => [name(x.branch), m(x.invoiced), m(x.collected), m(x.refunded), m(x.net)])}
              foot={['الإجمالي', m(T.invoiced), m(T.collected), m(T.refunded), m(T.net)]}
              csv={{ frame: r, table: 'by-branch', money: [1, 2, 3, 4],
                rows: r.by_branch.map((x) => [name(x.branch), pounds(x.invoiced), pounds(x.collected), pounds(x.refunded), pounds(x.net)]),
                foot: ['الإجمالي', pounds(T.invoiced), pounds(T.collected), pounds(T.refunded), pounds(T.net)] }} />
          )}
          {r.by_day.length > 1 && (
            <Table caption="حسب اليوم" head={['التاريخ', 'الفواتير الصادرة', 'المحصّل', 'المرتجع', 'صافي التحصيل']}
              rows={r.by_day.map((x) => [x.day, m(x.invoiced), m(x.collected), m(x.refunded), m(x.net)])}
              foot={['الإجمالي', m(T.invoiced), m(T.collected), m(T.refunded), m(T.net)]}
              csv={{ frame: r, table: 'by-day', money: [1, 2, 3, 4],
                rows: r.by_day.map((x) => [x.day, pounds(x.invoiced), pounds(x.collected), pounds(x.refunded), pounds(x.net)]),
                foot: ['الإجمالي', pounds(T.invoiced), pounds(T.collected), pounds(T.refunded), pounds(T.net)] }} />
          )}
        </>
      )}
      <p className="muted small">الفواتير بتاريخ إصدارها، والدفعات والمرتجعات بيوم تسجيلها. الدفعة الملغاة لخطأ في الإدخال لا تُحسب. الإعفاءات تقلل المستحق ولا تدخل في التحصيل.</p>
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
        <Tile label="إجمالي المصروفات" value={money(T.total, r.currency)}
          note={T.pending ? 'منها {amount} بانتظار الموافقة'.replace('{amount}', money(T.pending, r.currency)) : undefined} />
        <Tile label="صافي التحصيل" value={money(T.collections_net, r.currency)} />
        <Tile label="التحصيل ناقص المصروفات" value={money(T.result, r.currency)} note="على أساس نقدي" />
      </div>
      {T.rejected > 0 && <Alert tone="info">{'مصروفات مرفوضة بقيمة {amount} لا تدخل في الإجمالي (وتظل محسوبة في خزنة يومها لأن النقدية خرجت).'.replace('{amount}', money(T.rejected, r.currency))}</Alert>}
      {!T.count ? <Nothing /> : (
        <>
          <Table caption="حسب البند" head={['البند', 'العدد', 'المبلغ']}
            rows={r.by_category.map((x) => [x.name ?? '—', fmtNumber(x.n), m(x.amount)])} foot={['الإجمالي', fmtNumber(T.count), m(T.total)]}
            csv={{ frame: r, table: 'by-category', money: [2], rows: r.by_category.map((x) => [x.name ?? '—', x.n, pounds(x.amount)]), foot: ['الإجمالي', T.count, pounds(T.total)] }} />
          <Table caption="حسب طريقة الدفع" head={['طريقة الدفع', 'العدد', 'المبلغ']}
            rows={r.by_method.map((x) => [methodName(x.method), fmtNumber(x.n), m(x.amount)])}
            csv={{ frame: r, table: 'by-method', money: [2], rows: r.by_method.map((x) => [methodName(x.method), x.n, pounds(x.amount)]) }} />
          {r.by_branch.length > 1 && (
            <Table caption="حسب الفرع" head={['الفرع', 'العدد', 'المبلغ']}
              rows={r.by_branch.map((x) => [name(x.branch), fmtNumber(x.n), m(x.amount)])}
              csv={{ frame: r, table: 'by-branch', money: [2], rows: r.by_branch.map((x) => [name(x.branch), x.n, pounds(x.amount)]) }} />
          )}
          {r.by_day.length > 1 && (
            <Table caption="حسب اليوم" head={['التاريخ', 'العدد', 'المبلغ']}
              rows={r.by_day.map((x) => [x.day, fmtNumber(x.n), m(x.amount)])} foot={['الإجمالي', fmtNumber(T.count), m(T.total)]}
              csv={{ frame: r, table: 'by-day', money: [2], rows: r.by_day.map((x) => [x.day, x.n, pounds(x.amount)]), foot: ['الإجمالي', T.count, pounds(T.total)] }} />
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
  const head = ['المواعيد', 'مكتمل', 'لم يحضر', 'ملغي', 'نسبة عدم الحضور', 'نسبة الإلغاء'];
  const rates = [5, 6]; // after the name column
  return (
    <>
      <div className="stats">
        <Tile label="المواعيد" value={n(T.booked)} note={T.upcoming ? 'منها {n} لم يحن موعدها'.replace('{n}', n(T.upcoming)) : undefined} />
        <Tile label="مكتمل" value={n(T.completed)} />
        <Tile label="لم يحضر" value={n(T.no_show)} note={percent(T.no_show_rate)} />
        <Tile label="ملغي" value={n(T.cancelled)} note={percent(T.cancellation_rate)} />
      </div>
      {!T.booked ? <Nothing /> : (
        <>
          <Table caption="حسب الطبيب" head={['الطبيب', ...head]} rows={r.by_doctor.map((x) => [name(x.doctor), ...cells(x)])}
            foot={r.by_doctor.length > 1 ? ['الإجمالي', ...cells(T)] : undefined}
            csv={{ frame: r, table: 'by-doctor', rates, rows: r.by_doctor.map((x) => [name(x.doctor), ...raw(x)]), foot: r.by_doctor.length > 1 ? ['الإجمالي', ...raw(T)] : undefined }} />
          {r.by_branch.length > 1 && (
            <Table caption="حسب الفرع" head={['الفرع', ...head]} rows={r.by_branch.map((x) => [name(x.branch), ...cells(x)])} foot={['الإجمالي', ...cells(T)]}
              csv={{ frame: r, table: 'by-branch', rates, rows: r.by_branch.map((x) => [name(x.branch), ...raw(x)]), foot: ['الإجمالي', ...raw(T)] }} />
          )}
          <Table caption="حسب الحالة" head={['الحالة', 'العدد']} rows={r.by_status.map((x) => [appointmentStatusLabel[x.status], n(x.n)])}
            csv={{ frame: r, table: 'by-status', rows: r.by_status.map((x) => [appointmentStatusLabel[x.status], x.n]) }} />
        </>
      )}
      <p className="muted small">نسبة الإلغاء من كل المواعيد. نسبة عدم الحضور من المواعيد التي حان وقتها ولم تُلغَ. الحجوزات المؤقتة التي انتهت مهلتها ليست مواعيد.</p>
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
        <Tile label="مواعيد مكتملة" value={n(T.completed)} />
        <Tile label="الإجراءات" value={n(T.procedures)} />
        <Tile label="قيمة الإجراءات" value={money(T.procedures_value, r.currency)} />
        {T.collections_net !== null && <Tile label="صافي التحصيل" value={money(T.collections_net, r.currency)} />}
      </div>
      {!T.completed && !T.procedures && !T.collections_net ? <Nothing /> : (
        <>
          {r.by_branch && (
            <Table caption="حسب الفرع" head={['الفرع', 'مواعيد مكتملة', 'الإجراءات', 'قيمة الإجراءات', 'صافي التحصيل']}
              rows={r.by_branch.map((x) => [name(x.branch), n(x.completed), n(x.procedures), m(x.procedures_value), m(x.collections_net)])}
              foot={['الإجمالي', n(T.completed), n(T.procedures), m(T.procedures_value), m(T.collections_net ?? 0)]}
              csv={{ frame: r, table: 'by-branch', money: [3, 4],
                rows: r.by_branch.map((x) => [name(x.branch), x.completed, x.procedures, pounds(x.procedures_value), pounds(x.collections_net)]),
                foot: ['الإجمالي', T.completed, T.procedures, pounds(T.procedures_value), pounds(T.collections_net ?? 0)] }} />
          )}
          <Table caption="حسب الطبيب" head={['الطبيب', 'مواعيد مكتملة', 'الإجراءات', 'قيمة الإجراءات']}
            rows={r.by_doctor.map((x) => [name(x.doctor), n(x.completed), n(x.procedures), m(x.procedures_value)])}
            foot={r.by_doctor.length > 1 ? ['الإجمالي', n(T.completed), n(T.procedures), m(T.procedures_value)] : undefined}
            csv={{ frame: r, table: 'by-doctor', money: [3],
              rows: r.by_doctor.map((x) => [name(x.doctor), x.completed, x.procedures, pounds(x.procedures_value)]),
              foot: r.by_doctor.length > 1 ? ['الإجمالي', T.completed, T.procedures, pounds(T.procedures_value)] : undefined }} />
        </>
      )}
      <p className="muted small">{r.scope === 'own' ? 'أرقامك أنت فقط: مواعيدك المكتملة والإجراءات التي نفذتها.' : 'قيمة الإجراءات بسعر التنفيذ قبل خصومات الفاتورة، بتاريخ الزيارة. التحصيل لكل فرع فقط، ولا عمولات.'}</p>
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
        <Tile label="إجمالي المستحق على المرضى" value={money(T.balance, r.currency)} note={'{n} مريض'.replace('{n}', n(T.patients))} />
        <Tile label="أقساط متأخرة" value={money(T.overdue, r.currency)} note={'{n} قسط'.replace('{n}', n(T.overdue_installments))} />
      </div>
      {r.truncated && <Alert tone="info">القائمة تعرض أول 500 فقط؛ الإجماليات تشمل الجميع.</Alert>}
      {!T.patients ? <Nothing /> : (
        <Table caption="المرضى أصحاب المستحقات" text={4}
          head={['المريض', 'ملف رقم', 'رقم الموبايل', 'الفرع', 'الفواتير', 'أقدم فاتورة', 'المتبقي']}
          rows={r.patients.map((p) => [
            <RouteLink key="p" route={to.view('patients', p.patient_id)}><bdi>{p.full_name}</bdi></RouteLink>, n(p.file_no), p.phone ? <bdi dir="ltr">{p.phone}</bdi> : '—',
            branchNames(p.branch_ids), n(p.invoices), p.oldest ?? '—', m(p.balance),
          ])}
          foot={['الإجمالي', '', '', '', n(T.invoices), '', m(T.balance)]}
          csv={{ frame: r, table: 'patients', money: [6],
            rows: r.patients.map((p) => [p.full_name, p.file_no, p.phone, branchNames(p.branch_ids), p.invoices, p.oldest, pounds(p.balance)]),
            foot: ['الإجمالي', null, null, null, T.invoices, null, pounds(T.balance)] }} />
      )}
      {r.overdue.length > 0 && (
        <Table caption="الأقساط المتأخرة" text={3}
          head={['المريض', 'رقم الفاتورة', 'الفرع', 'القسط', 'موعد الاستحقاق', 'أيام التأخير', 'المتبقي']}
          rows={r.overdue.map((o) => [
            <RouteLink key="p" route={to.view('patients', o.patient_id)}><bdi>{o.full_name}</bdi></RouteLink>,
            <RouteLink key="i" route={to.invoice(o.invoice_id)}><bdi dir="ltr">{o.number ?? '—'}</bdi></RouteLink>, name(o.branch),
            n(o.seq), o.due_date, n(o.days_overdue), m(o.remaining),
          ])}
          foot={['الإجمالي', '', '', '', '', '', m(T.overdue)]}
          csv={{ frame: r, table: 'overdue-installments', money: [6],
            rows: r.overdue.map((o) => [o.full_name, o.number, name(o.branch), o.seq, o.due_date, o.days_overdue, pounds(o.remaining)]),
            foot: ['الإجمالي', null, null, null, null, null, pounds(T.overdue)] }} />
      )}
    </>
  );
}
