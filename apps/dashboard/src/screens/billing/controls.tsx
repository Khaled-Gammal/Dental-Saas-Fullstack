import { useState } from 'react';
import { proposeSchedule, sharePercent } from '../../billing-model';
import { toMinor } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { t, type Key, type Lang } from '../../i18n';
import { money } from '../../money';
import { send, useBillingMutation } from '../../queries';
import type { DiscountStatus, DiscountType, InvoiceDetail, InvoiceLine } from '../../types';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, LinkButton } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { fmtNumber } from '../../util';

const todayIso = () => new Date().toLocaleDateString('en-CA');
const STATUS_TONE: Record<DiscountStatus, 'neutral' | 'primary' | 'success' | 'warning'> = {
  none: 'neutral', within_limit: 'success', pending: 'warning', approved: 'success', rejected: 'neutral',
};
const fmtDate = (iso: string, lang: Lang) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/** The form for one discount (DISC-001): a fixed amount or a percentage, always with a reason. */
function DiscountForm({ lang, currency, initial, onSave, onClear, pending, error }: {
  lang: Lang; currency: string; initial: { type: DiscountType | null; bp: number | null; minor: number; reason: string | null };
  onSave: (d: { type: DiscountType; value: number; reason: string }) => void; onClear?: () => void; pending: boolean; error: unknown;
}) {
  const [type, setType] = useState<DiscountType>(initial.type ?? 'percent');
  const [value, setValue] = useState(initial.type === 'percent' && initial.bp ? String(initial.bp / 100) : initial.minor ? String(initial.minor / 100) : '');
  const [reason, setReason] = useState(initial.reason ?? '');
  const parsed = type === 'percent' ? (Number(value) > 0 && Number(value) <= 100 ? Math.round(Number(value) * 100) : null) : toMinor(value);
  const ready = !!parsed && reason.trim().length >= 3;
  return (
    <div className="stack mt-sm tooth-panel">
      <div className="grid-2">
        <Field label={t('discountKind', lang)}>
          {(a) => <Choice id={a.id} lang={lang} value={type} onChange={(v) => setType(v as DiscountType)}
            options={[{ value: 'percent', label: t('discountPercent', lang) }, { value: 'amount', label: `${t('discountAmount', lang)} (${currency === 'EGP' ? t('egp', lang) : currency})` }]} />}
        </Field>
        <Field label={type === 'percent' ? t('percentValue', lang) : t('amount', lang)}>
          {(a) => <Input id={a.id} dir="ltr" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />}
        </Field>
      </div>
      <Field label={t('discountReason', lang)} hint={t('reasonHint', lang)}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
      <ErrorText error={error} />
      <div className="row-end">
        {onClear && <Button variant="ghost" onClick={onClear} loading={pending}>{t('removeDiscount', lang)}</Button>}
        <Button disabled={!ready} loading={pending} onClick={() => parsed && onSave({ type, value: parsed, reason: reason.trim() })}>{t('applyDiscount', lang)}</Button>
      </div>
    </div>
  );
}

/** DISC-001…003 on the invoice: the whole-invoice discount, the approval state, and the owner's decision. */
export function DiscountCard({ lang, clinicId, v }: { lang: Lang; clinicId: string; v: InvoiceDetail }) {
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const set = useBillingMutation(clinicId, (d: { type: DiscountType; value: number; reason: string } | null) =>
    send(`/invoices/${v.id}/discount`, d ? 'PUT' : 'DELETE', d ?? undefined));
  const decide = useBillingMutation(clinicId, (approve: boolean) => send(`/invoices/${v.id}/discount/${approve ? 'approve' : 'reject'}`, 'POST', approve ? { note: note.trim() || null } : { note: note.trim() }));
  const lineDiscounts = v.lines.reduce((s, l) => s + l.discount_minor, 0);
  const gross = v.lines.reduce((s, l) => s + l.quantity * l.unit_price_minor, 0);
  const total = lineDiscounts + v.discount_minor;
  if (v.status !== 'draft' && total === 0) return null;
  return (
    <Card>
      <div className="row-between">
        <h2>{t('discounts', lang)}</h2>
        {v.discount_status !== 'none' && <Badge tone={STATUS_TONE[v.discount_status]}>{t(`ds_${v.discount_status}` as Key, lang)}</Badge>}
      </div>
      {total > 0 && (
        <p className="small mt-sm">
          {t('discountTotal', lang)}: <strong><bdi>{money(total, lang, v.currency)}</bdi></strong> ({fmtNumber(sharePercent(total, gross), lang)}%)
          {v.discount_requested_by_name && <span className="muted"> · {t('requestedBy', lang)} <bdi>{v.discount_requested_by_name}</bdi></span>}
        </p>
      )}
      {v.discount_minor > 0 && <p className="small">{t('wholeInvoice', lang)}: <bdi>{money(v.discount_minor, lang, v.currency)}</bdi>{v.discount_type === 'percent' && v.discount_bp !== null && <> ({fmtNumber(v.discount_bp / 100, lang)}%)</>} — <bdi>{v.discount_reason}</bdi></p>}
      {v.discount_status === 'pending' && <Alert tone="info">{t('discountPendingText', lang)}</Alert>}
      {v.discount_status === 'rejected' && <Alert tone="danger">{t('discountRejectedText', lang)}{v.discount_note && <>: <bdi>{v.discount_note}</bdi></>}</Alert>}
      {v.discount_status === 'approved' && v.discount_decided_by_name && <p className="muted small">{t('approvedBy', lang)} <bdi>{v.discount_decided_by_name}</bdi>{v.discount_note && <> — <bdi>{v.discount_note}</bdi></>}</p>}
      {v.can.decideDiscount && (
        <div className="row-end mt-sm">
          <Button variant="ghost" onClick={() => { setNote(''); setDeciding('reject'); }}>{t('rejectDiscount', lang)}</Button>
          <Button onClick={() => { setNote(''); setDeciding('approve'); }}>{t('approveDiscount', lang)}</Button>
        </div>
      )}
      {v.can.discount && !editing && <div className="row-end mt-sm"><Button variant="secondary" onClick={() => setEditing(true)}>{t(v.discount_minor > 0 ? 'editWholeDiscount' : 'addWholeDiscount', lang)}</Button></div>}
      {v.can.discount && editing && (
        <DiscountForm lang={lang} currency={v.currency} initial={{ type: v.discount_type, bp: v.discount_bp, minor: v.discount_minor, reason: v.discount_reason }}
          pending={set.isPending} error={set.error}
          onSave={(d) => set.mutate(d, { onSuccess: () => setEditing(false) })}
          onClear={v.discount_minor > 0 ? () => set.mutate(null, { onSuccess: () => setEditing(false) }) : undefined} />
      )}
      <ConfirmDialog open={!!deciding} title={t(deciding === 'reject' ? 'rejectDiscount' : 'approveDiscount', lang)} confirmLabel={t(deciding === 'reject' ? 'rejectDiscount' : 'approveDiscount', lang)}
        danger={deciding === 'reject'} onCancel={() => setDeciding(null)}
        onConfirm={() => { if (deciding === 'approve' || note.trim().length >= 3) decide.mutate(deciding === 'approve', { onSettled: () => setDeciding(null) }); }}>
        <Field label={t('decisionNote', lang)} optional={deciding === 'approve' ? t('optional', lang) : undefined}>
          {(a) => <Input id={a.id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
        </Field>
        <ErrorText error={decide.error} />
      </ConfirmDialog>
    </Card>
  );
}

/** A line's discount (DISC-001), opened from the line. */
export function LineDiscount({ lang, clinicId, invoiceId, currency, line }: { lang: Lang; clinicId: string; invoiceId: string; currency: string; line: InvoiceLine }) {
  const [open, setOpen] = useState(false);
  const set = useBillingMutation(clinicId, (d: { type: DiscountType; value: number; reason: string } | null) =>
    send(`/invoices/${invoiceId}/lines/${line.id}/discount`, d ? 'PUT' : 'DELETE', d ?? undefined));
  return (
    <>
      <LinkButton onClick={() => setOpen(!open)}>{t(line.discount_minor > 0 ? 'editDiscount' : 'discount', lang)}</LinkButton>
      {open && (
        <div className="line-discount">
          <DiscountForm lang={lang} currency={currency} initial={{ type: line.discount_type, bp: line.discount_bp, minor: line.discount_minor, reason: line.discount_reason }}
            pending={set.isPending} error={set.error} onSave={(d) => set.mutate(d, { onSuccess: () => setOpen(false) })}
            onClear={line.discount_minor > 0 ? () => set.mutate(null, { onSuccess: () => setOpen(false) }) : undefined} />
        </div>
      )}
    </>
  );
}

/** PAY-004 + PAY-006: the installment plan, overdue marks, moving a date, the owner's waiver; or a form to create one. */
export function PlanCard({ lang, clinicId, v }: { lang: Lang; clinicId: string; v: InvoiceDetail }) {
  const plan = v.plan;
  const [creating, setCreating] = useState(false);
  const [waiving, setWaiving] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const move = useBillingMutation(clinicId, (a: { id: string; dueDate: string }) => send(`/installments/${a.id}`, 'PATCH', { dueDate: a.dueDate }));
  const waive = useBillingMutation(clinicId, (id: string) => send(`/installments/${id}/waive`, 'POST', { reason: reason.trim() }));
  const today = todayIso();
  if (!plan && !v.can.plan) return null;
  return (
    <Card>
      <div className="row-between">
        <h2>{t('installmentPlan', lang)}</h2>
        {plan && <Badge tone={plan.status === 'completed' ? 'success' : 'primary'}>{t(`plan_${plan.status}` as Key, lang)}</Badge>}
      </div>
      {plan ? (
        <ul className="line-list mt">
          {plan.installments.map((i) => {
            const open = i.status === 'due' || i.status === 'partially_paid';
            const late = open && i.due_date < today;
            return (
              <li key={i.id} className={i.status === 'waived' ? 'is-cancelled' : undefined}>
                <span>
                  <strong>{fmtNumber(i.seq, lang)}.</strong> {fmtDate(i.due_date, lang)}{' '}
                  <Badge tone={late ? 'warning' : i.status === 'paid' ? 'success' : 'neutral'}>{late ? t('overdue', lang) : t(`is_${i.status}` as Key, lang)}</Badge>
                  {i.status === 'waived' && <span className="muted small"> — <bdi>{i.waived_reason}</bdi>{i.waived_by_name && <> · <bdi>{i.waived_by_name}</bdi></>}</span>}
                </span>
                <span className="line-end">
                  <bdi>{money(i.amount_minor, lang, v.currency)}</bdi>
                  {i.paid_minor > 0 && i.status !== 'paid' && <span className="muted small">{t('paid', lang)} <bdi>{money(i.paid_minor, lang, v.currency)}</bdi></span>}
                  {open && v.can.pay && <input type="date" className="input input-sm" aria-label={t('moveDate', lang)} defaultValue={i.due_date} min={today}
                    onChange={(e) => { if (e.target.value) move.mutate({ id: i.id, dueDate: e.target.value }); }} />}
                  {open && v.can.adjust && <LinkButton onClick={() => { setReason(''); setWaiving(i.id); }}>{t('waive', lang)}</LinkButton>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : creating ? <PlanForm lang={lang} clinicId={clinicId} v={v} onDone={() => setCreating(false)} />
        : <div className="row-end mt-sm"><Button variant="secondary" onClick={() => setCreating(true)}>{t('splitInstallments', lang)}</Button></div>}
      <ErrorText error={move.error ?? waive.error} />
      <ConfirmDialog open={!!waiving} title={t('waive', lang)} confirmLabel={t('waive', lang)} danger onCancel={() => setWaiving(null)}
        onConfirm={() => { if (waiving && reason.trim().length >= 3) waive.mutate(waiving, { onSettled: () => setWaiving(null) }); }}>
        <p>{t('waiveText', lang)}</p>
        <Field label={t('reason', lang)} hint={t('reasonHint', lang)}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
      </ConfirmDialog>
    </Card>
  );
}

function PlanForm({ lang, clinicId, v, onDone }: { lang: Lang; clinicId: string; v: InvoiceDetail; onDone: () => void }) {
  const [count, setCount] = useState('3');
  const [first, setFirst] = useState(todayIso());
  const [rows, setRows] = useState(() => proposeSchedule(v.balance_minor, 3, todayIso()).map((r) => ({ dueDate: r.dueDate, amount: String(r.amountMinor / 100) })));
  const propose = (n: string, d: string) => setRows(proposeSchedule(v.balance_minor, Math.max(1, Math.min(60, Number(n) || 1)), d).map((r) => ({ dueDate: r.dueDate, amount: String(r.amountMinor / 100) })));
  const items = rows.map((r) => ({ dueDate: r.dueDate, amountMinor: toMinor(r.amount) ?? 0 }));
  const sum = items.reduce((s, i) => s + i.amountMinor, 0);
  const create = useBillingMutation(clinicId, () => send(`/invoices/${v.id}/plan`, 'POST', { installments: items }));
  return (
    <div className="stack mt">
      <div className="grid-2">
        <Field label={t('installmentsCount', lang)}>{(a) => <Input id={a.id} dir="ltr" inputMode="numeric" value={count} onChange={(e) => { const n = e.target.value.replace(/\D/g, '').slice(0, 2); setCount(n); if (n) propose(n, first); }} />}</Field>
        <Field label={t('firstDueDate', lang)}>{(a) => <DatePicker id={a.id} lang={lang} value={first} onChange={(d) => { setFirst(d); propose(count, d); }} min={todayIso()} />}</Field>
      </div>
      <ol className="stack-sm">
        {rows.map((r, k) => (
          <li key={k} className="row-between">
            <input type="date" className="input input-sm" value={r.dueDate} onChange={(e) => setRows((x) => x.map((y, j) => (j === k ? { ...y, dueDate: e.target.value } : y)))} aria-label={`${t('dueDate', lang)} ${k + 1}`} />
            <Input dir="ltr" inputMode="decimal" value={r.amount} onChange={(e) => setRows((x) => x.map((y, j) => (j === k ? { ...y, amount: e.target.value } : y)))} aria-label={`${t('amount', lang)} ${k + 1}`} />
          </li>
        ))}
      </ol>
      <p className={`small ${sum === v.balance_minor ? 'muted' : 'text-owed'}`}>{t('scheduleSum', lang)}: <bdi>{money(sum, lang, v.currency)}</bdi> / <bdi>{money(v.balance_minor, lang, v.currency)}</bdi></p>
      <ErrorText error={create.error} />
      <div className="row-end">
        <Button variant="ghost" onClick={onDone}>{t('cancel', lang)}</Button>
        <Button disabled={sum !== v.balance_minor || !rows.length} loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: onDone })}>{t('savePlan', lang)}</Button>
      </div>
    </div>
  );
}

/** PAY-006 (CLR-12): waivers and write-offs recorded on the invoice; the owner writes off a remainder. */
export function AdjustmentsCard({ lang, clinicId, v }: { lang: Lang; clinicId: string; v: InvoiceDetail }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const minor = toMinor(amount);
  const writeOff = useBillingMutation(clinicId, () => send(`/invoices/${v.id}/write-off`, 'POST', { amountMinor: minor, reason: reason.trim() }));
  if (!v.adjustments.length && !v.can.adjust) return null;
  return (
    <Card>
      <div className="row-between">
        <h2>{t('adjustments', lang)}</h2>
        {v.can.adjust && <Button variant="ghost" onClick={() => { setAmount(String(v.balance_minor / 100)); setReason(''); setOpen(true); }}>{t('writeOff', lang)}</Button>}
      </div>
      {v.adjustments.length === 0 ? <p className="muted small mt-sm">{t('noAdjustments', lang)}</p> : (
        <ul className="line-list mt-sm">
          {v.adjustments.map((a) => (
            <li key={a.id}>
              <span>{t(`adj_${a.kind}` as Key, lang)} — <bdi>{a.reason}</bdi>{a.created_by_name && <span className="muted small"> · <bdi>{a.created_by_name}</bdi></span>}</span>
              <span className="line-end"><bdi>{money(a.amount_minor, lang, v.currency)}</bdi></span>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={open} title={t('writeOff', lang)} confirmLabel={t('writeOff', lang)} danger onCancel={() => setOpen(false)}
        onConfirm={() => { if (minor && minor <= v.balance_minor && reason.trim().length >= 3) writeOff.mutate(undefined, { onSuccess: () => setOpen(false) }); }}>
        <p>{t('writeOffText', lang)}</p>
        <Field label={t('amount', lang)} hint={`${t('balance', lang)}: ${money(v.balance_minor, lang, v.currency)}`}>
          {(a) => <Input id={a.id} describedBy={a.describedBy} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label={t('reason', lang)} hint={t('reasonHint', lang)}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
        <ErrorText error={writeOff.error} />
      </ConfirmDialog>
    </Card>
  );
}
