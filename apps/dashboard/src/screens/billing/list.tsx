import { Printer } from 'lucide-react';
import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { useCan } from '../../can';
import { DatePicker } from '../../components/date-picker';
import { navigate, useDebounced } from '../../hooks';
import { invoiceFilterLabel, invoiceStatusLabel } from '../../labels';
import { money } from '../../money';
import { useInvoiceTotals, usePatientBilling, useInvoices, useUnbilled } from '../../queries';
import { to } from '../../router';
import type { InvoiceRow, InvoiceTotals, UnbilledGroup } from '../../types';
import { Badge, Button, Card, ErrorText, LinkButton, PageHeader } from '../../ui/components';
import { DataTable, type Column } from '../../ui/data-table';
import { CashIcon, ReceiptIcon, UsersIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';
import { OverdueInstallments } from './discounts';
import { STATUS_TONE } from './invoice';
import { RowMenu } from '../../ui/row-menu';

const FILTERS = ['open', 'unbilled', 'overdue', 'draft', 'paid', 'void', 'all'] as const;

/** An invoice that is issued and not settled shows what is still owed (drafts and void ones owe nothing). */
const owes = (i: InvoiceRow) => i.balance_minor > 0 && i.status !== 'void' && i.status !== 'draft';

/** The list's columns: what the API returned, shown as it is (the amounts are the database's, never recomputed here). */
const INVOICE_COLUMNS: Column<InvoiceRow>[] = [
  {
    id: 'number', header: 'رقم الفاتورة', sortValue: (i) => i.number ?? '',
    cell: (i) => (
      <span className="flex flex-wrap items-center gap-2">
        <RouteLink route={to.invoice(i.id)} className="whitespace-nowrap font-semibold text-primary-600 no-underline hover:underline"><bdi dir="ltr">{i.number ?? 'مسودة فاتورة'}</bdi></RouteLink>
        <Badge tone={STATUS_TONE[i.status]} dot>{invoiceStatusLabel[i.status]}</Badge>
      </span>
    ),
  },
  { id: 'patient', header: 'المريض', sortValue: (i) => i.patient.full_name, cell: (i) => <bdi>{i.patient.full_name}</bdi> },
  { id: 'branch', header: 'الفرع', hideOnMobile: true, cell: (i) => <bdi className="muted">{arName(i.branch.name_ar, i.branch.name_en)}</bdi> },
  { id: 'date', header: 'التاريخ', hideOnMobile: true, sortValue: (i) => i.issue_date, cell: (i) => (i.issue_date ? <span className="tabular-nums">{i.issue_date}</span> : <span className="muted">—</span>) },
  { id: 'total', header: 'الإجمالي', numeric: true, sortValue: (i) => i.total_minor, cell: (i) => <bdi>{money(i.total_minor, i.currency)}</bdi> },
  {
    id: 'balance', header: 'المتبقي', numeric: true, sortValue: (i) => (owes(i) ? i.balance_minor : 0),
    cell: (i) => (owes(i) ? <bdi className="text-owed font-semibold">{money(i.balance_minor, i.currency)}</bdi> : <span className="muted">—</span>),
  },
];

/**
 * `#/invoices`: the clinic's invoices (BILLING-*), open ones first by default. The status tabs ask the API; the table
 * searches, sorts and pages what it returned (redesign R3: on the shared DataTable).
 */
export function InvoicesList({ clinicId, query, canWrite = false }: { clinicId: string; query?: Record<string, string>; canWrite?: boolean }) {
  const status = (FILTERS as readonly string[]).includes(query?.status ?? '') ? query!.status : 'open';
  const ownList = status !== 'overdue' && status !== 'unbilled';
  const canPay = useCan()('payments:write');
  // redesign R7: the search and the period go to the API, so they find every invoice, not only the loaded page
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [toDate, setToDate] = useState('');
  const search = useDebounced(q.trim(), 300);
  const filters = { ...(search && { q: search }), ...(from && { from }), ...(toDate && { to: toDate }) };
  // the overdue and unbilled tabs have their own lists; the invoice query then asks for the open ones (cached anyway)
  const list = useInvoices(clinicId, ownList ? status : 'open', filters);
  const totals = useInvoiceTotals(clinicId, status, filters, ownList);
  const rows = list.data?.pages.flat();
  const payRoute = (i: InvoiceRow) => ({ page: 'invoices' as const, id: i.id, action: 'view' as const, query: { pay: '1' } });
  return (
    <>
      <PageHeader title="الفواتير" sub="فواتير المرضى ومدفوعاتهم: ابحث في كل الفواتير، وحصّل الدفعة من الصف مباشرة."
        count={ownList && totals.data ? <bdi dir="ltr">{fmtNumber(totals.data.count)}</bdi> : undefined} />
      <div className="seg" role="group" aria-label="الفواتير">
        {FILTERS.map((f) => (
          <RouteLink key={f} route={{ page: 'invoices', query: { status: f } }} className={`seg-btn${f === status ? ' is-on' : ''}`} aria-current={f === status ? 'page' : undefined}>{invoiceFilterLabel[f]}</RouteLink>
        ))}
      </div>
      {status === 'overdue' ? <OverdueInstallments clinicId={clinicId} /> : status === 'unbilled' ? <UnbilledWork clinicId={clinicId} canWrite={canWrite} /> : (
        <DataTable
          key={status} // a new tab starts on page 1
          label="الفواتير"
          rows={rows}
          columns={INVOICE_COLUMNS}
          rowKey={(i) => i.id}
          isLoading={list.isLoading}
          isFetching={list.isFetching}
          error={list.isError ? list.error : undefined}
          onRetry={() => void list.refetch()}
          search={{ placeholder: 'رقم الفاتورة أو اسم المريض أو رقم الملف أو آخر أرقام الموبايل', value: q, onChange: setQ }}
          toolbar={
            <div className="period">
              <DatePicker label="من" placeholder="من تاريخ" value={from} onChange={setFrom} max={toDate || undefined} />
              <DatePicker label="إلى" placeholder="إلى تاريخ" value={toDate} onChange={setToDate} min={from || undefined} />
              {(from || toDate) && <LinkButton onClick={() => { setFrom(''); setToDate(''); }}>كل التواريخ</LinkButton>}
            </div>
          }
          pageSize={20}
          onRowClick={(i) => navigate(to.invoice(i.id))}
          actions={(i) => (
            <RowMenu label={i.number ?? 'مسودة فاتورة'} actions={[
              { label: 'تحصيل دفعة', icon: <CashIcon size={16} />, route: payRoute(i), hidden: !canPay || !owes(i) },
              { label: 'فتح الفاتورة', icon: <ReceiptIcon size={16} />, route: to.invoice(i.id) },
              { label: 'طباعة', icon: <Printer size={16} aria-hidden />, route: to.printInvoice(i.id), hidden: i.status === 'draft' },
              { label: 'ملف المريض', icon: <UsersIcon size={16} />, route: to.view('patients', i.patient_id) },
            ]} />
          )}
          empty={search || from || toDate
            ? { icon: <ReceiptIcon size={28} />, title: 'لا توجد فاتورة مطابقة', text: 'جرّب جزءًا من الاسم أو آخر أرقام الموبايل، أو وسّع الفترة.' }
            : { icon: <ReceiptIcon size={28} />, title: 'لا توجد فواتير.', text: 'تُنشأ الفاتورة من ملف المريض أو من الزيارة.' }}
          // the API searches and filters; the table sorts what is loaded; older invoices come in 100 at a time
          footer={(totals.data || list.hasNextPage) && (
            <>
              {totals.data && totals.data.count > 0 && <TotalsRow t={totals.data} />}
              {list.hasNextPage && <div className="row-center"><Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>عرض المزيد</Button></div>}
            </>
          )}
        />
      )}
    </>
  );
}

/** Redesign R7: what the filtered list adds up to (every page, not only the loaded one). */
function TotalsRow({ t }: { t: InvoiceTotals }) {
  return (
    <dl className="totals-row" aria-label="إجماليات الفواتير المعروضة">
      <div><dt>الفواتير</dt><dd><bdi>{fmtNumber(t.count)}</bdi></dd></div>
      <div><dt>الإجمالي</dt><dd><bdi>{money(t.total_minor, t.currency)}</bdi></dd></div>
      <div><dt>المدفوع</dt><dd><bdi>{money(t.paid_minor, t.currency)}</bdi></dd></div>
      <div className={t.balance_minor > 0 ? 'is-owed' : undefined}><dt>المتبقي</dt><dd><bdi>{money(t.balance_minor, t.currency)}</bdi></dd></div>
    </dl>
  );
}

const fmtDay = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' }).format(new Date(iso));

/**
 * The "not invoiced yet" tab (redesign R5): procedures done in visits and on no invoice, one row per patient and branch,
 * the longest-waiting first, so finished work is never left unbilled. "Invoice" opens a draft with them chosen.
 */
function UnbilledWork({ clinicId, canWrite }: { clinicId: string; canWrite: boolean }) {
  const list = useUnbilled(clinicId);
  const currency = list.data?.currency;
  const rows = list.data?.items;
  const total = rows?.reduce((s, r) => s + r.total_minor, 0) ?? 0;
  const invoiceRoute = (r: UnbilledGroup) => to.create('invoices', { patient: r.patient_id, branch: r.branch_id });
  const columns: Column<UnbilledGroup>[] = [
    {
      id: 'patient', header: 'المريض', sortValue: (r) => r.full_name,
      cell: (r) => (
        <RouteLink route={to.view('patients', r.patient_id)} className="patient-main">
          <span className="patient-text">
            <strong><bdi>{r.full_name}</bdi></strong>
            <span className="muted small">ملف رقم <bdi dir="ltr">{fmtNumber(r.file_no)}</bdi> · <bdi dir="ltr">{r.phone}</bdi></span>
          </span>
        </RouteLink>
      ),
    },
    { id: 'branch', header: 'الفرع', hideOnMobile: true, cell: (r) => <bdi className="muted">{arName(r.branch_ar, r.branch_en)}</bdi> },
    { id: 'procedures', header: 'الإجراءات', numeric: true, sortValue: (r) => r.procedures, cell: (r) => <span>{fmtNumber(r.procedures)} <span className="muted small">في {fmtNumber(r.visits)} زيارة</span></span> },
    { id: 'oldest', header: 'أقدم إجراء', hideOnMobile: true, sortValue: (r) => r.oldest_at, cell: (r) => <span className="whitespace-nowrap tabular-nums">{fmtDay(r.oldest_at)}</span> },
    { id: 'total', header: 'القيمة', numeric: true, sortValue: (r) => r.total_minor, cell: (r) => <bdi className="text-owed font-semibold">{money(r.total_minor, currency)}</bdi> },
  ];
  return (
    <>
      {rows && rows.length > 0 && (
        <p className="muted small">
          {fmtNumber(rows.length)} مريض · إجمالي لم يُفوتر <strong className="text-owed"><bdi>{money(total, currency)}</bdi></strong>
        </p>
      )}
      <DataTable
        label="إجراءات لم تُفوتر"
        rows={rows}
        columns={columns}
        rowKey={(r) => `${r.patient_id}:${r.branch_id}`}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.isError ? list.error : undefined}
        onRetry={() => void list.refetch()}
        search={{ placeholder: 'ابحث باسم المريض أو رقم الملف أو الموبايل', text: (r) => `${r.full_name} ${r.file_no} ${r.phone}` }}
        defaultSort={{ id: 'oldest', dir: 'asc' }}
        pageSize={25}
        onRowClick={(r) => navigate(canWrite ? invoiceRoute(r) : to.view('patients', r.patient_id))}
        actions={(r) => (
          <RowMenu label={r.full_name} actions={[
            { label: 'إنشاء فاتورة', icon: <ReceiptIcon size={16} />, route: invoiceRoute(r), hidden: !canWrite },
            { label: 'ملف المريض', icon: <UsersIcon size={16} />, route: to.view('patients', r.patient_id) },
          ]} />
        )}
        empty={{ icon: <ReceiptIcon size={28} />, title: 'كل الإجراءات مفوترة', text: 'لا يوجد عمل منفّذ بدون فاتورة.' }}
      />
    </>
  );
}

/** The patient's money on the profile (BILLING-005): balance, invoices and unbilled work. */
export function PatientBillingCard({ clinicId, patientId, canWrite }: { clinicId: string; patientId: string; canWrite: boolean }) {
  const billing = usePatientBilling(clinicId, patientId);
  const [all, setAll] = useState(false);
  if (billing.isError) return <Card><h2>الحساب</h2><ErrorText error={billing.error} onRetry={() => void billing.refetch()} /></Card>;
  if (!billing.data) return null;
  const b = billing.data;
  const shown = all ? b.invoices : b.invoices.filter((i) => i.status !== 'void').slice(0, 5);
  return (
    <Card>
      <div className="row-between">
        <h2>الحساب</h2>
        {canWrite && <RouteLink route={to.create('invoices', { patient: patientId })} className="btn btn-secondary">فاتورة جديدة</RouteLink>}
      </div>
      <p className="mt-sm"><span className="muted small">المتبقي:</span> <strong className={b.balance_minor > 0 ? 'text-owed' : undefined}><bdi>{money(b.balance_minor, b.currency)}</bdi></strong></p>
      {b.unbilled.length > 0 && <p className="small">{'{n} إجراء لم يُفوتر بعد'.replace('{n}', String(b.unbilled.length))}</p>}
      {shown.length === 0 ? <p className="muted small mt-sm">لا توجد فواتير.</p> : (
        <ul className="line-list mt-sm">
          {shown.map((i) => (
            <li key={i.id}>
              <span><RouteLink route={to.invoice(i.id)}>{i.number ?? 'مسودة فاتورة'}</RouteLink> <Badge tone={STATUS_TONE[i.status]}>{invoiceStatusLabel[i.status]}</Badge></span>
              <span className="line-end"><bdi>{money(i.total_minor, i.currency)}</bdi></span>
            </li>
          ))}
        </ul>
      )}
      {b.invoices.length > shown.length && <Button variant="ghost" onClick={() => setAll(true)}>عرض الكل</Button>}
    </Card>
  );
}
