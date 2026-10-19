import { useState, type FormEvent } from 'react';
import { pickName } from '@dental/ui/text';
import { toMinor, toPounds } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { EXPENSE_METHODS, localToday, monthOf, needsReference } from '../../finance-model';
import { t, type Key, type Lang } from '../../i18n';
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
export function Expenses({ lang, clinicId, rights }: { lang: Lang; clinicId: string; rights: ExpenseRights }) {
  const [period, setPeriod] = useState(() => monthOf(localToday()));
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('all');
  const [adding, setAdding] = useState(false);
  const list = useExpenses(clinicId, { ...period, status: status === 'all' ? undefined : status });
  return (
    <>
      <PageHeader title={t('navExpenses', lang)} sub={t(rights.all ? 'expensesSub' : 'expensesSubReception', lang)}
        action={!adding && <Button onClick={() => setAdding(true)}>{t('recordExpense', lang)}</Button>} />
      {adding && <ExpenseForm lang={lang} clinicId={clinicId} rights={rights} onDone={() => setAdding(false)} />}
      {rights.approve && <PendingExpenses lang={lang} clinicId={clinicId} />}
      <Card>
        <div className="row-between">
          <div className="seg" role="tablist" aria-label={t('navExpenses', lang)}>
            {FILTERS.map((f) => (
              <button key={f} type="button" className={`seg-btn${f === status ? ' is-on' : ''}`} role="tab" aria-selected={f === status} onClick={() => setStatus(f)}>
                {t(f === 'all' ? 'expf_all' : (`exp_${f}` as Key), lang)}
              </button>
            ))}
          </div>
          <div className="period">
            <DatePicker lang={lang} label={t('fromDate', lang)} value={period.from} onChange={(from) => setPeriod((p) => ({ ...p, from }))} max={period.to} />
            <DatePicker lang={lang} label={t('toDate', lang)} value={period.to} onChange={(to) => setPeriod((p) => ({ ...p, to }))} min={period.from} />
          </div>
        </div>
        {list.isError ? <ErrorText error={list.error} onRetry={() => void list.refetch()} />
          : !list.data ? <Skeleton h={56} count={4} />
          : !list.data.items.length ? <EmptyState icon={<WalletIcon size={28} />} title={t('noExpenses', lang)} text={t('noExpensesText', lang)} />
          : (
            <ul className="line-list mt">
              {list.data.items.map((e) => <ExpenseRow key={e.id} lang={lang} clinicId={clinicId} e={e} rights={rights} />)}
            </ul>
          )}
      </Card>
      {list.data?.byCategory && list.data.byCategory.length > 0 && (
        <Card>
          <h2>{t('byCategory', lang)}</h2>
          <p className="muted small">{t('byCategorySub', lang)}</p>
          <ul className="line-list mt-sm">
            {list.data.byCategory.map((c) => <li key={c.id}><span>{c.name}</span><span className="line-end"><bdi>{money(c.amount, lang)}</bdi></span></li>)}
            <li className="line-total"><strong>{t('total', lang)}</strong><span className="line-end"><strong><bdi>{money(list.data.byCategory.reduce((s, c) => s + c.amount, 0), lang)}</bdi></strong></span></li>
          </ul>
        </Card>
      )}
      {rights.approve && <ExpenseSettingsCard lang={lang} clinicId={clinicId} />}
    </>
  );
}

function ExpenseForm({ lang, clinicId, rights, onDone }: { lang: Lang; clinicId: string; rights: ExpenseRights; onDone: () => void }) {
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
      <h2>{t('recordExpense', lang)}</h2>
      {!rights.all && <Alert tone="info">{t('receptionExpenseNote', lang)}</Alert>}
      <div className="grid-2">
        <Field label={t('branch', lang)}>
          {(a) => <Choice id={a.id} lang={lang} value={branch} onChange={setBranchId} placeholder={t('pickBranch', lang)}
            options={list.map((b) => ({ value: b.id, label: pickName(lang, b.name_ar, b.name_en) }))} />}
        </Field>
        <Field label={t('expenseCategory', lang)}>
          {(a) => <Choice id={a.id} lang={lang} value={categoryId} onChange={setCategoryId} placeholder={t('pickCategory', lang)}
            options={(categories.data ?? []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name }))} />}
        </Field>
        <Field label={t('amount', lang)}>{(a) => <Input id={a.id} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!amount && minor === null} />}</Field>
        <Field label={t('paymentMethod', lang)}>
          {(a) => <Choice id={a.id} lang={lang} value={method} onChange={(x) => setMethod(x as PaymentMethod)} disabled={methods.length === 1}
            options={methods.map((x) => ({ value: x, label: t(`pm_${x}` as Key, lang) }))} />}
        </Field>
        {method !== 'cash' && (
          <Field label={t('paymentReference', lang)} optional={needsReference(method) ? undefined : t('optional', lang)} hint={t(`refHint_${method}` as Key, lang)}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />}
          </Field>
        )}
        <Field label={t('expenseDate', lang)}>{(a) => <DatePicker id={a.id} lang={lang} value={spentOn} onChange={setSpentOn} max={today} />}</Field>
        <Field label={t('supplier', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={120} />}</Field>
        <Field label={t('lineDescription', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />}</Field>
      </div>
      <ErrorText error={save.error} />
      <div className="row-end">
        <Button variant="ghost" onClick={onDone}>{t('cancel', lang)}</Button>
        <Button type="submit" onClick={submit} loading={save.isPending} disabled={!ready}>{t('save', lang)}</Button>
      </div>
    </Card>
  );
}

function ExpenseRow({ lang, clinicId, e, rights }: { lang: Lang; clinicId: string; e: Expense; rights: ExpenseRights }) {
  const [voiding, setVoiding] = useState(false);
  const canVoid = e.status !== 'void' && (rights.all || (!rights.read && e.status === 'pending'));
  return (
    <li>
      <span>
        <strong>{e.category_name}</strong> <Badge tone={STATUS_TONE[e.status]}>{t(`exp_${e.status}` as Key, lang)}</Badge>
        <span className="muted small"> · {e.spent_on} · <bdi>{pickName(lang, e.branch.name_ar, e.branch.name_en)}</bdi>
          {e.payment_method && <> · {t(`pm_${e.payment_method}` as Key, lang)}</>}{e.reference && <> · <bdi dir="ltr">{e.reference}</bdi></>}</span>
        {(e.description || e.supplier_name) && <span className="small block"><bdi>{[e.supplier_name, e.description].filter(Boolean).join(' — ')}</bdi></span>}
        <span className="muted small block">{t('recordedBy', lang)} <bdi>{e.created_by_name}</bdi>
          {e.approved_by_name && <> · {t(e.status === 'rejected' ? 'rejectedBy' : 'approvedBy', lang)} <bdi>{e.approved_by_name}</bdi></>}
          {e.decision_note && <> — <bdi>{e.decision_note}</bdi></>}</span>
        {e.status === 'void' && <span className="small block">{t('voidedBecause', lang)}: <bdi>{e.void_reason}</bdi>{e.voided_by_name && <> · <bdi>{e.voided_by_name}</bdi></>}</span>}
      </span>
      <span className="line-end">
        <bdi className={e.status === 'void' ? 'struck' : undefined}>{money(e.amount_minor, lang, e.currency)}</bdi>
        {canVoid && <Button variant="ghost" onClick={() => setVoiding(true)}>{t('voidExpense', lang)}</Button>}
      </span>
      {voiding && <VoidDialog lang={lang} clinicId={clinicId} e={e} onClose={() => setVoiding(false)} />}
    </li>
  );
}

function VoidDialog({ lang, clinicId, e, onClose }: { lang: Lang; clinicId: string; e: Expense; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const act = useFinanceMutation(clinicId, () => send(`/expenses/${e.id}/void`, 'POST', { reason: reason.trim() }));
  return (
    <ConfirmDialog open title={t('voidExpense', lang)} confirmLabel={t('voidExpense', lang)} danger
      onConfirm={() => { if (reason.trim().length >= 3) act.mutate(undefined, { onSuccess: onClose }); }} onCancel={onClose}>
      <p>{t('voidExpenseText', lang)}</p>
      <Field label={t('reason', lang)} hint={t('reasonHint', lang)}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(x) => setReason(x.target.value)} maxLength={500} />}</Field>
      <ErrorText error={act.error} />
    </ConfirmDialog>
  );
}

/** EXP-003: reception's cash expenses waiting for the owner. */
function PendingExpenses({ lang, clinicId }: { lang: Lang; clinicId: string }) {
  const pending = usePendingExpenses(clinicId);
  if (pending.isError) return <Card><ErrorText error={pending.error} onRetry={() => void pending.refetch()} /></Card>;
  if (!pending.data?.length) return null;
  return (
    <Card>
      <h2>{t('awaitingApproval', lang)}</h2>
      <ul className="line-list mt-sm">{pending.data.map((e) => <PendingRow key={e.id} lang={lang} clinicId={clinicId} e={e} />)}</ul>
    </Card>
  );
}

function PendingRow({ lang, clinicId, e }: { lang: Lang; clinicId: string; e: Expense }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const approve = useFinanceMutation(clinicId, () => send(`/expenses/${e.id}/approve`, 'POST', {}));
  const reject = useFinanceMutation(clinicId, () => send(`/expenses/${e.id}/reject`, 'POST', { note: note.trim() }));
  return (
    <li>
      <span>
        <strong>{e.category_name}</strong> · <bdi>{money(e.amount_minor, lang, e.currency)}</bdi>
        <span className="muted small"> · {e.spent_on} · <bdi>{pickName(lang, e.branch.name_ar, e.branch.name_en)}</bdi> · {t('recordedBy', lang)} <bdi>{e.created_by_name}</bdi></span>
        {e.description && <span className="small block"><bdi>{e.description}</bdi></span>}
        <ErrorText error={approve.error ?? reject.error} />
      </span>
      <span className="line-end">
        <Button variant="secondary" loading={approve.isPending} onClick={() => approve.mutate(undefined)}>{t('approve', lang)}</Button>
        <Button variant="ghost" onClick={() => setRejecting(true)}>{t('reject', lang)}</Button>
      </span>
      {rejecting && (
        <ConfirmDialog open title={t('reject', lang)} confirmLabel={t('reject', lang)} danger
          onConfirm={() => { if (note.trim().length >= 3) reject.mutate(undefined, { onSuccess: () => setRejecting(false) }); }} onCancel={() => setRejecting(false)}>
          <p>{t('rejectExpenseText', lang)}</p>
          <Field label={t('reason', lang)} hint={t('reasonHint', lang)}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={note} onChange={(x) => setNote(x.target.value)} maxLength={500} />}</Field>
          <ErrorText error={reject.error} />
        </ConfirmDialog>
      )}
    </li>
  );
}

/** EXP-002 and CLR-03: the owner's categories (renamed or deactivated, never deleted) and the reception limit. */
function ExpenseSettingsCard({ lang, clinicId }: { lang: Lang; clinicId: string }) {
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
      <h2>{t('expenseSettings', lang)}</h2>
      <Field label={t('receptionLimit', lang)} hint={t('receptionLimitHint', lang)}>
        {(a) => (
          <div className="row-start">
            <Input id={a.id} describedBy={a.describedBy} className="input-sm" dir="ltr" inputMode="decimal" value={limitText} onChange={(e) => setLimit(e.target.value)} invalid={limitMinor === null} />
            <Button variant="secondary" disabled={limitMinor === null || limitMinor === settings.data?.receptionLimitMinor} loading={saveLimit.isPending}
              onClick={() => saveLimit.mutate(undefined, { onSuccess: () => setLimit(null) })}>{t('save', lang)}</Button>
          </div>
        )}
      </Field>
      <ErrorText error={saveLimit.error} />
      <h3 className="mt">{t('expenseCategories', lang)}</h3>
      {categories.data && (
        <ul className="line-list mt-sm">
          {categories.data.map((c) => (
            <li key={c.id}>
              <span className={c.is_active ? undefined : 'muted'}>{c.name}{c.uses > 0 && <span className="muted small"> · {t('usedTimes', lang).replace('{n}', String(c.uses))}</span>}</span>
              <span className="line-end"><Switch checked={c.is_active} label={t('categoryActive', lang)} onChange={(v) => toggle.mutate({ id: c.id, isActive: v })} /></span>
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={toggle.error} />
      <form className="row-start mt" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) add.mutate(undefined, { onSuccess: () => setName('') }); }}>
        <Input aria-label={t('newCategory', lang)} placeholder={t('newCategory', lang)} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <Button type="submit" variant="secondary" loading={add.isPending} disabled={name.trim().length < 2}>{t('add', lang)}</Button>
      </form>
      <ErrorText error={add.error} />
    </Card>
  );
}
