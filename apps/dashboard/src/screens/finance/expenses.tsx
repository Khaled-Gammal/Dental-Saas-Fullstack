import { useState, type FormEvent } from 'react';
import { arName } from '@dental/ui/text';
import { toMinor, toPounds } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { EXPENSE_METHODS, localToday, monthOf, needsReference } from '../../finance-model';
import { t, type Key } from '../../i18n';
import { money } from '../../money';
import { send, useCashBranches, useExpenseCategories, useExpenses, useExpenseSettings, useFinanceMutation, usePendingExpenses } from '../../queries';
import type { Expense, ExpenseStatus, PaymentMethod } from '../../types';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, Skeleton, Switch } from '../../ui/components';
import { WalletIcon } from '../../ui/icons';

const STATUS_TONE: Record<ExpenseStatus, 'neutral' | 'primary' | 'success' | 'warning'> = { pending: 'warning', approved: 'success', rejected: 'neutral', void: 'neutral' };
const FILTERS = ['all', 'pending', 'approved', 'rejected', 'void'] as const;

export interface ExpenseRights { all: boolean; cash: boolean; read: boolean; approve: boolean }

/**
 * `#/expenses` (SRS EXP-001…004, CLR-03): the owner and the accountant record any expense, approved on entry;
 * reception records cash expenses up to the clinic's limit, which wait for the owner. Wrong ones are voided with a
 * reason and stay listed. The owner also keeps the categories and the reception limit here.
 */
export function Expenses({ clinicId, rights }: { clinicId: string; rights: ExpenseRights }) {
  const [period, setPeriod] = useState(() => monthOf(localToday()));
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('all');
  const [adding, setAdding] = useState(false);
  const list = useExpenses(clinicId, { ...period, status: status === 'all' ? undefined : status });
  return (
    <>
      <PageHeader title={t('navExpenses')} sub={t(rights.all ? 'expensesSub' : 'expensesSubReception')}
        action={!adding && <Button onClick={() => setAdding(true)}>{t('recordExpense')}</Button>} />
      {adding && <ExpenseForm clinicId={clinicId} rights={rights} onDone={() => setAdding(false)} />}
      {rights.approve && <PendingExpenses clinicId={clinicId} />}
      <Card>
        <div className="row-between">
          <div className="seg" role="tablist" aria-label={t('navExpenses')}>
            {FILTERS.map((f) => (
              <button key={f} type="button" className={`seg-btn${f === status ? ' is-on' : ''}`} role="tab" aria-selected={f === status} onClick={() => setStatus(f)}>
                {t(f === 'all' ? 'expf_all' : (`exp_${f}` as Key))}
              </button>
            ))}
          </div>
          <div className="period">
            <DatePicker label={t('fromDate')} value={period.from} onChange={(from) => setPeriod((p) => ({ ...p, from }))} max={period.to} />
            <DatePicker label={t('toDate')} value={period.to} onChange={(to) => setPeriod((p) => ({ ...p, to }))} min={period.from} />
          </div>
        </div>
        {list.isError ? <ErrorText error={list.error} onRetry={() => void list.refetch()} />
          : !list.data ? <Skeleton h={56} count={4} />
          : !list.data.items.length ? <EmptyState icon={<WalletIcon size={28} />} title={t('noExpenses')} text={t('noExpensesText')} />
          : (
            <ul className="line-list mt">
              {list.data.items.map((e) => <ExpenseRow key={e.id} clinicId={clinicId} e={e} rights={rights} />)}
            </ul>
          )}
      </Card>
      {list.data?.byCategory && list.data.byCategory.length > 0 && (
        <Card>
          <h2>{t('byCategory')}</h2>
          <p className="muted small">{t('byCategorySub')}</p>
          <ul className="line-list mt-sm">
            {list.data.byCategory.map((c) => <li key={c.id}><span>{c.name}</span><span className="line-end"><bdi>{money(c.amount)}</bdi></span></li>)}
            <li className="line-total"><strong>{t('total')}</strong><span className="line-end"><strong><bdi>{money(list.data.byCategory.reduce((s, c) => s + c.amount, 0))}</bdi></strong></span></li>
          </ul>
        </Card>
      )}
      {rights.approve && <ExpenseSettingsCard clinicId={clinicId} />}
    </>
  );
}

function ExpenseForm({ clinicId, rights, onDone }: { clinicId: string; rights: ExpenseRights; onDone: () => void }) {
  const branches = useCashBranches(clinicId);
  const categories = useExpenseCategories(clinicId);
  const today = localToday();
  const [branchId, setBranchId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [spentOn, setSpentOn] = useState(today);
  const [supplier, setSupplier] = useState('');
  const [description, setDescription] = useState('');
  const list = branches.data ?? [];
  const branch = branchId || (list.length === 1 ? list[0].id : '');
  const minor = toMinor(amount);
  const methods = rights.all ? EXPENSE_METHODS : (['cash'] as PaymentMethod[]);
  const save = useFinanceMutation(clinicId, () => send<Expense>('/expenses', 'POST', {
    branchId: branch, categoryId, amountMinor: minor, method, spentOn, reference: reference.trim(), supplierName: supplier.trim(), description: description.trim(),
  }));
  const ready = !!branch && !!categoryId && !!minor && minor > 0 && (!needsReference(method) || reference.trim().length > 0);
  const submit = (e: FormEvent) => { e.preventDefault(); if (ready) save.mutate(undefined, { onSuccess: onDone }); };
  return (
    <Card as="form" className="stack">
      <h2>{t('recordExpense')}</h2>
      {!rights.all && <Alert tone="info">{t('receptionExpenseNote')}</Alert>}
      <div className="grid-2">
        <Field label={t('branch')}>
          {(a) => <Choice id={a.id} value={branch} onChange={setBranchId} placeholder={t('pickBranch')}
            options={list.map((b) => ({ value: b.id, label: arName(b.name_ar, b.name_en) }))} />}
        </Field>
        <Field label={t('expenseCategory')}>
          {(a) => <Choice id={a.id} value={categoryId} onChange={setCategoryId} placeholder={t('pickCategory')}
            options={(categories.data ?? []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name }))} />}
        </Field>
        <Field label={t('amount')}>{(a) => <Input id={a.id} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!amount && minor === null} />}</Field>
        <Field label={t('paymentMethod')}>
          {(a) => <Choice id={a.id} value={method} onChange={(x) => setMethod(x as PaymentMethod)} disabled={methods.length === 1}
            options={methods.map((x) => ({ value: x, label: t(`pm_${x}` as Key) }))} />}
        </Field>
        {method !== 'cash' && (
          <Field label={t('paymentReference')} optional={needsReference(method) ? undefined : t('optional')} hint={t(`refHint_${method}` as Key)}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />}
          </Field>
        )}
        <Field label={t('expenseDate')}>{(a) => <DatePicker id={a.id} value={spentOn} onChange={setSpentOn} max={today} />}</Field>
        <Field label={t('supplier')} optional={t('optional')}>{(a) => <Input id={a.id} value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={120} />}</Field>
        <Field label={t('lineDescription')} optional={t('optional')}>{(a) => <Input id={a.id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />}</Field>
      </div>
      <ErrorText error={save.error} />
      <div className="row-end">
        <Button variant="ghost" onClick={onDone}>{t('cancel')}</Button>
        <Button type="submit" onClick={submit} loading={save.isPending} disabled={!ready}>{t('save')}</Button>
      </div>
    </Card>
  );
}

function ExpenseRow({ clinicId, e, rights }: { clinicId: string; e: Expense; rights: ExpenseRights }) {
  const [voiding, setVoiding] = useState(false);
  const canVoid = e.status !== 'void' && (rights.all || (!rights.read && e.status === 'pending'));
  return (
    <li>
      <span>
        <strong>{e.category_name}</strong> <Badge tone={STATUS_TONE[e.status]}>{t(`exp_${e.status}` as Key)}</Badge>
        <span className="muted small"> · {e.spent_on} · <bdi>{arName(e.branch.name_ar, e.branch.name_en)}</bdi>
          {e.payment_method && <> · {t(`pm_${e.payment_method}` as Key)}</>}{e.reference && <> · <bdi dir="ltr">{e.reference}</bdi></>}</span>
        {(e.description || e.supplier_name) && <span className="small block"><bdi>{[e.supplier_name, e.description].filter(Boolean).join(' — ')}</bdi></span>}
        <span className="muted small block">{t('recordedBy')} <bdi>{e.created_by_name}</bdi>
          {e.approved_by_name && <> · {t(e.status === 'rejected' ? 'rejectedBy' : 'approvedBy')} <bdi>{e.approved_by_name}</bdi></>}
          {e.decision_note && <> — <bdi>{e.decision_note}</bdi></>}</span>
        {e.status === 'void' && <span className="small block">{t('voidedBecause')}: <bdi>{e.void_reason}</bdi>{e.voided_by_name && <> · <bdi>{e.voided_by_name}</bdi></>}</span>}
      </span>
      <span className="line-end">
        <bdi className={e.status === 'void' ? 'struck' : undefined}>{money(e.amount_minor, e.currency)}</bdi>
        {canVoid && <Button variant="ghost" onClick={() => setVoiding(true)}>{t('voidExpense')}</Button>}
      </span>
      {voiding && <VoidDialog clinicId={clinicId} e={e} onClose={() => setVoiding(false)} />}
    </li>
  );
}

function VoidDialog({ clinicId, e, onClose }: { clinicId: string; e: Expense; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const act = useFinanceMutation(clinicId, () => send(`/expenses/${e.id}/void`, 'POST', { reason: reason.trim() }));
  return (
    <ConfirmDialog open title={t('voidExpense')} confirmLabel={t('voidExpense')} danger
      onConfirm={() => { if (reason.trim().length >= 3) act.mutate(undefined, { onSuccess: onClose }); }} onCancel={onClose}>
      <p>{t('voidExpenseText')}</p>
      <Field label={t('reason')} hint={t('reasonHint')}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(x) => setReason(x.target.value)} maxLength={500} />}</Field>
      <ErrorText error={act.error} />
    </ConfirmDialog>
  );
}

/** EXP-003: reception's cash expenses waiting for the owner. */
function PendingExpenses({ clinicId }: { clinicId: string }) {
  const pending = usePendingExpenses(clinicId);
  if (pending.isError) return <Card><ErrorText error={pending.error} onRetry={() => void pending.refetch()} /></Card>;
  if (!pending.data?.length) return null;
  return (
    <Card>
      <h2>{t('awaitingApproval')}</h2>
      <ul className="line-list mt-sm">{pending.data.map((e) => <PendingRow key={e.id} clinicId={clinicId} e={e} />)}</ul>
    </Card>
  );
}

function PendingRow({ clinicId, e }: { clinicId: string; e: Expense }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const approve = useFinanceMutation(clinicId, () => send(`/expenses/${e.id}/approve`, 'POST', {}));
  const reject = useFinanceMutation(clinicId, () => send(`/expenses/${e.id}/reject`, 'POST', { note: note.trim() }));
  return (
    <li>
      <span>
        <strong>{e.category_name}</strong> · <bdi>{money(e.amount_minor, e.currency)}</bdi>
        <span className="muted small"> · {e.spent_on} · <bdi>{arName(e.branch.name_ar, e.branch.name_en)}</bdi> · {t('recordedBy')} <bdi>{e.created_by_name}</bdi></span>
        {e.description && <span className="small block"><bdi>{e.description}</bdi></span>}
        <ErrorText error={approve.error ?? reject.error} />
      </span>
      <span className="line-end">
        <Button variant="secondary" loading={approve.isPending} onClick={() => approve.mutate(undefined)}>{t('approve')}</Button>
        <Button variant="ghost" onClick={() => setRejecting(true)}>{t('reject')}</Button>
      </span>
      {rejecting && (
        <ConfirmDialog open title={t('reject')} confirmLabel={t('reject')} danger
          onConfirm={() => { if (note.trim().length >= 3) reject.mutate(undefined, { onSuccess: () => setRejecting(false) }); }} onCancel={() => setRejecting(false)}>
          <p>{t('rejectExpenseText')}</p>
          <Field label={t('reason')} hint={t('reasonHint')}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={note} onChange={(x) => setNote(x.target.value)} maxLength={500} />}</Field>
          <ErrorText error={reject.error} />
        </ConfirmDialog>
      )}
    </li>
  );
}

/** EXP-002 and CLR-03: the owner's categories (renamed or deactivated, never deleted) and the reception limit. */
function ExpenseSettingsCard({ clinicId }: { clinicId: string }) {
  const categories = useExpenseCategories(clinicId);
  const settings = useExpenseSettings(clinicId);
  const [name, setName] = useState('');
  const [limit, setLimit] = useState<string | null>(null);
  const add = useFinanceMutation(clinicId, () => send('/expenses/categories', 'POST', { name: name.trim() }));
  const toggle = useFinanceMutation(clinicId, (v: { id: string; isActive: boolean }) => send(`/expenses/categories/${v.id}`, 'PATCH', { isActive: v.isActive }));
  const limitText = limit ?? (settings.data ? toPounds(settings.data.receptionLimitMinor) : '');
  const limitMinor = toMinor(limitText);
  const saveLimit = useFinanceMutation(clinicId, () => send('/expenses/settings', 'PATCH', { receptionLimitMinor: limitMinor }));
  return (
    <Card>
      <h2>{t('expenseSettings')}</h2>
      <Field label={t('receptionLimit')} hint={t('receptionLimitHint')}>
        {(a) => (
          <div className="row-start">
            <Input id={a.id} describedBy={a.describedBy} className="input-sm" dir="ltr" inputMode="decimal" value={limitText} onChange={(e) => setLimit(e.target.value)} invalid={limitMinor === null} />
            <Button variant="secondary" disabled={limitMinor === null || limitMinor === settings.data?.receptionLimitMinor} loading={saveLimit.isPending}
              onClick={() => saveLimit.mutate(undefined, { onSuccess: () => setLimit(null) })}>{t('save')}</Button>
          </div>
        )}
      </Field>
      <ErrorText error={saveLimit.error} />
      <h3 className="mt">{t('expenseCategories')}</h3>
      {categories.data && (
        <ul className="line-list mt-sm">
          {categories.data.map((c) => (
            <li key={c.id}>
              <span className={c.is_active ? undefined : 'muted'}>{c.name}{c.uses > 0 && <span className="muted small"> · {t('usedTimes').replace('{n}', String(c.uses))}</span>}</span>
              <span className="line-end"><Switch checked={c.is_active} label={t('categoryActive')} onChange={(v) => toggle.mutate({ id: c.id, isActive: v })} /></span>
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={toggle.error} />
      <form className="row-start mt" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) add.mutate(undefined, { onSuccess: () => setName('') }); }}>
        <Input aria-label={t('newCategory')} placeholder={t('newCategory')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <Button type="submit" variant="secondary" loading={add.isPending} disabled={name.trim().length < 2}>{t('add')}</Button>
      </form>
      <ErrorText error={add.error} />
    </Card>
  );
}
