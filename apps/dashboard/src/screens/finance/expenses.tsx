import { useRef, useState, type FormEvent } from 'react';
import { arName } from '@dental/ui/text';
import { uploadFile } from '../../api';
import { navigate, useFlash, useLeave, useUnsavedChanges } from '../../hooks';
import { to } from '../../router';
import { FormPage } from '../../ui/page';
import { toMinor } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { FilePicker } from '../../components/file-picker';
import { DatePicker } from '../../components/date-picker';
import { EXPENSE_METHODS, localToday, monthOf, needsReference } from '../../finance-model';
import { expenseStatusLabel, paymentMethodLabel, referenceHintLabel } from '../../labels';
import { money } from '../../money';
import { send, useBranches, useExpenseCategories, useExpenses, useFinanceMutation, usePendingExpenses } from '../../queries';
import type { Expense, ExpenseStatus, PaymentMethod } from '../../types';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, LinkButton, PageHeader, Switch } from '../../ui/components';
import { DataTable, type Column } from '../../ui/data-table';
import { PlusIcon, WalletIcon } from '../../ui/icons';
import { RowMenu } from '../../ui/row-menu';

const STATUS_TONE: Record<ExpenseStatus, 'neutral' | 'primary' | 'success' | 'warning'> = { pending: 'warning', approved: 'success', rejected: 'neutral', void: 'neutral' };
const FILTERS = ['all', 'pending', 'approved', 'rejected', 'void'] as const;
const DOC_MAX_BYTES = 20 * 1024 * 1024; // same cap as the API (EXPENSE_FILE_POLICY)
const DOC_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

export interface ExpenseRights { all: boolean; read: boolean; approve: boolean }

/**
 * `#/expenses` (SRS EXP-001…004, CLR-03): the owner's and the accountant's (reception has no access, owner
 * 2026-10-20). They record any expense, approved on entry; wrong ones are voided with a reason and stay listed.
 * Expenses reception recorded before still wait for the owner here. The owner also keeps the categories.
 */
export function Expenses({ clinicId, rights }: { clinicId: string; rights: ExpenseRights }) {
  const [period, setPeriod] = useState(() => monthOf(localToday()));
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('all');
  const flash = useFlash(); // "saved", or "saved without its document" when the upload failed
  const list = useExpenses(clinicId, { ...period, status: status === 'all' ? undefined : status });
  const rows = list.data?.pages.flatMap((p) => p.items);
  const byCategory = list.data?.pages[0]?.byCategory; // the whole period's totals, the same on every page
  return (
    <>
      <PageHeader title="المصروفات" sub="مصروفات العيادة بفروعها، منفصلة عن فواتير المرضى."
        action={rights.all && <Button onClick={() => navigate(to.create('expenses'))}><PlusIcon size={18} />تسجيل مصروف</Button>} />
      {flash && <Alert tone={flash === 'سُجّل المصروف لكن لم يُرفع المستند. يمكنك إرفاقه من القائمة.' ? 'info' : 'success'}>{flash}</Alert>}
      {rights.approve && <PendingExpenses clinicId={clinicId} />}
      <div className="row-between">
        <div className="seg" role="group" aria-label="المصروفات">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={`seg-btn${f === status ? ' is-on' : ''}`} aria-pressed={f === status} onClick={() => setStatus(f)}>
              {f === 'all' ? 'الكل' : (expenseStatusLabel[f])}
            </button>
          ))}
        </div>
        <div className="period">
          <DatePicker label="من" value={period.from} onChange={(from) => setPeriod((p) => ({ ...p, from }))} max={period.to} />
          <DatePicker label="إلى" value={period.to} onChange={(to) => setPeriod((p) => ({ ...p, to }))} min={period.from} />
        </div>
      </div>
      {/* the tabs and the period ask the API; the table searches, sorts and pages what it returned (redesign R4) */}
      <DataTable
        key={`${status}:${period.from}:${period.to}`}
        label="المصروفات"
        rows={rows}
        columns={expenseColumns(clinicId, rights)}
        rowKey={(e) => e.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.isError ? list.error : undefined}
        onRetry={() => void list.refetch()}
        search={{ placeholder: 'ابحث بالبند أو المورد أو الوصف أو المرجع', text: (e) => [e.category_name, e.supplier_name, e.description, e.reference, e.created_by_name, arName(e.branch.name_ar, e.branch.name_en)].filter(Boolean).join(' ') }}
        defaultSort={{ id: 'date', dir: 'desc' }}
        pageSize={25}
        actions={rights.all ? (e) => <ExpenseActions clinicId={clinicId} e={e} /> : undefined}
        empty={{ icon: <WalletIcon size={28} />, title: 'لا مصروفات في هذه الفترة', text: 'سجّل المصروف بمجرد دفعه ليظهر في الخزنة والتقارير.' }}
        // the table searches and sorts what is loaded; older expenses in the period come in 200 at a time
        footer={list.hasNextPage && (
          <div className="row-center"><Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>عرض المزيد</Button></div>
        )}
      />
      {byCategory && byCategory.length > 0 && (
        <Card>
          <h2>حسب البند</h2>
          <p className="muted small">المعتمد والمنتظر للموافقة في الفترة المختارة.</p>
          <ul className="line-list mt-sm">
            {byCategory.map((c) => <li key={c.id}><span>{c.name}</span><span className="line-end"><bdi>{money(c.amount)}</bdi></span></li>)}
            <li className="line-total"><strong>الإجمالي</strong><span className="line-end"><strong><bdi>{money(byCategory.reduce((s, c) => s + c.amount, 0))}</bdi></strong></span></li>
          </ul>
        </Card>
      )}
      {rights.approve && <ExpenseSettingsCard clinicId={clinicId} />}
    </>
  );
}

/** `onDone(true)`: the expense was saved but its document did not upload (it can be attached from the list). */
/**
 * `#/expenses/new` (UI refinement U3): recording an expense on its own page, in two sections, with the form page's
 * Save and Cancel (it used to open inside the list). The expense is saved first, then its document.
 */
export function NewExpense({ clinicId }: { clinicId: string }) {
  const branches = useBranches(clinicId); // every member reads branches; the API checks the member may use the one chosen
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
  const [file, setFile] = useState<File | null>(null);
  const list = (branches.data ?? []).filter((b) => b.is_active);
  const branch = branchId || (list.length === 1 ? list[0].id : '');
  const minor = toMinor(amount);
  const tooBig = !!file && file.size > DOC_MAX_BYTES;
  // the expense first, then its document: a failed upload never loses the expense (and never records it twice)
  const save = useFinanceMutation(clinicId, async () => {
    const e = await send<Expense>('/expenses', 'POST', {
      branchId: branch, categoryId, amountMinor: minor, method, spentOn, reference: reference.trim(), supplierName: supplier.trim(), description: description.trim(),
    });
    if (!file) return false;
    return uploadFile<Expense>(`/expenses/${e.id}/document`, file, () => undefined).then(() => false, () => true);
  });
  const ready = !!branch && !!categoryId && !!minor && minor > 0 && (!needsReference(method) || reference.trim().length > 0) && !tooBig;
  const leave = useLeave(to.list('expenses'));
  const dirty = !!(branchId || categoryId || amount || reference || supplier || description || file);
  useUnsavedChanges(dirty && !save.isPending && !save.isSuccess, 'لديك تغييرات غير محفوظة. هل تريد المغادرة بدون حفظ؟');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) save.mutate(undefined, { onSuccess: (documentFailed) => leave(documentFailed ? 'سُجّل المصروف لكن لم يُرفع المستند. يمكنك إرفاقه من القائمة.' : 'سُجّل المصروف.') });
  };
  return (
    <FormPage title="تسجيل مصروف" sub="مصروفات العيادة بفروعها، منفصلة عن فواتير المرضى." crumbs={[{ label: 'المصروفات', route: to.list('expenses') }, { label: 'تسجيل مصروف' }]}
      back={to.list('expenses')} onSubmit={submit} saving={save.isPending} canSave={ready} error={save.error}>
      <Card>
      <h2>المصروف</h2>
      <div className="grid-2 mt-sm">
        <Field label="الفرع">
          {(a) => <Choice id={a.id} value={branch} onChange={setBranchId} placeholder="اختر الفرع"
            options={list.map((b) => ({ value: b.id, label: arName(b.name_ar, b.name_en) }))} />}
        </Field>
        <Field label="البند">
          {(a) => <Choice id={a.id} value={categoryId} onChange={setCategoryId} placeholder="اختر البند"
            options={(categories.data ?? []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name }))} />}
        </Field>
        <Field label="المبلغ">{(a) => <Input id={a.id} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!amount && minor === null} />}</Field>
        <Field label="طريقة الدفع">
          {(a) => <Choice id={a.id} value={method} onChange={(x) => setMethod(x as PaymentMethod)}
            options={EXPENSE_METHODS.map((x) => ({ value: x, label: paymentMethodLabel[x] }))} />}
        </Field>
        {method !== 'cash' && (
          <Field label="المرجع" optional={needsReference(method) ? undefined : 'اختياري'} hint={referenceHintLabel[method]}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />}
          </Field>
        )}
        <Field label="تاريخ المصروف">{(a) => <DatePicker id={a.id} value={spentOn} onChange={setSpentOn} max={today} />}</Field>
      </div>
      </Card>
      <Card>
      <h2>المورد والمستند</h2>
      <div className="grid-2 mt-sm">
        <Field label="المورد" optional="اختياري">{(a) => <Input id={a.id} value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={120} />}</Field>
        <Field label="البيان" optional="اختياري">{(a) => <Input id={a.id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />}</Field>
        <Field label="المستند" optional="اختياري" hint="إيصال أو فاتورة المورد: PDF أو صورة، حتى 20 ميجابايت. يمكن إرفاقه لاحقًا مرة واحدة." error={tooBig ? 'الملف أكبر من 20 ميجابايت.' : undefined}>
          {(a) => <FilePicker id={a.id} describedBy={a.describedBy} accept={DOC_ACCEPT} file={file} onChange={setFile} disabled={save.isPending} />}
        </Field>
      </div>
      </Card>
    </FormPage>
  );
}

/** The expenses table's columns; who recorded, approved or voided it and its document stay with the category. */
function expenseColumns(clinicId: string, rights: ExpenseRights): Column<Expense>[] {
  return [
    { id: 'date', header: 'تاريخ المصروف', sortValue: (e) => e.spent_on, cell: (e) => <span className="whitespace-nowrap tabular-nums">{e.spent_on}</span> },
    { id: 'category', header: 'البند', sortValue: (e) => e.category_name, cell: (e) => <ExpenseDetails clinicId={clinicId} e={e} rights={rights} /> },
    { id: 'branch', header: 'الفرع', hideOnMobile: true, sortValue: (e) => arName(e.branch.name_ar, e.branch.name_en), cell: (e) => <bdi className="muted">{arName(e.branch.name_ar, e.branch.name_en)}</bdi> },
    {
      id: 'method', header: 'طريقة الدفع', hideOnMobile: true,
      cell: (e) => (e.payment_method ? <>{paymentMethodLabel[e.payment_method]}{e.reference && <span className="muted small block"><bdi dir="ltr">{e.reference}</bdi></span>}</> : <span className="muted">—</span>),
    },
    {
      id: 'amount', header: 'المبلغ', numeric: true, sortValue: (e) => e.amount_minor,
      cell: (e) => <bdi className={e.status === 'void' ? 'struck' : 'font-semibold'}>{money(e.amount_minor, e.currency)}</bdi>,
    },
  ];
}

function ExpenseDetails({ clinicId, e, rights }: { clinicId: string; e: Expense; rights: ExpenseRights }) {
  // as the API: expenses:write attaches the document once; nothing on a void expense
  const canAttach = rights.all && !e.document && e.status !== 'void';
  return (
    <>
      <span className="flex flex-wrap items-center gap-2"><strong>{e.category_name}</strong> <Badge tone={STATUS_TONE[e.status]} dot>{expenseStatusLabel[e.status]}</Badge></span>
      {(e.description || e.supplier_name) && <span className="small block"><bdi>{[e.supplier_name, e.description].filter(Boolean).join(' — ')}</bdi></span>}
      <span className="muted small block">سجّله <bdi>{e.created_by_name}</bdi>
        {e.approved_by_name && <> · {e.status === 'rejected' ? 'رفضه' : 'وافق'} <bdi>{e.approved_by_name}</bdi></>}
        {e.decision_note && <> — <bdi>{e.decision_note}</bdi></>}</span>
      {e.status === 'void' && <span className="small block">أُلغيت بسبب: <bdi>{e.void_reason}</bdi>{e.voided_by_name && <> · <bdi>{e.voided_by_name}</bdi></>}</span>}
      {e.document ? <DocumentLink doc={e.document} /> : canAttach && <AttachDocument clinicId={clinicId} expenseId={e.id} />}
    </>
  );
}

/** expenses:write voids an expense (with a reason); a void one has nothing left to do. */
function ExpenseActions({ clinicId, e }: { clinicId: string; e: Expense }) {
  const [voiding, setVoiding] = useState(false);
  if (e.status === 'void') return null;
  return (
    <>
      <RowMenu label={e.category_name} actions={[{ label: 'إلغاء المصروف', destructive: true, onSelect: () => setVoiding(true) }]} />
      {voiding && <VoidDialog clinicId={clinicId} e={e} onClose={() => setVoiding(false)} />}
    </>
  );
}

/** EXP-001: opens the private document in a new tab (a 5-minute link for this member; the list refreshes it). */
function DocumentLink({ doc }: { doc: NonNullable<Expense['document']> }) {
  return (
    <a className="small block" href={doc.url} target="_blank" rel="noopener noreferrer">
      عرض المستند ({doc.mime_type === 'application/pdf' ? 'PDF' : 'صورة'})
    </a>
  );
}

/** EXP-001: the receipt that arrives after the expense was recorded; attached once, never replaced. */
function AttachDocument({ clinicId, expenseId }: { clinicId: string; expenseId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [tooBig, setTooBig] = useState(false);
  const upload = useFinanceMutation(clinicId, (f: File) => uploadFile<Expense>(`/expenses/${expenseId}/document`, f, () => undefined));
  const pick = (f: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!f) return;
    setTooBig(f.size > DOC_MAX_BYTES);
    if (f.size <= DOC_MAX_BYTES) upload.mutate(f);
  };
  return (
    <span className="small block">
      <input ref={input} type="file" accept={DOC_ACCEPT} hidden onChange={(x) => pick(x.target.files?.[0])} />
      <LinkButton disabled={upload.isPending} onClick={() => input.current?.click()}>{upload.isPending ? 'جارٍ رفع المستند…' : 'إرفاق مستند'}</LinkButton>
      {tooBig && <span className="text-owed"> الملف أكبر من 20 ميجابايت.</span>}
      <ErrorText error={upload.error} />
    </span>
  );
}

function VoidDialog({ clinicId, e, onClose }: { clinicId: string; e: Expense; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const act = useFinanceMutation(clinicId, () => send(`/expenses/${e.id}/void`, 'POST', { reason: reason.trim() }));
  return (
    <ConfirmDialog open title="إلغاء المصروف" confirmLabel="إلغاء المصروف" danger
      onConfirm={() => { if (reason.trim().length >= 3) act.mutate(undefined, { onSuccess: onClose }); }} onCancel={onClose}>
      <p>يُلغى المصروف المسجل خطأً ويبقى ظاهرًا مع السبب. سجّل الصحيح من جديد إن لزم.</p>
      <Field label="السبب" hint="3 أحرف على الأقل">{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(x) => setReason(x.target.value)} maxLength={500} />}</Field>
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
      <h2>بانتظار الموافقة</h2>
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
        <span className="muted small"> · {e.spent_on} · <bdi>{arName(e.branch.name_ar, e.branch.name_en)}</bdi> · سجّله <bdi>{e.created_by_name}</bdi></span>
        {e.description && <span className="small block"><bdi>{e.description}</bdi></span>}
        {e.document && <DocumentLink doc={e.document} />}
        <ErrorText error={approve.error ?? reject.error} />
      </span>
      <span className="line-end">
        <Button variant="secondary" loading={approve.isPending} onClick={() => approve.mutate(undefined)}>موافقة</Button>
        <Button variant="ghost" onClick={() => setRejecting(true)}>رفض</Button>
      </span>
      {rejecting && (
        <ConfirmDialog open title="رفض" confirmLabel="رفض" danger
          onConfirm={() => { if (note.trim().length >= 3) reject.mutate(undefined, { onSuccess: () => setRejecting(false) }); }} onCancel={() => setRejecting(false)}>
          <p>يبقى المصروف مسجلًا كمرفوض، ويظل محسوبًا في خزنة يومه لأن النقدية خرجت بالفعل.</p>
          <Field label="السبب" hint="3 أحرف على الأقل">{(a) => <Input id={a.id} describedBy={a.describedBy} value={note} onChange={(x) => setNote(x.target.value)} maxLength={500} />}</Field>
          <ErrorText error={reject.error} />
        </ConfirmDialog>
      )}
    </li>
  );
}

/** EXP-002: the owner's categories (renamed or deactivated, never deleted). */
function ExpenseSettingsCard({ clinicId }: { clinicId: string }) {
  const categories = useExpenseCategories(clinicId);
  const [name, setName] = useState('');
  const add = useFinanceMutation(clinicId, () => send('/expenses/categories', 'POST', { name: name.trim() }));
  const toggle = useFinanceMutation(clinicId, (v: { id: string; isActive: boolean }) => send(`/expenses/categories/${v.id}`, 'PATCH', { isActive: v.isActive }));
  return (
    <Card>
      <h2>بنود المصروفات</h2>
      {categories.data && (
        <ul className="line-list mt-sm">
          {categories.data.map((c) => (
            <li key={c.id}>
              <span className={c.is_active ? undefined : 'muted'}>{c.name}{c.uses > 0 && <span className="muted small"> · {'{n} مصروف'.replace('{n}', String(c.uses))}</span>}</span>
              <span className="line-end"><Switch checked={c.is_active} label="مستخدم" onChange={(v) => toggle.mutate({ id: c.id, isActive: v })} /></span>
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={toggle.error} />
      <form className="row-start mt" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) add.mutate(undefined, { onSuccess: () => setName('') }); }}>
        <Input aria-label="بند جديد" placeholder="بند جديد" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <Button type="submit" variant="secondary" loading={add.isPending} disabled={name.trim().length < 2}>إضافة</Button>
      </form>
      <ErrorText error={add.error} />
    </Card>
  );
}
