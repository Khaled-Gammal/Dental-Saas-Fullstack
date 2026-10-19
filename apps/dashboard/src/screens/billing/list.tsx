import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { t, type Key } from '../../i18n';
import { money } from '../../money';
import { usePatientBilling, useInvoices } from '../../queries';
import { to } from '../../router';
import { Badge, Button, Card, EmptyState, ErrorText, PageHeader, Skeleton } from '../../ui/components';
import { ReceiptIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';
import { OverdueInstallments } from './discounts';
import { STATUS_TONE } from './invoice';

const FILTERS = ['open', 'overdue', 'draft', 'paid', 'void', 'all'] as const;

/** `#/invoices`: the clinic's invoices (BILLING-*), open ones first by default. */
export function InvoicesList({ clinicId, query }: { clinicId: string; query?: Record<string, string> }) {
  const status = (FILTERS as readonly string[]).includes(query?.status ?? '') ? query!.status : 'open';
  const list = useInvoices(clinicId, status === 'overdue' ? 'open' : status);
  return (
    <>
      <PageHeader title={t('navBilling')} sub={t('invoicesSub')} />
      <div className="seg" role="tablist" aria-label={t('navBilling')}>
        {FILTERS.map((f) => (
          <RouteLink key={f} route={{ page: 'invoices', query: { status: f } }} className={`seg-btn${f === status ? ' is-on' : ''}`} role="tab" aria-selected={f === status}>{t(`invf_${f}` as Key)}</RouteLink>
        ))}
      </div>
      {status === 'overdue' ? <OverdueInstallments clinicId={clinicId} />
        : list.isError ? <ErrorText error={list.error} onRetry={() => void list.refetch()} />
        : list.isLoading ? <Skeleton h={64} count={4} />
        : !list.data?.length ? <Card><EmptyState icon={<ReceiptIcon size={28} />} title={t('noInvoices')} text={t('noInvoicesText')} /></Card>
        : (
          <Card>
            <ul className="line-list">
              {list.data.map((i) => (
                <li key={i.id}>
                  <span>
                    <RouteLink route={to.invoice(i.id)}><strong>{i.number ?? t('draftInvoice')}</strong></RouteLink>{' '}
                    <Badge tone={STATUS_TONE[i.status]}>{t(`inv_${i.status}` as Key)}</Badge>
                    <span className="muted small"> · <bdi>{i.patient.full_name}</bdi> · <bdi>{arName(i.branch.name_ar, i.branch.name_en)}</bdi>{i.issue_date && <> · {i.issue_date}</>}</span>
                  </span>
                  <span className="line-end">
                    <bdi>{money(i.total_minor, i.currency)}</bdi>
                    {i.balance_minor > 0 && i.status !== 'void' && i.status !== 'draft' && <span className="small">{t('balance')}: <bdi>{money(i.balance_minor, i.currency)}</bdi></span>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
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
