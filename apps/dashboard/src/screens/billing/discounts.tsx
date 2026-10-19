import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { t } from '../../i18n';
import { money } from '../../money';
import { send, useBillingMutation, useDiscountLimits, useOverdueInstallments, usePendingDiscounts } from '../../queries';
import { to } from '../../router';
import type { RoleLimit } from '../../types';
import { Badge, Button, Card, EmptyState, ErrorText, Input, PageHeader, Skeleton } from '../../ui/components';
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
export function OverdueInstallments({ clinicId }: { clinicId: string }) {
  const overdue = useOverdueInstallments(clinicId);
  if (overdue.isError) return <ErrorText error={overdue.error} onRetry={() => void overdue.refetch()} />;
  if (!overdue.data) return <Skeleton h={64} count={3} />;
  if (!overdue.data.items.length) return <Card><EmptyState icon={<ReceiptIcon size={28} />} title={t('noOverdue')} text={t('noOverdueText')} /></Card>;
  return (
    <Card>
      <ul className="line-list">
        {overdue.data.items.map((i) => (
          <li key={i.id}>
            <span>
              <RouteLink route={to.invoice(i.invoice_id)}><strong><bdi>{i.patient.full_name}</bdi></strong></RouteLink>
              <span className="muted small"> · <bdi dir="ltr">{i.patient.phone}</bdi> · {i.number} · {t('installment')} {fmtNumber(i.seq)} · {i.due_date}</span>
            </span>
            <span className="line-end"><Badge tone="warning">{t('overdue')}</Badge><bdi>{money(i.amount_minor - i.paid_minor, i.currency)}</bdi></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
