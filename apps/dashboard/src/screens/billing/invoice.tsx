import { useState } from 'react';
import { pickName } from '@dental/ui/text';
import { toMinor } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { navigate } from '../../hooks';
import { t, type Key, type Lang } from '../../i18n';
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
const loc = (lang: Lang) => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * `#/invoices/<id>/view` (SRS BILLING-001…004, PAY-001…003, PAY-005): the invoice, its lines and totals (all derived
 * by the database), issue / void, the payments with who received each, reversals and refunds, and printing.
 */
export function InvoicePage({ lang, clinicId, id }: { lang: Lang; clinicId: string; id?: string }) {
  const inv = useInvoice(clinicId, id);
  const [dialog, setDialog] = useState<'issue' | 'void' | 'delete' | null>(null);
  const [reason, setReason] = useState('');
  const act = useBillingMutation(clinicId, (op: 'issue' | 'void' | 'delete') =>
    op === 'delete' ? send(`/invoices/${id}`, 'DELETE') : send(`/invoices/${id}/${op}`, 'POST', op === 'void' ? { reason: reason.trim() } : undefined));
  if (!inv.data) {
    return <ResourceState isLoading={inv.isLoading} isError={inv.isError} error={inv.error} notFound={false} refetch={() => void inv.refetch()} back={{ page: 'invoices' }} backLabel={t('navBilling', lang)} />;
  }
  const v = inv.data;
  const m = (x: number) => money(x, lang, v.currency);
  return (
    <>
      <Breadcrumbs items={[{ label: t('navBilling', lang), route: { page: 'invoices' } }, { label: v.patient.full_name, route: to.view('patients', v.patient.id) }, { label: v.number ?? t('draftInvoice', lang) }]} />
      <PageHeader
        title={v.number ? `${t('invoice', lang)} ${v.number}` : t('draftInvoice', lang)}
        sub={`${v.patient.full_name} · ${t('fileNo', lang)} ${fmtNumber(v.patient.file_no, lang)} · ${pickName(lang, v.branch.name_ar, v.branch.name_en)}${v.issue_date ? ` · ${v.issue_date}` : ''}`}
        action={<div className="row-end">
          <Badge tone={STATUS_TONE[v.status]}>{t(`inv_${v.status}` as Key, lang)}</Badge>
          {v.status !== 'draft' && <RouteLink route={to.printInvoice(v.id)} className="btn btn-secondary">{t('print', lang)}</RouteLink>}
          {v.can.issue && <Button onClick={() => setDialog('issue')} disabled={!v.lines.length}>{t('issueInvoice', lang)}</Button>}
          {v.can.edit && <Button variant="ghost" onClick={() => setDialog('delete')}>{t('deleteDraft', lang)}</Button>}
          {v.can.void && <Button variant="ghost" onClick={() => { setReason(''); setDialog('void'); }}>{t('voidInvoice', lang)}</Button>}
        </div>}
      />
      {v.status === 'void' && <Alert tone="info">{t('voidedBecause', lang)}: <bdi>{v.void_reason}</bdi>{v.voided_by_name && <> · <bdi>{v.voided_by_name}</bdi></>}</Alert>}
      <ErrorText error={act.error} />
      <div className="profile-grid">
        <div className="stack">
          <LinesCard lang={lang} clinicId={clinicId} v={v} />
          <PaymentsCard lang={lang} clinicId={clinicId} v={v} />
        </div>
        <div className="stack">
          <DiscountCard lang={lang} clinicId={clinicId} v={v} />
          <Card>
            <h2>{t('totals', lang)}</h2>
            <dl className="detail-list mt">
              <div><dt>{t('subtotal', lang)}</dt><dd><bdi>{m(v.subtotal_minor)}</bdi></dd></div>
              {v.discount_minor > 0 && <div><dt>{t('discount', lang)}</dt><dd><bdi>− {m(v.discount_minor)}</bdi></dd></div>}
              {(v.status === 'draft' ? v.tax_preview_minor : v.tax_minor) > 0 && (
                <div><dt>{t('tax', lang)} ({fmtNumber(v.tax_rate_bp / 100, lang)}%)</dt><dd><bdi>{m(v.status === 'draft' ? v.tax_preview_minor : v.tax_minor)}</bdi></dd></div>
              )}
              <div><dt><strong>{t('total', lang)}</strong></dt><dd><strong><bdi>{m(v.status === 'draft' ? v.subtotal_minor - v.discount_minor + v.tax_preview_minor : v.total_minor)}</bdi></strong></dd></div>
              {v.status !== 'draft' && <div><dt>{t('paid', lang)}</dt><dd><bdi>{m(v.paid_minor)}</bdi></dd></div>}
              {v.adjusted_minor > 0 && <div><dt>{t('adjustments', lang)}</dt><dd><bdi>{m(v.adjusted_minor)}</bdi></dd></div>}
              {v.status !== 'draft' && v.status !== 'void' && <div><dt><strong>{t('balance', lang)}</strong></dt><dd><strong><bdi>{m(v.balance_minor)}</bdi></strong></dd></div>}
            </dl>
            {v.status === 'draft' && <p className="muted small mt-sm">{t('draftNote', lang)}</p>}
          </Card>
          <PlanCard lang={lang} clinicId={clinicId} v={v} />
          <AdjustmentsCard lang={lang} clinicId={clinicId} v={v} />
          {v.can.pay && <PayForm key={`${v.paid_minor}-${v.adjusted_minor}`} lang={lang} clinicId={clinicId} v={v} />}
        </div>
      </div>
      <ConfirmDialog open={dialog === 'issue'} title={t('issueInvoice', lang)} confirmLabel={t('issueInvoice', lang)}
        onConfirm={() => act.mutate('issue', { onSettled: () => setDialog(null) })} onCancel={() => setDialog(null)}>
        <p>{t('issueText', lang)}</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'delete'} title={t('deleteDraft', lang)} confirmLabel={t('deleteDraft', lang)} danger
        onConfirm={() => act.mutate('delete', { onSuccess: () => navigate(to.view('patients', v.patient.id)), onSettled: () => setDialog(null) })} onCancel={() => setDialog(null)}>
        <p>{t('deleteDraftText', lang)}</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'void'} title={t('voidInvoice', lang)} confirmLabel={t('voidInvoice', lang)} danger
        onConfirm={() => { if (reason.trim().length >= 3) act.mutate('void', { onSettled: () => setDialog(null) }); }} onCancel={() => setDialog(null)}>
        <p>{t('voidText', lang)}</p>
        <Field label={t('reason', lang)} hint={t('reasonHint', lang)}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
      </ConfirmDialog>
    </>
  );
}

function LinesCard({ lang, clinicId, v }: { lang: Lang; clinicId: string; v: InvoiceDetail }) {
  const remove = useBillingMutation(clinicId, (lineId: string) => send(`/invoices/${v.id}/lines/${lineId}`, 'DELETE'));
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <div className="row-between">
        <h2>{t('invoiceLines', lang)}</h2>
        {v.can.edit && !adding && <Button variant="secondary" onClick={() => setAdding(true)}>{t('addLine', lang)}</Button>}
      </div>
      <ul className="line-list mt">
        {v.lines.map((l) => (
          <li key={l.id}>
            <span><bdi>{l.description}</bdi>{l.quantity > 1 && <span className="muted small"> × {fmtNumber(l.quantity, lang)}</span>}
              {l.discount_minor > 0 && <span className="muted small"> · {t('discount', lang)} <bdi>{money(l.discount_minor, lang, v.currency)}</bdi> — <bdi>{l.discount_reason}</bdi></span>}</span>
            <span className="line-end">
              <bdi>{money(l.line_total_minor, lang, v.currency)}</bdi>
              {v.can.discount && <LineDiscount lang={lang} clinicId={clinicId} invoiceId={v.id} currency={v.currency} line={l} />}
              {v.can.edit && <LinkButton onClick={() => remove.mutate(l.id)}>{t('remove', lang)}</LinkButton>}
            </span>
          </li>
        ))}
      </ul>
      <ErrorText error={remove.error} />
      {adding && <LineForm lang={lang} clinicId={clinicId} invoiceId={v.id} onDone={() => setAdding(false)} />}
    </Card>
  );
}

function LineForm({ lang, clinicId, invoiceId, onDone }: { lang: Lang; clinicId: string; invoiceId: string; onDone: () => void }) {
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
        <Field label={t('service', lang)} optional={t('optional', lang)}>
          {(a) => <Choice id={a.id} lang={lang} value={serviceId} onChange={setServiceId} noneLabel={t('otherLine', lang)}
            options={(services.data ?? []).filter((s) => s.is_active).map((s) => ({ value: s.id, label: pickName(lang, s.name_ar, s.name_en) }))} />}
        </Field>
        {!serviceId && <Field label={t('lineDescription', lang)}>{(a) => <Input id={a.id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />}</Field>}
        <Field label={t('unitPrice', lang)} optional={serviceId ? t('optional', lang) : undefined}>
          {(a) => <Input id={a.id} dir="ltr" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />}
        </Field>
        <Field label={t('quantity', lang)}>{(a) => <Input id={a.id} dir="ltr" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, '').slice(0, 3))} />}</Field>
      </div>
      <ErrorText error={add.error} />
      <div className="row-end"><Button variant="ghost" onClick={onDone}>{t('cancel', lang)}</Button><Button type="submit" loading={add.isPending} disabled={!ready}>{t('addLine', lang)}</Button></div>
    </form>
  );
}

/** PAY-001: the receiver is always the signed-in member; one key per form, so a double click records once. */
function PayForm({ lang, clinicId, v }: { lang: Lang; clinicId: string; v: InvoiceDetail }) {
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
      <h2>{t('recordPayment', lang)}</h2>
      <form className="stack mt" onSubmit={(e) => { e.preventDefault(); if (ready) pay.mutate(undefined); }}>
        {open.length > 0 && (
          <Field label={t('installment', lang)}>
            {(a) => <Choice id={a.id} lang={lang} value={installmentId} onChange={(x) => { setInstallmentId(x); const i = open.find((y) => y.id === x); if (i) setAmount(String((i.amount_minor - i.paid_minor) / 100)); }}
              options={open.map((i) => ({ value: i.id, label: `${fmtNumber(i.seq, lang)} · ${i.due_date} · ${money(i.amount_minor - i.paid_minor, lang, v.currency)}` }))} />}
          </Field>
        )}
        <Field label={`${t('amount', lang)} (${currencyLabel(lang, v.currency)})`} hint={`${t(installment ? 'installmentLeft' : 'balance', lang)}: ${money(limit, lang, v.currency)}`}>
          {(a) => <Input id={a.id} describedBy={a.describedBy} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label={t('paymentMethod', lang)}>
          {(a) => <Choice id={a.id} lang={lang} value={method} onChange={(x) => setMethod(x as PaymentMethod)} options={METHODS.map((x) => ({ value: x, label: t(`pm_${x}` as Key, lang) }))} />}
        </Field>
        {method !== 'cash' && (
          <Field label={t('paymentReference', lang)} optional={NEEDS_REF.includes(method) ? undefined : t('optional', lang)} hint={t(`refHint_${method}` as Key, lang)}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />}
          </Field>
        )}
        <Field label={t('notes', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}</Field>
        <ErrorText error={pay.error} />
        <Button type="submit" loading={pay.isPending} disabled={!ready}>{t('recordPayment', lang)}</Button>
      </form>
    </Card>
  );
}

function PaymentsCard({ lang, clinicId, v }: { lang: Lang; clinicId: string; v: InvoiceDetail }) {
  const [reversing, setReversing] = useState<Payment | null>(null);
  const [refunding, setRefunding] = useState<Payment | null>(null);
  const fmt = new Intl.DateTimeFormat(loc(lang), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' });
  if (v.status === 'draft') return null;
  return (
    <Card>
      <h2>{t('payments', lang)}</h2>
      {v.payments.length === 0 ? <p className="muted small mt-sm">{t('noPayments', lang)}</p> : (
        <ul className="stack mt">
          {v.payments.map((p) => (
            <li key={p.id} className={`rx-item${p.status === 'reversed' ? ' is-replaced' : ''}`}>
              <div className="row-between">
                <span>
                  <strong><bdi>{money(p.amount_minor, lang, p.currency)}</bdi></strong> · {t(`pm_${p.method}` as Key, lang)}
                  {p.reference && <> · <bdi dir="ltr">{p.reference}</bdi></>}{' '}
                  <Badge tone={p.status === 'reversed' ? 'neutral' : p.status === 'succeeded' ? 'success' : 'warning'}>{t(`ps_${p.status}` as Key, lang)}</Badge>
                </span>
                <span className="row-end">
                  {p.status !== 'reversed' && <RouteLink route={to.printReceipt(p.id)} className="btn btn-ghost">{t('receipt', lang)}</RouteLink>}
                  {p.can.refund && <LinkButton onClick={() => setRefunding(p)}>{t('refund', lang)}</LinkButton>}
                  {p.can.reverse && <LinkButton onClick={() => setReversing(p)}>{t('reverse', lang)}</LinkButton>}
                </span>
              </div>
              <span className="muted small">{fmt.format(new Date(p.paid_at))}{p.received_by_name && <> · {t('receivedBy', lang)} <bdi>{p.received_by_name}</bdi></>}</span>
              {p.status === 'reversed' && <p className="small">{t('reversedBecause', lang)}: <bdi>{p.reversal_reason}</bdi>{p.reversed_by_name && <> · <bdi>{p.reversed_by_name}</bdi></>}</p>}
              {p.refunds.map((r) => (
                <p key={r.id} className="small amendment">{t('refunded', lang)} <bdi>{money(r.amount_minor, lang, p.currency)}</bdi> · {t(`pm_${r.method}` as Key, lang)} · <bdi>{r.reason}</bdi>
                  {r.created_by_name && <> · <bdi>{r.created_by_name}</bdi></>} · {fmt.format(new Date(r.refunded_at))}</p>
              ))}
            </li>
          ))}
        </ul>
      )}
      {reversing && <ReverseDialog lang={lang} clinicId={clinicId} payment={reversing} onClose={() => setReversing(null)} />}
      {refunding && <RefundDialog lang={lang} clinicId={clinicId} payment={refunding} onClose={() => setRefunding(null)} />}
    </Card>
  );
}

function ReverseDialog({ lang, clinicId, payment, onClose }: { lang: Lang; clinicId: string; payment: Payment; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const reverse = useBillingMutation(clinicId, () => send(`/payments/${payment.id}/reverse`, 'POST', { reason: reason.trim() }));
  return (
    <ConfirmDialog open title={t('reverse', lang)} confirmLabel={t('reverse', lang)} danger
      onConfirm={() => { if (reason.trim().length >= 3) reverse.mutate(undefined, { onSuccess: onClose }); }} onCancel={onClose}>
      <p>{t('reverseText', lang)}</p>
      <Field label={t('reason', lang)} hint={t('reasonHint', lang)}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
      <ErrorText error={reverse.error} />
    </ConfirmDialog>
  );
}

function RefundDialog({ lang, clinicId, payment, onClose }: { lang: Lang; clinicId: string; payment: Payment; onClose: () => void }) {
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
    <ConfirmDialog open title={t('refund', lang)} confirmLabel={t('refund', lang)} danger
      onConfirm={() => { if (minor && minor <= left && reason.trim().length >= 3) refund.mutate(undefined, { onSuccess: onClose }); }} onCancel={onClose}>
      <p>{t('refundText', lang)}</p>
      <Field label={t('amount', lang)} hint={`${t('refundable', lang)}: ${money(left, lang, payment.currency)}`}>
        {(a) => <Input id={a.id} describedBy={a.describedBy} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label={t('refundMethod', lang)}>
        {(a) => <Choice id={a.id} lang={lang} value={method} onChange={(x) => setMethod(x as PaymentMethod)} options={METHODS.map((x) => ({ value: x, label: t(`pm_${x}` as Key, lang) }))} />}
      </Field>
      {method !== 'cash' && <Field label={t('paymentReference', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />}</Field>}
      <Field label={t('reason', lang)} hint={t('reasonHint', lang)}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
      <ErrorText error={refund.error} />
    </ConfirmDialog>
  );
}
