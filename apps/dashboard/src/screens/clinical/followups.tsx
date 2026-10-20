import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { addMonths } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { t, type Key } from '../../i18n';
import { send, useClinicalMutation, usePatientRecalls, useRecalls } from '../../queries';
import { to } from '../../router';
import type { Recall, RecallReason } from '../../types';
import { Badge, Button, Card, ErrorText, Field, Input, LinkButton, PageHeader } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { CalendarIcon, PhoneIcon } from '../../ui/icons';
import { DataTable, type Column } from '../../ui/data-table';
import { RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';

type View = 'due' | 'upcoming' | 'closed';
const VIEWS: View[] = ['due', 'upcoming', 'closed'];
const REASONS: RecallReason[] = ['checkup', 'cleaning', 'ortho_adjustment', 'post_op', 'implant_followup', 'other'];
const STATUS_TONE: Record<Recall['status'], 'neutral' | 'primary' | 'success' | 'warning'> = { pending: 'warning', contacted: 'primary', booked: 'success', done: 'neutral', dismissed: 'neutral' };
const todayIso = () => new Date().toLocaleDateString('en-CA');
const fmtDate = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/**
 * `#/followups`: the list reception works (SRS VISIT-005): who is due for a check-up, cleaning or review. Staff call,
 * book (the appointment is linked), or dismiss. Nothing is sent to the patient automatically.
 */
export function FollowUps({ clinicId, canWrite, canBook, query }: { clinicId: string; canWrite: boolean; canBook: boolean; query?: Record<string, string> }) {
  const view: View = VIEWS.includes(query?.view as View) ? (query!.view as View) : 'due';
  const list = useRecalls(clinicId, view);
  return (
    <>
      <PageHeader title={t('navFollowUps')} sub={t('followUpsSub')} />
      <div className="seg" role="group" aria-label={t('navFollowUps')}>
        {VIEWS.map((v) => (
          <RouteLink key={v} route={{ page: 'followups', query: { view: v } }} className={`seg-btn${v === view ? ' is-on' : ''}`} aria-current={v === view ? 'page' : undefined}>{t(`fu_${v}` as Key)}</RouteLink>
        ))}
      </div>
      {/* the view tabs ask the API; the table searches and sorts what it returned (redesign R4) */}
      <DataTable
        key={view}
        label={t('navFollowUps')}
        rows={list.data?.items}
        columns={recallColumns(list.data?.today ?? todayIso())}
        rowKey={(r) => r.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.isError ? list.error : undefined}
        onRetry={() => void list.refetch()}
        search={{ placeholder: t('followUpSearchHint'), text: (r) => `${r.patient.full_name} ${r.patient.phone} ${t(`recall_${r.reason}` as Key)}` }}
        defaultSort={{ id: 'due', dir: view === 'closed' ? 'desc' : 'asc' }}
        pageSize={25}
        actions={canWrite || canBook ? (r) => <RecallActions clinicId={clinicId} r={r} canWrite={canWrite} canBook={canBook} inTable /> : undefined}
        empty={{ icon: <CalendarIcon size={28} />, title: t('noFollowUps'), text: t(`noFollowUps_${view}` as Key) }}
      />
    </>
  );
}

const isOpen = (r: Recall) => r.status === 'pending' || r.status === 'contacted';

/** The follow-ups table (redesign R4): who, why, when, and where the follow-up stands. */
function recallColumns(today: string): Column<Recall>[] {
  return [
    {
      id: 'patient', header: t('patientColName'), sortValue: (r) => r.patient.full_name,
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
    { id: 'phone', header: t('phone'), hideOnMobile: true, cell: (r) => <a href={`tel:${r.patient.phone}`} dir="ltr" className="link-plain tabular-nums"><PhoneIcon size={14} /> {r.patient.phone}</a> },
    { id: 'reason', header: t('recallReason'), hideOnMobile: true, sortValue: (r) => t(`recall_${r.reason}` as Key), cell: (r) => t(`recall_${r.reason}` as Key) },
    {
      id: 'due', header: t('dueDate'), hideOnMobile: true, sortValue: (r) => r.due_date, cell: (r) => <RecallDue r={r} today={today} />,
    },
    {
      id: 'doctor', header: t('doctor'), hideOnMobile: true, sortValue: (r) => (r.doctor ? arName(r.doctor.name_ar, r.doctor.name_en) : ''),
      cell: (r) => (
        <>
          {r.doctor ? <bdi>{arName(r.doctor.name_ar, r.doctor.name_en)}</bdi> : <span className="muted">—</span>}
          {r.contact_attempts > 0 && <span className="muted small block">{fmtNumber(r.contact_attempts)} {t('callAttempts')}</span>}
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
      <Badge tone={overdue ? 'danger' : STATUS_TONE[r.status]} dot>{overdue ? t('overdue') : t(`fus_${r.status}` as Key)}</Badge>
    </span>
  );
}

/** An open follow-up's work: book it (the appointment is linked), log a call, or dismiss it. */
function RecallActions({ clinicId, r, canWrite, canBook, inTable }: { clinicId: string; r: Recall; canWrite: boolean; canBook: boolean; inTable?: boolean }) {
  const [dialog, setDialog] = useState<'contact' | 'dismiss' | null>(null);
  const [note, setNote] = useState('');
  const act = useClinicalMutation(clinicId, (a: { op: 'contact' | 'dismiss'; text: string }) =>
    send(`/recalls/${r.id}/${a.op}`, 'POST', a.op === 'contact' ? { note: a.text } : { reason: a.text || null }));
  if (!isOpen(r) || !(canWrite || canBook)) return null;
  return (
    // in the table the three stay on one line (stacked on a phone, so the table fits without scrolling sideways)
    <div className={inTable ? 'flex flex-col items-stretch gap-2 md:flex-row md:flex-nowrap md:items-center md:justify-end' : 'appt-actions'}>
      {canBook && (
        <RouteLink route={to.create('appointments', { patient: r.patient.id, recall: r.id, ...(r.doctor_id && { doctor: r.doctor_id }) })} className="btn btn-primary">
          <CalendarIcon size={16} />{t('book')}
        </RouteLink>
      )}
      {canWrite && <Button variant="secondary" onClick={() => { setNote(''); setDialog('contact'); }}><PhoneIcon size={16} />{t('logCall')}</Button>}
      {canWrite && <LinkButton onClick={() => { setNote(''); setDialog('dismiss'); }}>{t('dismiss')}</LinkButton>}
      <ErrorText error={act.error} />
      <ConfirmDialog open={!!dialog} title={t(dialog === 'dismiss' ? 'dismissFollowUp' : 'logCall')} confirmLabel={t(dialog === 'dismiss' ? 'dismiss' : 'save')} danger={dialog === 'dismiss'}
        onConfirm={() => { if (dialog && (dialog === 'dismiss' || note.trim())) act.mutate({ op: dialog, text: note.trim() }, { onSettled: () => setDialog(null) }); }}
        onCancel={() => setDialog(null)}>
        <Field label={t(dialog === 'dismiss' ? 'dismissReason' : 'callNote')} optional={dialog === 'dismiss' ? t('optional') : undefined}>
          {(a) => <Input id={a.id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={dialog === 'dismiss' ? 300 : 500} placeholder={dialog === 'contact' ? t('callNoteExample') : undefined} />}
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
          {compact ? <strong>{t(`recall_${r.reason}` as Key)}</strong> : <RouteLink route={to.view('patients', r.patient.id)}><strong><bdi>{r.patient.full_name}</bdi></strong></RouteLink>}
          <Badge tone={overdue ? 'warning' : STATUS_TONE[r.status]}>{overdue ? t('overdue') : t(`fus_${r.status}` as Key)}</Badge>
        </div>
        <div className="appt-meta">
          {!compact && <a href={`tel:${r.patient.phone}`} dir="ltr" className="link-plain"><PhoneIcon size={14} /> {r.patient.phone}</a>}
          {!compact && <span>{t(`recall_${r.reason}` as Key)}</span>}
          <span>{t('dueDate')}: {fmtDate(r.due_date)}</span>
          {r.doctor && <span><bdi>{arName(r.doctor.name_ar, r.doctor.name_en)}</bdi></span>}
          {r.contact_attempts > 0 && <span className="muted">{fmtNumber(r.contact_attempts)} {t('callAttempts')}</span>}
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
  const [due, setDue] = useState(addMonths(todayIso(), 6));
  const add = useClinicalMutation(clinicId, () => send(`/patients/${patientId}/recalls`, 'POST', { reason, dueDate: due }));
  return (
    <Card>
      <div className="row-between">
        <h2>{t('followUps')}</h2>
        {canWrite && !adding && <Button variant="secondary" onClick={() => setAdding(true)}>{t('addFollowUp')}</Button>}
      </div>
      {adding && (
        <form className="grid-2 mt" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined, { onSuccess: () => setAdding(false) }); }}>
          <Field label={t('followUpReason')}>
            {(a) => <Choice id={a.id} value={reason} onChange={(x) => setReason(x as RecallReason)} options={REASONS.map((x) => ({ value: x, label: t(`recall_${x}` as Key) }))} />}
          </Field>
          <Field label={t('dueDate')}>{(a) => <DatePicker id={a.id} value={due} onChange={setDue} min={todayIso()} />}</Field>
          <ErrorText error={add.error} />
          <div className="row-end"><Button variant="ghost" onClick={() => setAdding(false)}>{t('cancel')}</Button><Button type="submit" loading={add.isPending}>{t('save')}</Button></div>
        </form>
      )}
      {list.isError ? <ErrorText error={list.error} onRetry={() => void list.refetch()} />
        : !list.data?.length ? <p className="muted small mt-sm">{t('noFollowUps')}</p>
        : <ul className="stack mt">{list.data.map((r) => <RecallRow key={r.id} clinicId={clinicId} r={r} today={todayIso()} canWrite={canWrite} canBook={canBook} compact />)}</ul>}
    </Card>
  );
}
