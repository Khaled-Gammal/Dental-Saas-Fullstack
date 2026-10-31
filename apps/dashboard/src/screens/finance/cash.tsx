import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { toMinor, toPounds } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { difference, movementsFor, otherMethods, type FigureFilter } from '../../finance-model';
import { cashStatusLabel, paymentMethodLabel } from '../../labels';
import { money } from '../../money';
import { send, useCashBranches, useCashDay, useCashHistory, useCashMovements, useFinanceMutation } from '../../queries';
import { to } from '../../router';
import type { CashMovement, CashSession, DayTotals, PaymentMethod } from '../../types';
import { clinicTimeZone, fmtNumber, LOC } from '../../util';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, Skeleton, TextArea } from '../../ui/components';
import { DataTable, type Column } from '../../ui/data-table';
import { CashIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';

/** Redesign R8: a business day ("YYYY-MM-DD") and an instant in words, not ISO. */
const fmtDay = (iso: string) => new Intl.DateTimeFormat(LOC, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const fmtShortDay = (iso: string) => new Intl.DateTimeFormat(LOC, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const fmtAt = (iso: string) => new Intl.DateTimeFormat(LOC, { dateStyle: 'medium', timeStyle: 'short', timeZone: clinicTimeZone() }).format(new Date(iso));

/**
 * `#/cash` (SRS CASH-001…004, CLR-04): one cash session per branch per business day. Reception or the accountant
 * opens it with the counted cash, watches expected cash (computed, never typed) and closes it with the count; a
 * difference needs a note. Once closed nothing is dated into that day; only the owner reopens it, with a reason.
 */
export function CashBox({ clinicId }: { clinicId: string }) {
  const branches = useCashBranches(clinicId);
  const [picked, setPicked] = useState('');
  const list = branches.data ?? [];
  const branchId = picked || list[0]?.id || '';
  const day = useCashDay(clinicId, branchId);
  return (
    <>
      <PageHeader title="الخزنة اليومية" sub="جلسة واحدة لكل فرع في اليوم: رصيد افتتاحي، ثم النقدية المتوقعة من المسجل فعلًا، ثم العد والإقفال."
        // redesign R8: the branch is a small choice in the header, not a card of its own
        action={list.length > 1 ? (
          <div className="header-select">
            <Choice id="cash-branch" label="الفرع" value={branchId} onChange={setPicked} options={list.map((b) => ({ value: b.id, label: arName(b.name_ar, b.name_en) }))} />
          </div>
        ) : undefined} />
      {branches.isError ? <ErrorText error={branches.error} onRetry={() => void branches.refetch()} />
        : !branches.data ? <Skeleton h={120} count={2} />
        : !list.length ? <Card><EmptyState icon={<CashIcon size={28} />} title="لا فرع متاح" text="لا يوجد فرع نشط تعمل به." /></Card>
        : day.isError ? <ErrorText error={day.error} onRetry={() => void day.refetch()} />
        : !day.data ? <Skeleton h={160} count={2} />
        : (
          <>
            {day.data.earlier_open && (
              <Card>
                <Alert tone="danger">{'خزنة يوم {date} ما زالت مفتوحة. أقفلها أولًا قبل فتح خزنة اليوم.'.replace('{date}', fmtDay(day.data.earlier_open.business_date))}</Alert>
                <SessionCard clinicId={clinicId} s={day.data.earlier_open} />
              </Card>
            )}
            {day.data.session ? (
              <Card><SessionCard clinicId={clinicId} s={day.data.session} /></Card>
            ) : !day.data.earlier_open && (
              <OpenCard clinicId={clinicId} branchId={branchId} date={day.data.business_date} suggested={day.data.suggested_opening} totals={day.data.totals} />
            )}
          </>
        )}
      {branchId && <History clinicId={clinicId} branchId={branchId} />}
    </>
  );
}

/** CASH-001: the counted opening cash; the last counted closing is proposed. */
function OpenCard({ clinicId, branchId, date, suggested, totals }: { clinicId: string; branchId: string; date: string; suggested: number | null; totals?: DayTotals }) {
  const [amount, setAmount] = useState<string | null>(null);
  const text = amount ?? (suggested !== null ? toPounds(suggested) : '');
  const minor = toMinor(text);
  const open = useFinanceMutation(clinicId, () => send('/cash/sessions', 'POST', { branchId, openingMinor: minor }));
  const moved = totals && (totals.cash_in || totals.cash_refunds || totals.cash_expenses);
  return (
    <Card>
      <h2>فتح الخزنة · {fmtDay(date)}</h2>
      <p className="muted small">{suggested !== null ? 'المبلغ المقترح هو ما عُدّ عند إقفال آخر يوم. عُدّ النقدية وصحّحه إن اختلف.' : 'عُدّ النقدية الموجودة في الدرج وأدخلها.'}</p>
      {moved ? <Alert tone="info">سُجلت حركات نقدية اليوم قبل فتح الخزنة؛ ستُحسب ضمن هذا اليوم.</Alert> : null}
      <Field label="الرصيد الافتتاحي">
        {(a) => (
          <div className="row-start">
            <Input id={a.id} className="input-sm" dir="ltr" inputMode="decimal" value={text} onChange={(e) => setAmount(e.target.value)} invalid={!!text && minor === null} />
            <Button loading={open.isPending} disabled={minor === null} onClick={() => open.mutate(undefined)}>فتح الخزنة</Button>
          </div>
        )}
      </Field>
      <ErrorText error={open.error} />
    </Card>
  );
}

function SessionCard({ clinicId, s }: { clinicId: string; s: CashSession }) {
  const totals = s.totals!;
  const expected = s.expected_minor ?? 0;
  // redesign R9: each figure opens the payments, refunds or expenses it adds up, to find where a difference came from
  const [figure, setFigure] = useState<{ title: string; f: FigureFilter } | null>(null);
  const open = (title: string, f: FigureFilter, amount: number) => (amount > 0
    ? <button type="button" className="figure-link" onClick={() => setFigure({ title, f })} aria-haspopup="dialog">{title}</button>
    : <span>{title}</span>);
  return (
    <>
      <div className="row-between">
        <h2>خزنة يوم · {fmtDay(s.business_date)}</h2>
        <Badge tone={s.status === 'open' ? 'success' : 'neutral'}>{cashStatusLabel[s.status]}</Badge>
      </div>
      <p className="muted small">فتحها <bdi>{s.opened_by_name}</bdi>{s.closed_by_name && <> · أقفلها <bdi>{s.closed_by_name}</bdi></>}</p>
      <ul className="line-list mt-sm cash-figures">
        <li><span>الرصيد الافتتاحي</span><span className="line-end"><bdi>{money(s.opening_minor, s.currency)}</bdi></span></li>
        <li><span>+ {open('مدفوعات نقدية', { kind: 'payment', method: 'cash' }, totals.cash_in)}</span><span className="line-end"><bdi>{money(totals.cash_in, s.currency)}</bdi></span></li>
        <li><span>− {open('مرتجعات نقدية', { kind: 'refund', method: 'cash' }, totals.cash_refunds)}</span><span className="line-end"><bdi>{money(totals.cash_refunds, s.currency)}</bdi></span></li>
        <li><span>− {open('مصروفات نقدية', { kind: 'expense', method: 'cash' }, totals.cash_expenses)}</span><span className="line-end"><bdi>{money(totals.cash_expenses, s.currency)}</bdi></span></li>
        <li className="line-total"><strong>= النقدية المتوقعة</strong><span className="line-end"><strong><bdi>{money(expected, s.currency)}</bdi></strong></span></li>
        {s.status === 'closed' && s.counted_minor !== null && (
          <>
            <li><span>النقدية الفعلية</span><span className="line-end"><bdi>{money(s.counted_minor, s.currency)}</bdi></span></li>
            <li><span>الفرق</span><span className="line-end"><DiffBadge diff={s.difference_minor ?? 0} currency={s.currency} /></span></li>
          </>
        )}
      </ul>
      {s.note && <p className="small mt-sm">ملاحظة الإقفال: <bdi>{s.note}</bdi></p>}
      <OtherMethods totals={totals} currency={s.currency} onOpen={(method) => setFigure({ title: paymentMethodLabel[method], f: { method } })} />
      {figure && <MovementsDialog clinicId={clinicId} s={s} title={figure.title} f={figure.f} onClose={() => setFigure(null)} />}
      {s.can?.close && <CloseForm clinicId={clinicId} s={s} />}
      {s.can?.reopen && <ReopenForm clinicId={clinicId} s={s} />}
      {!!s.reopenings?.length && (
        <>
          <h3 className="mt">سجل إعادة الفتح</h3>
          <ul className="line-list mt-sm">
            {s.reopenings.map((r) => (
              <li key={r.id}>
                <span><bdi>{r.reason}</bdi><span className="muted small block">أعاد فتحها <bdi>{r.reopened_by_name}</bdi> · {fmtAt(r.reopened_at)}</span></span>
                <span className="line-end small">الإقفال السابق (فعلي / متوقع): <bdi>{money(r.previous_counted, s.currency)}</bdi> / <bdi>{money(r.previous_expected, s.currency)}</bdi></span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function DiffBadge({ diff, currency }: { diff: number; currency: string }) {
  if (diff === 0) return <Badge tone="success">مطابق</Badge>;
  return <Badge tone="warning">{diff > 0 ? 'زيادة' : 'عجز'} <bdi>{money(Math.abs(diff), currency)}</bdi></Badge>;
}

/** CASH-002: card, transfers, wallets and InstaPay are listed beside expected cash, never inside it. */
function OtherMethods({ totals, currency, onOpen }: { totals: DayTotals; currency: string; onOpen: (method: PaymentMethod) => void }) {
  const rows = otherMethods(totals);
  if (!rows.length) return null;
  return (
    <>
      <h3 className="mt">طرق الدفع الأخرى</h3>
      <p className="muted small">لا تدخل في النقدية المتوقعة؛ تُطابق مع البنك أو جهاز البطاقات.</p>
      <ul className="line-list mt-sm">
        {rows.map((r) => (
          <li key={r.method}>
            <span><button type="button" className="figure-link" onClick={() => onOpen(r.method)} aria-haspopup="dialog">{paymentMethodLabel[r.method]}</button></span>
            <span className="line-end small">وارد <bdi>{money(r.inMinor, currency)}</bdi>{r.outMinor > 0 && <> · صادر <bdi>{money(r.outMinor, currency)}</bdi></>}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

const KIND_LABEL: Record<CashMovement['kind'], string> = { payment: 'دفعة', refund: 'مرتجع', expense: 'مصروف' };
const timeOf = (iso: string) => new Intl.DateTimeFormat(LOC, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: clinicTimeZone() }).format(new Date(iso));

/** Redesign R9: the movements behind one figure of the day, with their total (the same as the figure), each opening its source. */
function MovementsDialog({ clinicId, s, title, f, onClose }: { clinicId: string; s: CashSession; title: string; f: FigureFilter; onClose: () => void }) {
  const m = useCashMovements(clinicId, s.id, true);
  const { rows, inMinor, outMinor } = movementsFor(m.data?.items ?? [], f);
  const cur = s.currency;
  const source = (x: CashMovement) => {
    if (x.kind === 'expense') return <RouteLink route={{ page: 'expenses', query: { from: s.business_date, to: s.business_date } }}><bdi>{x.category}</bdi></RouteLink>;
    const who = <bdi>{x.patient_name}</bdi>;
    return x.invoice_id ? <RouteLink route={to.invoice(x.invoice_id)}>{who}{x.invoice_number && <span className="muted small"> · <bdi dir="ltr">{x.invoice_number}</bdi></span>}</RouteLink> : who;
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-start">{title}</DialogTitle>
          <DialogDescription className="text-start">{fmtDay(s.business_date)}</DialogDescription>
        </DialogHeader>
        {m.isError ? <ErrorText error={m.error} onRetry={() => void m.refetch()} />
          : !m.data ? <Skeleton h={120} count={1} />
          : rows.length === 0 ? <p className="muted small">لا توجد حركات.</p>
          : (
            <ul className="line-list movements">
              {rows.map((x) => (
                <li key={`${x.kind}-${x.id}`}>
                  <span>
                    <Badge tone={x.kind === 'payment' ? 'success' : 'neutral'}>{KIND_LABEL[x.kind]}</Badge>{' '}
                    {source(x)}
                    <span className="muted small block">
                      {x.kind !== 'expense' && <>{timeOf(x.at)} · </>}
                      {x.by_name && <bdi>{x.by_name}</bdi>}
                      {x.reference && <> · المرجع <bdi dir="ltr">{x.reference}</bdi></>}
                      {x.note && <> · <bdi>{x.note}</bdi></>}
                    </span>
                  </span>
                  <span className="line-end">
                    <bdi className={x.kind === 'payment' ? undefined : 'text-owed'}>{x.kind === 'payment' ? '+' : '−'} {money(x.amount_minor, cur)}</bdi>
                    {x.kind === 'payment' && x.payment_id && <RouteLink route={to.printReceipt(x.payment_id)} className="link-btn small">الإيصال</RouteLink>}
                  </span>
                </li>
              ))}
              <li className="line-total">
                <strong>الإجمالي · {fmtNumber(rows.length)} حركة</strong>
                <span className="line-end"><strong>
                  {inMinor > 0 && <bdi>+ {money(inMinor, cur)}</bdi>}{inMinor > 0 && outMinor > 0 && ' · '}{outMinor > 0 && <bdi className="text-owed">− {money(outMinor, cur)}</bdi>}
                </strong></span>
              </li>
            </ul>
          )}
      </DialogContent>
    </Dialog>
  );
}

/** CASH-003: count, compare, explain any difference, close. */
function CloseForm({ clinicId, s }: { clinicId: string; s: CashSession }) {
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const minor = toMinor(counted);
  const diff = difference(minor, s.expected_minor ?? 0);
  const close = useFinanceMutation(clinicId, () => send(`/cash/sessions/${s.id}/close`, 'POST', { countedMinor: minor, note: note.trim() }));
  const ready = minor !== null && (diff === 0 || note.trim().length >= 3);
  return (
    <div className="stack mt tooth-panel">
      <h3>إقفال الخزنة</h3>
      <Field label="النقدية الفعلية" hint="عُدّ النقدية في الدرج وأدخل المبلغ.">
        {(a) => <Input id={a.id} describedBy={a.describedBy} className="input-sm" dir="ltr" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} invalid={!!counted && minor === null} />}
      </Field>
      {diff !== null && <p className="small">الفرق: <DiffBadge diff={diff} currency={s.currency} /></p>}
      {diff !== null && diff !== 0 && (
        <Field label="ملاحظة الإقفال" hint="اشرح سبب الفرق (3 أحرف على الأقل).">
          {(a) => <TextArea id={a.id} describedBy={a.describedBy} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
        </Field>
      )}
      <ErrorText error={close.error} />
      <div className="row-end"><Button loading={close.isPending} disabled={!ready} onClick={() => close.mutate(undefined)}>إقفال الخزنة</Button></div>
    </div>
  );
}

/** CASH-004 (owner): the earlier closing figures stay in the history. */
function ReopenForm({ clinicId, s }: { clinicId: string; s: CashSession }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const reopen = useFinanceMutation(clinicId, () => send(`/cash/sessions/${s.id}/reopen`, 'POST', { reason: reason.trim() }));
  if (!open) return <div className="row-end mt"><Button variant="secondary" onClick={() => setOpen(true)}>إعادة فتح الخزنة</Button></div>;
  return (
    <div className="stack mt tooth-panel">
      <h3>إعادة فتح الخزنة</h3>
      <p className="muted small">تُحفظ أرقام الإقفال السابقة في السجل مع السبب.</p>
      <Field label="السبب" hint="3 أحرف على الأقل">
        {(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
      </Field>
      <ErrorText error={reopen.error} />
      <div className="row-end">
        <Button variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
        <Button loading={reopen.isPending} disabled={reason.trim().length < 3} onClick={() => reopen.mutate(undefined, { onSuccess: () => setOpen(false) })}>إعادة فتح الخزنة</Button>
      </div>
    </div>
  );
}

/** The closed days (redesign R4: a table). Every figure is the one the API stored when the day was closed. */
const HISTORY_COLUMNS: Column<CashSession>[] = [
  {
    id: 'date', header: 'اليوم', sortValue: (s) => s.business_date,
    cell: (s) => (
      <>
        <strong className="whitespace-nowrap">{fmtShortDay(s.business_date)}</strong>
        {s.reopen_count > 0 && <span className="muted small block">{'أُعيد فتحها {n} مرة'.replace('{n}', String(s.reopen_count))}</span>}
      </>
    ),
  },
  { id: 'closedBy', header: 'أقفلها', hideOnMobile: true, cell: (s) => <><bdi>{s.closed_by_name}</bdi>{s.note && <span className="muted small block"><bdi>{s.note}</bdi></span>}</> },
  { id: 'expected', header: 'النقدية المتوقعة', numeric: true, hideOnMobile: true, cell: (s) => <bdi>{money(s.expected_minor ?? 0, s.currency)}</bdi> },
  { id: 'counted', header: 'النقدية الفعلية', numeric: true, cell: (s) => <bdi className="font-semibold">{money(s.counted_minor ?? 0, s.currency)}</bdi> },
  { id: 'difference', header: 'الفرق', sortValue: (s) => s.difference_minor ?? 0, cell: (s) => <DiffBadge diff={s.difference_minor ?? 0} currency={s.currency} /> },
];

function History({ clinicId, branchId }: { clinicId: string; branchId: string }) {
  const history = useCashHistory(clinicId, branchId);
  const past = (history.data ?? []).filter((s) => s.status === 'closed');
  if (history.isError) return <Card><ErrorText error={history.error} onRetry={() => void history.refetch()} /></Card>;
  if (!past.length) return null;
  return (
    <section>
      <h2 className="section-title">الأيام السابقة</h2>
      <DataTable
        key={branchId}
        label="الأيام السابقة"
        rows={past}
        columns={HISTORY_COLUMNS}
        rowKey={(s) => s.id}
        isFetching={history.isFetching}
        defaultSort={{ id: 'date', dir: 'desc' }}
        pageSize={15}
        empty={{ icon: <CashIcon size={28} />, title: 'الأيام السابقة', text: '' }}
      />
    </section>
  );
}
