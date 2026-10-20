import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { navigate } from '../../hooks';
import { t, type Key } from '../../i18n';
import { money } from '../../money';
import { usePatientBilling, useInvoices } from '../../queries';
import { to } from '../../router';
import type { InvoiceRow } from '../../types';
import { Badge, Button, Card, ErrorText, PageHeader } from '../../ui/components';
import { DataTable, type Column } from '../../ui/data-table';
import { ReceiptIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';
import { OverdueInstallments } from './discounts';
import { STATUS_TONE } from './invoice';

const FILTERS = ['open', 'overdue', 'draft', 'paid', 'void', 'all'] as const;

/** An invoice that is issued and not settled shows what is still owed (drafts and void ones owe nothing). */
const owes = (i: InvoiceRow) => i.balance_minor > 0 && i.status !== 'void' && i.status !== 'draft';

/** The list's columns: what the API returned, shown as it is (the amounts are the database's, never recomputed here). */
const INVOICE_COLUMNS: Column<InvoiceRow>[] = [
  {
    id: 'number', header: t('invColNumber'), sortValue: (i) => i.number ?? '',
    cell: (i) => (
      <span className="flex flex-wrap items-center gap-2">
        <RouteLink route={to.invoice(i.id)} className="whitespace-nowrap font-semibold text-primary-600 no-underline hover:underline"><bdi dir="ltr">{i.number ?? t('draftInvoice')}</bdi></RouteLink>
        <Badge tone={STATUS_TONE[i.status]} dot>{t(`inv_${i.status}` as Key)}</Badge>
      </span>
    ),
  },
  { id: 'patient', header: t('invColPatient'), sortValue: (i) => i.patient.full_name, cell: (i) => <bdi>{i.patient.full_name}</bdi> },
  { id: 'branch', header: t('invColBranch'), hideOnMobile: true, cell: (i) => <bdi className="muted">{arName(i.branch.name_ar, i.branch.name_en)}</bdi> },
  { id: 'date', header: t('invColDate'), hideOnMobile: true, sortValue: (i) => i.issue_date, cell: (i) => (i.issue_date ? <span className="tabular-nums">{i.issue_date}</span> : <span className="muted">—</span>) },
  { id: 'total', header: t('invColTotal'), numeric: true, sortValue: (i) => i.total_minor, cell: (i) => <bdi>{money(i.total_minor, i.currency)}</bdi> },
  {
    id: 'balance', header: t('invColBalance'), numeric: true, sortValue: (i) => (owes(i) ? i.balance_minor : 0),
    cell: (i) => (owes(i) ? <bdi className="text-owed font-semibold">{money(i.balance_minor, i.currency)}</bdi> : <span className="muted">—</span>),
  },
];

/**
 * `#/invoices`: the clinic's invoices (BILLING-*), open ones first by default. The status tabs ask the API; the table
 * searches, sorts and pages what it returned (redesign R3: on the shared DataTable).
 */
export function InvoicesList({ clinicId, query }: { clinicId: string; query?: Record<string, string> }) {
  const status = (FILTERS as readonly string[]).includes(query?.status ?? '') ? query!.status : 'open';
  const list = useInvoices(clinicId, status === 'overdue' ? 'open' : status);
  const rows = list.data?.pages.flat();
  return (
    <>
      <PageHeader title={t('navBilling')} sub={t('invoicesSub')}
        count={status !== 'overdue' && rows ? <bdi dir="ltr">{fmtNumber(rows.length)}{list.hasNextPage && '+'}</bdi> : undefined} />
      <div className="seg" role="group" aria-label={t('navBilling')}>
        {FILTERS.map((f) => (
          <RouteLink key={f} route={{ page: 'invoices', query: { status: f } }} className={`seg-btn${f === status ? ' is-on' : ''}`} aria-current={f === status ? 'page' : undefined}>{t(`invf_${f}` as Key)}</RouteLink>
        ))}
      </div>
      {status === 'overdue' ? <OverdueInstallments clinicId={clinicId} /> : (
        <DataTable
          key={status} // a new tab starts on page 1 with no search
          label={t('navBilling')}
          rows={rows}
          columns={INVOICE_COLUMNS}
          rowKey={(i) => i.id}
          isLoading={list.isLoading}
          isFetching={list.isFetching}
          error={list.isError ? list.error : undefined}
          onRetry={() => void list.refetch()}
          search={{ placeholder: t('invoiceSearchHint'), text: (i) => `${i.number ?? ''} ${i.patient.full_name} ${i.patient.file_no}` }}
          pageSize={20}
          onRowClick={(i) => navigate(to.invoice(i.id))}
          empty={{ icon: <ReceiptIcon size={28} />, title: t('noInvoices'), text: t('noInvoicesText') }}
          // the table searches and sorts what is loaded; older invoices come in 100 at a time
          footer={list.hasNextPage && (
            <div className="row-center"><Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t('loadMore')}</Button></div>
          )}
        />
      )}
    </>
  );
}

/** The patient's money on the profile (BILLING-005): balance, invoices and unbilled work. */
export function PatientBillingCard({ clinicId, patientId, canWrite }: { clinicId: string; patientId: string; canWrite: boolean }) {
  const billing = usePatientBilling(clinicId, patientId);
  const [all, setAll] = useState(false);
  if (billing.isError) return <Card><h2>{t('billingTitle')}</h2><ErrorText error={billing.error} onRetry={() => void billing.refetch()} /></Card>;
  if (!billing.data) return null;
  const b = billing.data;
  const shown = all ? b.invoices : b.invoices.filter((i) => i.status !== 'void').slice(0, 5);
  return (
    <Card>
      <div className="row-between">
        <h2>{t('billingTitle')}</h2>
        {canWrite && <RouteLink route={to.create('invoices', { patient: patientId })} className="btn btn-secondary">{t('newInvoice')}</RouteLink>}
      </div>
      <p className="mt-sm"><span className="muted small">{t('balance')}:</span> <strong className={b.balance_minor > 0 ? 'text-owed' : undefined}><bdi>{money(b.balance_minor, b.currency)}</bdi></strong></p>
      {b.unbilled.length > 0 && <p className="small">{t('unbilledCount').replace('{n}', String(b.unbilled.length))}</p>}
      {shown.length === 0 ? <p className="muted small mt-sm">{t('noInvoices')}</p> : (
        <ul className="line-list mt-sm">
          {shown.map((i) => (
            <li key={i.id}>
              <span><RouteLink route={to.invoice(i.id)}>{i.number ?? t('draftInvoice')}</RouteLink> <Badge tone={STATUS_TONE[i.status]}>{t(`inv_${i.status}` as Key)}</Badge></span>
              <span className="line-end"><bdi>{money(i.total_minor, i.currency)}</bdi></span>
            </li>
          ))}
        </ul>
      )}
      {b.invoices.length > shown.length && <Button variant="ghost" onClick={() => setAll(true)}>{t('showAll')}</Button>}
    </Card>
  );
}
