import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { navigate } from '../../hooks';
import { t } from '../../i18n';
import { money } from '../../money';
import { send, useBillingMutation, useDiscountLimits, useOverdueInstallments, usePendingDiscounts } from '../../queries';
import { to } from '../../router';
import type { OverdueInstallment, RoleLimit } from '../../types';
import { Badge, Button, Card, EmptyState, ErrorText, Input, PageHeader, Skeleton } from '../../ui/components';
import { DataTable, type Column } from '../../ui/data-table';
import { ReceiptIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';
import { toMinor } from '../../clinical-model';

/**
 * `#/discounts` (SRS DISC-002/003): the owner's approval queue for discounts above a role's limit, and each role's
 * limit (a percentage and an optional amount cap; CLR-02 starts receptionists at 10 % and accountants at 20 %).
 */
export function Discounts({ clinicId, canSetLimits }: { clinicId: string; canSetLimits: boolean }) {
  const pending = usePendingDiscounts(clinicId);
  const limits = useDiscountLimits(clinicId);
  return (
    <>
      <PageHeader title={t('navDiscounts')} sub={t('discountsSub')} />
      <Card>
        <h2>{t('awaitingApproval')}</h2>
        {pending.isError ? <ErrorText error={pending.error} onRetry={() => void pending.refetch()} />
          : pending.isLoading ? <Skeleton h={48} count={2} />
          : !pending.data?.length ? <EmptyState icon={<ReceiptIcon size={28} />} title={t('noPendingDiscounts')} text={t('noPendingDiscountsText')} />
          : (
            <ul className="line-list mt">
              {pending.data.map((i) => (
                <li key={i.id}>
                  <span>
                    <RouteLink route={to.invoice(i.id)}><strong><bdi>{i.patient.full_name}</bdi></strong></RouteLink>
                    <span className="muted small"> · {t('requestedBy')} <bdi>{i.discount_requested_by_name}</bdi></span>
                  </span>
                  <span className="line-end"><bdi>{money(i.subtotal_minor - i.discount_minor, i.currency)}</bdi><RouteLink route={to.invoice(i.id)} className="btn btn-secondary">{t('review')}</RouteLink></span>
                </li>
              ))}
            </ul>
          )}
      </Card>
      <Card>
        <h2>{t('roleLimits')}</h2>
        <p className="muted small">{t('roleLimitsSub')}</p>
        {limits.isError ? <ErrorText error={limits.error} /> : !limits.data ? <Skeleton h={48} count={3} /> : (
          <ul className="line-list mt">
            {limits.data.map((r) => <LimitRow key={r.id} clinicId={clinicId} r={r} canEdit={canSetLimits && !r.unlimited} />)}
          </ul>
        )}
      </Card>
    </>
  );
}

function LimitRow({ clinicId, r, canEdit }: { clinicId: string; r: RoleLimit; canEdit: boolean }) {
  const [pct, setPct] = useState(String(r.max_discount_bp / 100));
  const [cap, setCap] = useState(r.max_discount_minor === null ? '' : String(r.max_discount_minor / 100));
  const bp = Math.round(Number(pct) * 100);
  const capMinor = cap.trim() ? toMinor(cap) : null;
  const dirty = bp !== r.max_discount_bp || capMinor !== r.max_discount_minor;
  const save = useBillingMutation(clinicId, () => send(`/discounts/limits/${r.id}`, 'PATCH', { maxDiscountBp: bp, maxDiscountMinor: capMinor }));
  const valid = Number.isFinite(bp) && bp >= 0 && bp <= 10000 && (!cap.trim() || capMinor !== null);
  return (
    <li>
      <span><strong>{arName(r.name_ar, r.name_en)}</strong>{r.unlimited && <> <Badge tone="primary">{t('noLimit')}</Badge></>}</span>
      {r.unlimited ? <span className="muted small">—</span> : canEdit ? (
        <span className="line-end">
          <label className="small">{t('maxPercent')} <Input className="input-sm" dir="ltr" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} aria-label={t('maxPercent')} /></label>
          <label className="small">{t('maxAmount')} <Input className="input-sm" dir="ltr" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder={t('noCap')} aria-label={t('maxAmount')} /></label>
          <Button variant="secondary" disabled={!dirty || !valid} loading={save.isPending} onClick={() => save.mutate(undefined)}>{t('save')}</Button>
          <ErrorText error={save.error} />
        </span>
      ) : (
        <span className="line-end">{fmtNumber(r.max_discount_bp / 100)}%{r.max_discount_minor !== null && <> · {money(r.max_discount_minor)}</>}</span>
      )}
    </li>
  );
}

/** Installments unpaid after their date (PAY-004), shown on the invoices page. */
/** What is still due on an installment (the same expression as before the table: amount minus what was paid on it). */
const installmentLeft = (i: OverdueInstallment) => i.amount_minor - i.paid_minor;

const OVERDUE_COLUMNS: Column<OverdueInstallment>[] = [
  {
    id: 'patient', header: t('invColPatient'), sortValue: (i) => i.patient.full_name,
    cell: (i) => <RouteLink route={to.invoice(i.invoice_id)} className="font-semibold no-underline hover:underline"><bdi>{i.patient.full_name}</bdi></RouteLink>,
  },
  { id: 'phone', header: t('phone'), hideOnMobile: true, cell: (i) => <bdi dir="ltr" className="tabular-nums">{i.patient.phone}</bdi> },
  { id: 'invoice', header: t('invColNumber'), hideOnMobile: true, sortValue: (i) => i.number, cell: (i) => <bdi dir="ltr" className="whitespace-nowrap">{i.number}</bdi> },
  { id: 'seq', header: t('installment'), numeric: true, sortValue: (i) => i.seq, cell: (i) => fmtNumber(i.seq) },
  {
    id: 'due', header: t('dueDate'), sortValue: (i) => i.due_date,
    cell: (i) => <span className="whitespace-nowrap"><span className="tabular-nums">{i.due_date}</span> <Badge tone="danger" dot>{t('overdue')}</Badge></span>,
  },
  { id: 'left', header: t('invColBalance'), numeric: true, sortValue: installmentLeft, cell: (i) => <bdi className="text-owed font-semibold">{money(installmentLeft(i), i.currency)}</bdi> },
];

/** The invoices page's «أقساط متأخرة» tab: installments past their date and not paid, oldest first (redesign R4: DataTable). */
export function OverdueInstallments({ clinicId }: { clinicId: string }) {
  const overdue = useOverdueInstallments(clinicId);
  return (
    <DataTable
      label={t('invf_overdue')}
      rows={overdue.data?.items}
      columns={OVERDUE_COLUMNS}
      rowKey={(i) => i.id}
      isLoading={overdue.isLoading}
      isFetching={overdue.isFetching}
      error={overdue.isError ? overdue.error : undefined}
      onRetry={() => void overdue.refetch()}
      search={{ placeholder: t('invoiceSearchHint'), text: (i) => `${i.patient.full_name} ${i.patient.phone} ${i.number ?? ''} ${i.patient.file_no}` }}
      defaultSort={{ id: 'due', dir: 'asc' }}
      pageSize={20}
      onRowClick={(i) => navigate(to.invoice(i.invoice_id))}
      empty={{ icon: <ReceiptIcon size={28} />, title: t('noOverdue'), text: t('noOverdueText') }}
    />
  );
}
