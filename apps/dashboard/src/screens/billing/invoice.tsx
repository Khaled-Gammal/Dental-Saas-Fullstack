import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { toMinor } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { navigate } from '../../hooks';
import { t, type Key } from '../../i18n';
import { currencyLabel, money } from '../../money';
import { send, useBillingMutation, useInvoice, useServices } from '../../queries';
import { to } from '../../router';
import type { InvoiceDetail, InvoiceStatus, Payment, PaymentMethod } from '../../types';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, LinkButton, PageHeader } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { Breadcrumbs, ResourceState, RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';
import { AdjustmentsCard, DiscountCard, LineDiscount, PlanCard } from './controls';

export const METHODS: PaymentMethod[] = ['cash', 'card', 'bank_transfer', 'wallet', 'instapay'];
const NEEDS_REF: PaymentMethod[] = ['bank_transfer', 'wallet', 'instapay'];
export const STATUS_TONE: Record<InvoiceStatus, 'neutral' | 'primary' | 'success' | 'warning'> = {
  draft: 'neutral', issued: 'warning', partially_paid: 'primary', paid: 'success', void: 'neutral',
};
const loc = () => ('ar-EG-u-nu-latn');
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * `#/invoices/<id>/view` (SRS BILLING-001…004, PAY-001…003, PAY-005): the invoice, its lines and totals (all derived
 * by the database), issue / void, the payments with who received each, reversals and refunds, and printing.
 */
export function InvoicePage({ clinicId, id }: { clinicId: string; id?: string }) {
  const inv = useInvoice(clinicId, id);
  const [dialog, setDialog] = useState<'issue' | 'void' | 'delete' | null>(null);
  const [reason, setReason] = useState('');
  const act = useBillingMutation(clinicId, (op: 'issue' | 'void' | 'delete') =>
    op === 'delete' ? send(`/invoices/${id}`, 'DELETE') : send(`/invoices/${id}/${op}`, 'POST', op === 'void' ? { reason: reason.trim() } : undefined));
  if (!inv.data) {
    return <ResourceState isLoading={inv.isLoading} isError={inv.isError} error={inv.error} notFound={false} refetch={() => void inv.refetch()} back={{ page: 'invoices' }} backLabel={t('navBilling')} />;
  }
  const v = inv.data;
  const m = (x: number) => money(x, v.currency);
  return (
    <>
      <Breadcrumbs items={[{ label: t('navBilling'), route: { page: 'invoices' } }, { label: v.patient.full_name, route: to.view('patients', v.patient.id) }, { label: v.number ?? t('draftInvoice') }]} />
      <PageHeader
        title={v.number ? `${t('invoice')} ${v.number}` : t('draftInvoice')}
        sub={`${v.patient.full_name} · ${t('fileNo')} ${fmtNumber(v.patient.file_no)} · ${arName(v.branch.name_ar, v.branch.name_en)}${v.issue_date ? ` · ${v.issue_date}` : ''}`}
        action={<div className="row-end">
          <Badge tone={STATUS_TONE[v.status]}>{t(`inv_${v.status}` as Key)}</Badge>
          {v.status !== 'draft' && <RouteLink route={to.printInvoice(v.id)} className="btn btn-secondary">{t('print')}</RouteLink>}
          {v.can.issue && <Button onClick={() => setDialog('issue')} disabled={!v.lines.length}>{t('issueInvoice')}</Button>}
          {v.can.edit && <Button variant="ghost" onClick={() => setDialog('delete')}>{t('deleteDraft')}</Button>}
          {v.can.void && <Button variant="ghost" onClick={() => { setReason(''); setDialog('void'); }}>{t('voidInvoice')}</Button>}
        </div>}
      />
      {v.status === 'void' && <Alert tone="info">{t('voidedBecause')}: <bdi>{v.void_reason}</bdi>{v.voided_by_name && <> · <bdi>{v.voided_by_name}</bdi></>}</Alert>}
      <ErrorText error={act.error} />
      <div className="profile-grid">
        <div className="stack">
          <LinesCard clinicId={clinicId} v={v} />
          <PaymentsCard clinicId={clinicId} v={v} />
        </div>
        <div className="stack">
          <DiscountCard clinicId={clinicId} v={v} />
          <Card>
            <h2>{t('totals')}</h2>
            <dl className="detail-list mt">
              <div><dt>{t('subtotal')}</dt><dd><bdi>{m(v.subtotal_minor)}</bdi></dd></div>
              {v.discount_minor > 0 && <div><dt>{t('discount')}</dt><dd><bdi>− {m(v.discount_minor)}</bdi></dd></div>}
              {(v.status === 'draft' ? v.tax_preview_minor : v.tax_minor) > 0 && (
                <div><dt>{t('tax')} ({fmtNumber(v.tax_rate_bp / 100)}%)</dt><dd><bdi>{m(v.status === 'draft' ? v.tax_preview_minor : v.tax_minor)}</bdi></dd></div>
              )}
              <div><dt><strong>{t('total')}</strong></dt><dd><strong><bdi>{m(v.status === 'draft' ? v.subtotal_minor - v.discount_minor + v.tax_preview_minor : v.total_minor)}</bdi></strong></dd></div>
              {v.status !== 'draft' && <div><dt>{t('paid')}</dt><dd><bdi>{m(v.paid_minor)}</bdi></dd></div>}
              {v.adjusted_minor > 0 && <div><dt>{t('adjustments')}</dt><dd><bdi>{m(v.adjusted_minor)}</bdi></dd></div>}
              {v.status !== 'draft' && v.status !== 'void' && <div><dt><strong>{t('balance')}</strong></dt><dd><strong><bdi>{m(v.balance_minor)}</bdi></strong></dd></div>}
            </dl>
            {v.status === 'draft' && <p className="muted small mt-sm">{t('draftNote')}</p>}
          </Card>
          <PlanCard clinicId={clinicId} v={v} />
          <AdjustmentsCard clinicId={clinicId} v={v} />
          {v.can.pay && <PayForm key={`${v.paid_minor}-${v.adjusted_minor}`} clinicId={clinicId} v={v} />}
        </div>
      </div>
      <ConfirmDialog open={dialog === 'issue'} title={t('issueInvoice')} confirmLabel={t('issueInvoice')}
        onConfirm={() => act.mutate('issue', { onSettled: () => setDialog(null) })} onCancel={() => setDialog(null)}>
        <p>{t('issueText')}</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'delete'} title={t('deleteDraft')} confirmLabel={t('deleteDraft')} danger
        onConfirm={() => act.mutate('delete', { onSuccess: () => navigate(to.view('patients', v.patient.id)), onSettled: () => setDialog(null) })} onCancel={() => setDialog(null)}>
        <p>{t('deleteDraftText')}</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'void'} title={t('voidInvoice')} confirmLabel={t('voidInvoice')} danger
        onConfirm={() => { if (reason.trim().length >= 3) act.mutate('void', { onSettled: () => setDialog(null) }); }} onCancel={() => setDialog(null)}>
        <p>{t('voidText')}</p>
        <Field label={t('reason')} hint={t('reasonHint')}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
      </ConfirmDialog>
    </>
  );
}

function LinesCard({ clinicId, v }: { clinicId: string; v: InvoiceDetail }) {
  const remove = useBillingMutation(clinicId, (lineId: string) => send(`/invoices/${v.id}/lines/${lineId}`, 'DELETE'));
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <div className="row-between">
        <h2>{t('invoiceLines')}</h2>
        {v.can.edit && !adding && <Button variant="secondary" onClick={() => setAdding(true)}>{t('addLine')}</Button>}
      </div>
      <ul className="line-list mt">
        {v.lines.map((l) => (
          <li key={l.id}>
            <span><bdi>{l.description}</bdi>{l.quantity > 1 && <span className="muted small"> × {fmtNumber(l.quantity)}</span>}
              {l.discount_minor > 0 && <span className="muted small"> · {t('discount')} <bdi>{money(l.discount_minor, v.currency)}</bdi> — <bdi>{l.discount_reason}</bdi></span>}</span>
            <span className="line-end">
              <bdi>{money(l.line_total_minor, v.currency)}</bdi>
              {v.can.discount && <LineDiscount clinicId={clinicId} invoiceId={v.id} currency={v.currency} line={l} />}
              {v.can.edit && <LinkButton onClick={() => remove.mutate(l.id)}>{t('remove')}</LinkButton>}
            </span>
          </li>
        ))}
      </ul>
      <ErrorText error={remove.error} />
      {adding && <LineForm clinicId={clinicId} invoiceId={v.id} onDone={() => setAdding(false)} />}
    </Card>
  );
}

function LineForm({ clinicId, invoiceId, onDone }: { clinicId: string; invoiceId: string; onDone: () => void }) {
  const services = useServices(clinicId);
  const [serviceId, setServiceId] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('1');
  const add = useBillingMutation(clinicId, () => send(`/invoices/${invoiceId}/lines`, 'POST', {
    ...(serviceId ? { serviceId } : { description: description.trim() }), quantity: Number(qty) || 1,
    ...(price.trim() && toMinor(price) !== null && { unitPriceMinor: toMinor(price) }),
  }));
  const ready = (!!serviceId || (description.trim().length > 0 && toMinor(price) !== null)) && (!price.trim() || toMinor(price) !== null);
  return (
    <form className="stack mt tooth-panel" onSubmit={(e) => { e.preventDefault(); if (ready) add.mutate(undefined, { onSuccess: onDone }); }}>
      <div className="grid-2">
        <Field label={t('service')} optional={t('optional')}>
          {(a) => <Choice id={a.id} value={serviceId} onChange={setServiceId} noneLabel={t('otherLine')}
            options={(services.data ?? []).filter((s) => s.is_active).map((s) => ({ value: s.id, label: arName(s.name_ar, s.name_en) }))} />}
        </Field>
        {!serviceId && <Field label={t('lineDescription')}>{(a) => <Input id={a.id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />}</Field>}
        <Field label={t('unitPrice')} optional={serviceId ? t('optional') : undefined}>
          {(a) => <Input id={a.id} dir="ltr" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />}
        </Field>
        <Field label={t('quantity')}>{(a) => <Input id={a.id} dir="ltr" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, '').slice(0, 3))} />}</Field>
      </div>
      <ErrorText error={add.error} />
      <div className="row-end"><Button variant="ghost" onClick={onDone}>{t('cancel')}</Button><Button type="submit" loading={add.isPending} disabled={!ready}>{t('addLine')}</Button></div>
    </form>
  );
}

/** PAY-001: the receiver is always the signed-in member; one key per form, so a double click records once. */
function PayForm({ clinicId, v }: { clinicId: string; v: InvoiceDetail }) {
  const open = v.plan?.status === 'active' ? v.plan.installments.filter((i) => i.status === 'due' || i.status === 'partially_paid') : [];
  const [installmentId, setInstallmentId] = useState(open[0]?.id ?? '');
  const installment = open.find((i) => i.id === installmentId);
  const limit = installment ? installment.amount_minor - installment.paid_minor : v.balance_minor;
  const [amount, setAmount] = useState(String(limit / 100));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [key] = useState(newKey);
  const minor = toMinor(amount);
  const pay = useBillingMutation(clinicId, () => send(`/invoices/${v.id}/payments`, 'POST', {
    amountMinor: minor, method, idempotencyKey: key, ...(installment && { installmentId: installment.id }), ...(method !== 'cash' && reference.trim() && { reference: reference.trim() }), ...(notes.trim() && { notes: notes.trim() }),
  }));
  const ready = !!minor && minor > 0 && minor <= limit && (!NEEDS_REF.includes(method) || reference.trim().length > 0);
  return (
    <Card>
      <h2>{t('recordPayment')}</h2>
      <form className="stack mt" onSubmit={(e) => { e.preventDefault(); if (ready) pay.mutate(undefined); }}>
        {open.length > 0 && (
          <Field label={t('installment')}>
            {(a) => <Choice id={a.id} value={installmentId} onChange={(x) => { setInstallmentId(x); const i = open.find((y) => y.id === x); if (i) setAmount(String((i.amount_minor - i.paid_minor) / 100)); }}
              options={open.map((i) => ({ value: i.id, label: `${fmtNumber(i.seq)} · ${i.due_date} · ${money(i.amount_minor - i.paid_minor, v.currency)}` }))} />}
          </Field>
        )}
        <Field label={`${t('amount')} (${currencyLabel(v.currency)})`} hint={`${t(installment ? 'installmentLeft' : 'balance')}: ${money(limit, v.currency)}`}>
          {(a) => <Input id={a.id} describedBy={a.describedBy} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label={t('paymentMethod')}>
          {(a) => <Choice id={a.id} value={method} onChange={(x) => setMethod(x as PaymentMethod)} options={METHODS.map((x) => ({ value: x, label: t(`pm_${x}` as Key) }))} />}
        </Field>
        {method !== 'cash' && (
          <Field label={t('paymentReference')} optional={NEEDS_REF.includes(method) ? undefined : t('optional')} hint={t(`refHint_${method}` as Key)}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />}
          </Field>
        )}
        <Field label={t('notes')} optional={t('optional')}>{(a) => <Input id={a.id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}</Field>
        <ErrorText error={pay.error} />
        <Button type="submit" loading={pay.isPending} disabled={!ready}>{t('recordPayment')}</Button>
      </form>
    </Card>
  );
}

function PaymentsCard({ clinicId, v }: { clinicId: string; v: InvoiceDetail }) {
  const [reversing, setReversing] = useState<Payment | null>(null);
  const [refunding, setRefunding] = useState<Payment | null>(null);
  const fmt = new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' });
  if (v.status === 'draft') return null;
  return (
    <Card>
      <h2>{t('payments')}</h2>
      {v.payments.length === 0 ? <p className="muted small mt-sm">{t('noPayments')}</p> : (
        <ul className="stack mt">
          {v.payments.map((p) => (
            <li key={p.id} className={`rx-item${p.status === 'reversed' ? ' is-replaced' : ''}`}>
              <div className="row-between">
                <span>
                  <strong><bdi>{money(p.amount_minor, p.currency)}</bdi></strong> · {t(`pm_${p.method}` as Key)}
                  {p.reference && <> · <bdi dir="ltr">{p.reference}</bdi></>}{' '}
                  <Badge tone={p.status === 'reversed' ? 'neutral' : p.status === 'succeeded' ? 'success' : 'warning'}>{t(`ps_${p.status}` as Key)}</Badge>
                </span>
                <span className="row-end">
                  {p.status !== 'reversed' && <RouteLink route={to.printReceipt(p.id)} className="btn btn-ghost">{t('receipt')}</RouteLink>}
                  {p.can.refund && <LinkButton onClick={() => setRefunding(p)}>{t('refund')}</LinkButton>}
                  {p.can.reverse && <LinkButton onClick={() => setReversing(p)}>{t('reverse')}</LinkButton>}
                </span>
              </div>
              <span className="muted small">{fmt.format(new Date(p.paid_at))}{p.received_by_name && <> · {t('receivedBy')} <bdi>{p.received_by_name}</bdi></>}</span>
              {p.status === 'reversed' && <p className="small">{t('reversedBecause')}: <bdi>{p.reversal_reason}</bdi>{p.reversed_by_name && <> · <bdi>{p.reversed_by_name}</bdi></>}</p>}
              {p.refunds.map((r) => (
                <p key={r.id} className="small amendment">{t('refunded')} <bdi>{money(r.amount_minor, p.currency)}</bdi> · {t(`pm_${r.method}` as Key)} · <bdi>{r.reason}</bdi>
                  {r.created_by_name && <> · <bdi>{r.created_by_name}</bdi></>} · {fmt.format(new Date(r.refunded_at))}</p>
              ))}
            </li>
          ))}
        </ul>
      )}
      {reversing && <ReverseDialog clinicId={clinicId} payment={reversing} onClose={() => setReversing(null)} />}
      {refunding && <RefundDialog clinicId={clinicId} payment={refunding} onClose={() => setRefunding(null)} />}
    </Card>
  );
}

function ReverseDialog({ clinicId, payment, onClose }: { clinicId: string; payment: Payment; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const reverse = useBillingMutation(clinicId, () => send(`/payments/${payment.id}/reverse`, 'POST', { reason: reason.trim() }));
  return (
    <ConfirmDialog open title={t('reverse')} confirmLabel={t('reverse')} danger
      onConfirm={() => { if (reason.trim().length >= 3) reverse.mutate(undefined, { onSuccess: onClose }); }} onCancel={onClose}>
      <p>{t('reverseText')}</p>
      <Field label={t('reason')} hint={t('reasonHint')}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
      <ErrorText error={reverse.error} />
    </ConfirmDialog>
  );
}

function RefundDialog({ clinicId, payment, onClose }: { clinicId: string; payment: Payment; onClose: () => void }) {
  const left = payment.amount_minor - payment.refunded_minor;
  const [amount, setAmount] = useState(String(left / 100));
  const [method, setMethod] = useState<PaymentMethod>(payment.method);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const minor = toMinor(amount);
  const refund = useBillingMutation(clinicId, () => send(`/payments/${payment.id}/refunds`, 'POST', {
    amountMinor: minor, method, reason: reason.trim(), ...(method !== 'cash' && reference.trim() && { reference: reference.trim() }),
  }));
  return (
    <ConfirmDialog open title={t('refund')} confirmLabel={t('refund')} danger
      onConfirm={() => { if (minor && minor <= left && reason.trim().length >= 3) refund.mutate(undefined, { onSuccess: onClose }); }} onCancel={onClose}>
      <p>{t('refundText')}</p>
      <Field label={t('amount')} hint={`${t('refundable')}: ${money(left, payment.currency)}`}>
        {(a) => <Input id={a.id} describedBy={a.describedBy} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label={t('refundMethod')}>
        {(a) => <Choice id={a.id} value={method} onChange={(x) => setMethod(x as PaymentMethod)} options={METHODS.map((x) => ({ value: x, label: t(`pm_${x}` as Key) }))} />}
      </Field>
      {method !== 'cash' && <Field label={t('paymentReference')} optional={t('optional')}>{(a) => <Input id={a.id} dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />}</Field>}
      <Field label={t('reason')} hint={t('reasonHint')}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
      <ErrorText error={refund.error} />
    </ConfirmDialog>
  );
}
