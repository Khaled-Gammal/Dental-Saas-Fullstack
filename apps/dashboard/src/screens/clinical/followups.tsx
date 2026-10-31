import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { addMonths } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { followUpStatusLabel, followUpViewLabel, noFollowUpsText, recallReasonLabel } from '../../labels';
import { send, useClinicalMutation, usePatientRecalls, useRecalls } from '../../queries';
import { to } from '../../router';
import type { Recall, RecallReason } from '../../types';
import { Badge, Button, Card, ErrorText, Field, Input, LinkButton, PageHeader } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { CalendarIcon, PhoneIcon } from '../../ui/icons';
import { DataTable, type Column } from '../../ui/data-table';
import { RouteLink } from '../../ui/page';
import { clinicToday, fmtNumber, LOC } from '../../util';
import { RowMenu } from '../../ui/row-menu';

type View = 'due' | 'upcoming' | 'closed';
const VIEWS: View[] = ['due', 'upcoming', 'closed'];
const REASONS: RecallReason[] = ['checkup', 'cleaning', 'ortho_adjustment', 'post_op', 'implant_followup', 'other'];
const STATUS_TONE: Record<Recall['status'], 'neutral' | 'primary' | 'success' | 'warning'> = { pending: 'warning', contacted: 'primary', booked: 'success', done: 'neutral', dismissed: 'neutral' };
const fmtDate = (iso: string) => new Intl.DateTimeFormat(LOC, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/**
 * `#/followups`: the list reception works (SRS VISIT-005): who is due for a check-up, cleaning or review. Staff call,
 * book (the appointment is linked), or dismiss. Nothing is sent to the patient automatically.
 */
export function FollowUps({ clinicId, canWrite, canBook, query }: { clinicId: string; canWrite: boolean; canBook: boolean; query?: Record<string, string> }) {
  const view: View = VIEWS.includes(query?.view as View) ? (query!.view as View) : 'due';
  const list = useRecalls(clinicId, view);
  return (
    <>
      <PageHeader title="المتابعات" sub="مرضى حان موعد متابعتهم. التواصل يتم يدويًا من الاستقبال، ولا تُرسل رسائل تلقائية." />
      <div className="seg" role="group" aria-label="المتابعات">
        {VIEWS.map((v) => (
          <RouteLink key={v} route={{ page: 'followups', query: { view: v } }} className={`seg-btn${v === view ? ' is-on' : ''}`} aria-current={v === view ? 'page' : undefined}>{followUpViewLabel[v]}</RouteLink>
        ))}
      </div>
      {/* the view tabs ask the API; the table searches and sorts what it returned (redesign R4) */}
      <DataTable
        key={view}
        label="المتابعات"
        rows={list.data?.items}
        columns={recallColumns(list.data?.today ?? clinicToday())}
        rowKey={(r) => r.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.isError ? list.error : undefined}
        onRetry={() => void list.refetch()}
        search={{ placeholder: 'ابحث باسم المريض أو رقمه أو السبب', text: (r) => `${r.patient.full_name} ${r.patient.phone} ${recallReasonLabel[r.reason]}` }}
        defaultSort={{ id: 'due', dir: view === 'closed' ? 'desc' : 'asc' }}
        pageSize={25}
        actions={canWrite || canBook ? (r) => <RecallRowActions clinicId={clinicId} r={r} canWrite={canWrite} canBook={canBook} /> : undefined}
        empty={{ icon: <CalendarIcon size={28} />, title: 'لا توجد متابعات.', text: noFollowUpsText[view] }}
      />
    </>
  );
}

const isOpen = (r: Recall) => r.status === 'pending' || r.status === 'contacted';

/** The follow-ups table (redesign R4): who, why, when, and where the follow-up stands. */
function recallColumns(today: string): Column<Recall>[] {
  return [
    {
      id: 'patient', header: 'المريض', sortValue: (r) => r.patient.full_name,
      cell: (r) => (
        <>
          <RouteLink route={to.view('patients', r.patient.id)} className="font-semibold no-underline hover:underline"><bdi>{r.patient.full_name}</bdi></RouteLink>
          {/* on a phone the number (still a tap to call) and the due date sit under the name, their columns hidden, so the
              row fits beside its buttons. Tailwind display classes only: the unlayered .block and .link-plain would beat md:hidden */}
          <span className="mt-1 flex flex-col items-start gap-1 md:hidden">
            <a href={`tel:${r.patient.phone}`} dir="ltr" className="link-plain tabular-nums small"><PhoneIcon size={14} /> {r.patient.phone}</a>
            <RecallDue r={r} today={today} />
          </span>
        </>
      ),
    },
    { id: 'phone', header: 'رقم الموبايل', hideOnMobile: true, cell: (r) => <a href={`tel:${r.patient.phone}`} dir="ltr" className="link-plain tabular-nums"><PhoneIcon size={14} /> {r.patient.phone}</a> },
    { id: 'reason', header: 'السبب', hideOnMobile: true, sortValue: (r) => recallReasonLabel[r.reason], cell: (r) => recallReasonLabel[r.reason] },
    {
      id: 'due', header: 'موعد الاستحقاق', hideOnMobile: true, sortValue: (r) => r.due_date, cell: (r) => <RecallDue r={r} today={today} />,
    },
    {
      id: 'doctor', header: 'الطبيب', hideOnMobile: true, sortValue: (r) => (r.doctor ? arName(r.doctor.name_ar, r.doctor.name_en) : ''),
      cell: (r) => (
        <>
          {r.doctor ? <bdi>{arName(r.doctor.name_ar, r.doctor.name_en)}</bdi> : <span className="muted">—</span>}
          {r.contact_attempts > 0 && <span className="muted small block">{fmtNumber(r.contact_attempts)} محاولة اتصال</span>}
          {r.notes && <span className="small block call-log">{r.notes}</span>}
        </>
      ),
    },
  ];
}

/** The due date and where the follow-up stands («متأخرة» in red once an open one is past its date). */
function RecallDue({ r, today }: { r: Recall; today: string }) {
  const overdue = isOpen(r) && r.due_date < today;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="whitespace-nowrap">{fmtDate(r.due_date)}</span>
      <Badge tone={overdue ? 'danger' : STATUS_TONE[r.status]} dot>{overdue ? 'متأخرة' : followUpStatusLabel[r.status]}</Badge>
    </span>
  );
}

/** In the table: «حجز موعد» stays in sight, a call and dismissing are in the row's «⋯» menu (UI refinement U2). */
function RecallRowActions({ clinicId, r, canWrite, canBook }: { clinicId: string; r: Recall; canWrite: boolean; canBook: boolean }) {
  const [dialog, setDialog] = useState<'contact' | 'dismiss' | null>(null);
  const [note, setNote] = useState('');
  const act = useClinicalMutation(clinicId, (a: { op: 'contact' | 'dismiss'; text: string }) =>
    send(`/recalls/${r.id}/${a.op}`, 'POST', a.op === 'contact' ? { note: a.text } : { reason: a.text || null }));
  if (!isOpen(r)) return null;
  return (
    <div className="flex items-center justify-end gap-2">
      {canBook && (
        <RouteLink route={to.create('appointments', { patient: r.patient.id, recall: r.id, ...(r.doctor_id && { doctor: r.doctor_id }) })} className="btn btn-secondary btn-sm whitespace-nowrap">
          <CalendarIcon size={16} />حجز موعد
        </RouteLink>
      )}
      <RowMenu label={r.patient.full_name} actions={[
        { label: 'تسجيل مكالمة', icon: <PhoneIcon size={16} />, onSelect: () => { setNote(''); setDialog('contact'); }, hidden: !canWrite },
        { label: 'إلغاء المتابعة', destructive: true, onSelect: () => { setNote(''); setDialog('dismiss'); }, hidden: !canWrite },
      ]} />
      <ErrorText error={act.error} />
      <ConfirmDialog open={!!dialog} title={dialog === 'dismiss' ? 'إلغاء المتابعة' : 'تسجيل مكالمة'} confirmLabel={dialog === 'dismiss' ? 'إلغاء المتابعة' : 'حفظ'} danger={dialog === 'dismiss'}
        onConfirm={() => { if (dialog && (dialog === 'dismiss' || note.trim())) act.mutate({ op: dialog, text: note.trim() }, { onSettled: () => setDialog(null) }); }}
        onCancel={() => setDialog(null)}>
        <Field label={dialog === 'dismiss' ? 'السبب' : 'ما تم في المكالمة'} optional={dialog === 'dismiss' ? 'اختياري' : undefined}>
          {(a) => <Input id={a.id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={dialog === 'dismiss' ? 300 : 500} placeholder={dialog === 'contact' ? 'مثال: لم يرد، سيتصل غدًا' : undefined} />}
        </Field>
      </ConfirmDialog>
    </div>
  );
}

/** An open follow-up's work: book it (the appointment is linked), log a call, or dismiss it. */
function RecallActions({ clinicId, r, canWrite, canBook }: { clinicId: string; r: Recall; canWrite: boolean; canBook: boolean }) {
  const [dialog, setDialog] = useState<'contact' | 'dismiss' | null>(null);
  const [note, setNote] = useState('');
  const act = useClinicalMutation(clinicId, (a: { op: 'contact' | 'dismiss'; text: string }) =>
    send(`/recalls/${r.id}/${a.op}`, 'POST', a.op === 'contact' ? { note: a.text } : { reason: a.text || null }));
  if (!isOpen(r) || !(canWrite || canBook)) return null;
  return (
    <div className="appt-actions">
      {canBook && (
        <RouteLink route={to.create('appointments', { patient: r.patient.id, recall: r.id, ...(r.doctor_id && { doctor: r.doctor_id }) })} className="btn btn-primary">
          <CalendarIcon size={16} />حجز موعد
        </RouteLink>
      )}
      {canWrite && <Button variant="secondary" onClick={() => { setNote(''); setDialog('contact'); }}><PhoneIcon size={16} />تسجيل مكالمة</Button>}
      {canWrite && <LinkButton onClick={() => { setNote(''); setDialog('dismiss'); }}>إلغاء المتابعة</LinkButton>}
      <ErrorText error={act.error} />
      <ConfirmDialog open={!!dialog} title={dialog === 'dismiss' ? 'إلغاء المتابعة' : 'تسجيل مكالمة'} confirmLabel={dialog === 'dismiss' ? 'إلغاء المتابعة' : 'حفظ'} danger={dialog === 'dismiss'}
        onConfirm={() => { if (dialog && (dialog === 'dismiss' || note.trim())) act.mutate({ op: dialog, text: note.trim() }, { onSettled: () => setDialog(null) }); }}
        onCancel={() => setDialog(null)}>
        <Field label={dialog === 'dismiss' ? 'السبب' : 'ما تم في المكالمة'} optional={dialog === 'dismiss' ? 'اختياري' : undefined}>
          {(a) => <Input id={a.id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={dialog === 'dismiss' ? 300 : 500} placeholder={dialog === 'contact' ? 'مثال: لم يرد، سيتصل غدًا' : undefined} />}
        </Field>
      </ConfirmDialog>
    </div>
  );
}

/** One follow-up as a card: the patient's page lists theirs this way (compact: no name or phone, it is their page). */
function RecallRow({ clinicId, r, today, canWrite, canBook, compact }: { clinicId: string; r: Recall; today: string; canWrite: boolean; canBook: boolean; compact?: boolean }) {
  const overdue = isOpen(r) && r.due_date < today;
  return (
    <Card as="li" className="appt">
      <div className="appt-main">
        <div className="appt-head">
          {compact ? <strong>{recallReasonLabel[r.reason]}</strong> : <RouteLink route={to.view('patients', r.patient.id)}><strong><bdi>{r.patient.full_name}</bdi></strong></RouteLink>}
          <Badge tone={overdue ? 'warning' : STATUS_TONE[r.status]}>{overdue ? 'متأخرة' : followUpStatusLabel[r.status]}</Badge>
        </div>
        <div className="appt-meta">
          {!compact && <a href={`tel:${r.patient.phone}`} dir="ltr" className="link-plain"><PhoneIcon size={14} /> {r.patient.phone}</a>}
          {!compact && <span>{recallReasonLabel[r.reason]}</span>}
          <span>موعد الاستحقاق: {fmtDate(r.due_date)}</span>
          {r.doctor && <span><bdi>{arName(r.doctor.name_ar, r.doctor.name_en)}</bdi></span>}
          {r.contact_attempts > 0 && <span className="muted">{fmtNumber(r.contact_attempts)} محاولة اتصال</span>}
        </div>
        {r.notes && <p className="appt-notes call-log">{r.notes}</p>}
      </div>
      <RecallActions clinicId={clinicId} r={r} canWrite={canWrite} canBook={canBook} />
    </Card>
  );
}

/** The follow-ups of one patient on the profile, with a quick "add". */
export function PatientFollowUpsCard({ clinicId, patientId, canWrite, canBook }: { clinicId: string; patientId: string; canWrite: boolean; canBook: boolean }) {
  const list = usePatientRecalls(clinicId, patientId);
  const [adding, setAdding] = useState(false);
  const [reason, setReason] = useState<RecallReason>('checkup');
  const [due, setDue] = useState(addMonths(clinicToday(), 6));
  const add = useClinicalMutation(clinicId, () => send(`/patients/${patientId}/recalls`, 'POST', { reason, dueDate: due }));
  return (
    <Card>
      <div className="row-between">
        <h2>المتابعات</h2>
        {canWrite && !adding && <Button variant="secondary" onClick={() => setAdding(true)}>إضافة متابعة</Button>}
      </div>
      {adding && (
        <form className="grid-2 mt" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined, { onSuccess: () => setAdding(false) }); }}>
          <Field label="سبب المتابعة">
            {(a) => <Choice id={a.id} value={reason} onChange={(x) => setReason(x as RecallReason)} options={REASONS.map((x) => ({ value: x, label: recallReasonLabel[x] }))} />}
          </Field>
          <Field label="موعد الاستحقاق">{(a) => <DatePicker id={a.id} value={due} onChange={setDue} min={clinicToday()} />}</Field>
          <ErrorText error={add.error} />
          <div className="row-end"><Button variant="ghost" onClick={() => setAdding(false)}>إلغاء</Button><Button type="submit" loading={add.isPending}>حفظ</Button></div>
        </form>
      )}
      {list.isError ? <ErrorText error={list.error} onRetry={() => void list.refetch()} />
        : !list.data?.length ? <p className="muted small mt-sm">لا توجد متابعات.</p>
        : <ul className="stack mt">{list.data.map((r) => <RecallRow key={r.id} clinicId={clinicId} r={r} today={clinicToday()} canWrite={canWrite} canBook={canBook} compact />)}</ul>}
    </Card>
  );
}
