import { useState } from 'react';
import { pickName } from '@dental/ui/text';
import { addMonths } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { t, type Key, type Lang } from '../../i18n';
import { send, useClinicalMutation, usePatientRecalls, useRecalls } from '../../queries';
import { to } from '../../router';
import type { Recall, RecallReason } from '../../types';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, LinkButton, PageHeader, Skeleton } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { CalendarIcon, PhoneIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';

type View = 'due' | 'upcoming' | 'closed';
const VIEWS: View[] = ['due', 'upcoming', 'closed'];
const REASONS: RecallReason[] = ['checkup', 'cleaning', 'ortho_adjustment', 'post_op', 'implant_followup', 'other'];
const STATUS_TONE: Record<Recall['status'], 'neutral' | 'primary' | 'success' | 'warning'> = { pending: 'warning', contacted: 'primary', booked: 'success', done: 'neutral', dismissed: 'neutral' };
const todayIso = () => new Date().toLocaleDateString('en-CA');
const fmtDate = (iso: string, lang: Lang) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/**
 * `#/followups`: the list reception works (SRS VISIT-005): who is due for a check-up, cleaning or review. Staff call,
 * book (the appointment is linked), or dismiss. Nothing is sent to the patient automatically.
 */
export function FollowUps({ lang, clinicId, canWrite, canBook, query }: { lang: Lang; clinicId: string; canWrite: boolean; canBook: boolean; query?: Record<string, string> }) {
  const view: View = VIEWS.includes(query?.view as View) ? (query!.view as View) : 'due';
  const list = useRecalls(clinicId, view);
  return (
    <>
      <PageHeader title={t('navFollowUps', lang)} sub={t('followUpsSub', lang)} />
      <div className="seg" role="tablist" aria-label={t('navFollowUps', lang)}>
        {VIEWS.map((v) => (
          <RouteLink key={v} route={{ page: 'followups', query: { view: v } }} className={`seg-btn${v === view ? ' is-on' : ''}`} role="tab" aria-selected={v === view}>{t(`fu_${v}` as Key, lang)}</RouteLink>
        ))}
      </div>
      {list.isError ? <ErrorText error={list.error} onRetry={() => void list.refetch()} />
        : list.isLoading ? <Skeleton h={72} count={3} />
        : !list.data?.items.length ? <Card><EmptyState icon={<CalendarIcon size={28} />} title={t('noFollowUps', lang)} text={t(`noFollowUps_${view}` as Key, lang)} /></Card>
        : (
          <ul className="appts">
            {list.data.items.map((r) => <RecallRow key={r.id} lang={lang} clinicId={clinicId} r={r} today={list.data.today} canWrite={canWrite} canBook={canBook} />)}
          </ul>
        )}
    </>
  );
}

function RecallRow({ lang, clinicId, r, today, canWrite, canBook, compact }: { lang: Lang; clinicId: string; r: Recall; today: string; canWrite: boolean; canBook: boolean; compact?: boolean }) {
  const [dialog, setDialog] = useState<'contact' | 'dismiss' | null>(null);
  const [note, setNote] = useState('');
  const act = useClinicalMutation(clinicId, (a: { op: 'contact' | 'dismiss'; text: string }) =>
    send(`/recalls/${r.id}/${a.op}`, 'POST', a.op === 'contact' ? { note: a.text } : { reason: a.text || null }));
  const open = r.status === 'pending' || r.status === 'contacted';
  const overdue = open && r.due_date < today;
  return (
    <Card as="li" className="appt">
      <div className="appt-main">
        <div className="appt-head">
          {compact ? <strong>{t(`recall_${r.reason}` as Key, lang)}</strong> : <RouteLink route={to.view('patients', r.patient.id)}><strong><bdi>{r.patient.full_name}</bdi></strong></RouteLink>}
          <Badge tone={overdue ? 'warning' : STATUS_TONE[r.status]}>{overdue ? t('overdue', lang) : t(`fus_${r.status}` as Key, lang)}</Badge>
        </div>
        <div className="appt-meta">
          {!compact && <a href={`tel:${r.patient.phone}`} dir="ltr" className="link-plain"><PhoneIcon size={14} /> {r.patient.phone}</a>}
          {!compact && <span>{t(`recall_${r.reason}` as Key, lang)}</span>}
          <span>{t('dueDate', lang)}: {fmtDate(r.due_date, lang)}</span>
          {r.doctor && <span><bdi>{pickName(lang, r.doctor.name_ar, r.doctor.name_en)}</bdi></span>}
          {r.contact_attempts > 0 && <span className="muted">{fmtNumber(r.contact_attempts, lang)} {t('callAttempts', lang)}</span>}
        </div>
        {r.notes && <p className="appt-notes call-log">{r.notes}</p>}
      </div>
      {open && (canWrite || canBook) && (
        <div className="appt-actions">
          {canBook && (
            <RouteLink route={to.create('appointments', { patient: r.patient.id, recall: r.id, ...(r.doctor_id && { doctor: r.doctor_id }) })} className="btn btn-primary">
              <CalendarIcon size={16} />{t('book', lang)}
            </RouteLink>
          )}
          {canWrite && <Button variant="secondary" onClick={() => { setNote(''); setDialog('contact'); }}><PhoneIcon size={16} />{t('logCall', lang)}</Button>}
          {canWrite && <LinkButton onClick={() => { setNote(''); setDialog('dismiss'); }}>{t('dismiss', lang)}</LinkButton>}
        </div>
      )}
      <ErrorText error={act.error} />
      <ConfirmDialog open={!!dialog} title={t(dialog === 'dismiss' ? 'dismissFollowUp' : 'logCall', lang)} confirmLabel={t(dialog === 'dismiss' ? 'dismiss' : 'save', lang)} danger={dialog === 'dismiss'}
        onConfirm={() => { if (dialog && (dialog === 'dismiss' || note.trim())) act.mutate({ op: dialog, text: note.trim() }, { onSettled: () => setDialog(null) }); }}
        onCancel={() => setDialog(null)}>
        <Field label={t(dialog === 'dismiss' ? 'dismissReason' : 'callNote', lang)} optional={dialog === 'dismiss' ? t('optional', lang) : undefined}>
          {(a) => <Input id={a.id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={dialog === 'dismiss' ? 300 : 500} placeholder={dialog === 'contact' ? t('callNoteExample', lang) : undefined} />}
        </Field>
      </ConfirmDialog>
    </Card>
  );
}

/** The follow-ups of one patient on the profile, with a quick "add". */
export function PatientFollowUpsCard({ lang, clinicId, patientId, canWrite, canBook }: { lang: Lang; clinicId: string; patientId: string; canWrite: boolean; canBook: boolean }) {
  const list = usePatientRecalls(clinicId, patientId);
  const [adding, setAdding] = useState(false);
  const [reason, setReason] = useState<RecallReason>('checkup');
  const [due, setDue] = useState(addMonths(todayIso(), 6));
  const add = useClinicalMutation(clinicId, () => send(`/patients/${patientId}/recalls`, 'POST', { reason, dueDate: due }));
  return (
    <Card>
      <div className="row-between">
        <h2>{t('followUps', lang)}</h2>
        {canWrite && !adding && <Button variant="secondary" onClick={() => setAdding(true)}>{t('addFollowUp', lang)}</Button>}
      </div>
      {adding && (
        <form className="grid-2 mt" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined, { onSuccess: () => setAdding(false) }); }}>
          <Field label={t('followUpReason', lang)}>
            {(a) => <Choice id={a.id} lang={lang} value={reason} onChange={(x) => setReason(x as RecallReason)} options={REASONS.map((x) => ({ value: x, label: t(`recall_${x}` as Key, lang) }))} />}
          </Field>
          <Field label={t('dueDate', lang)}>{(a) => <DatePicker id={a.id} lang={lang} value={due} onChange={setDue} min={todayIso()} />}</Field>
          <ErrorText error={add.error} />
          <div className="row-end"><Button variant="ghost" onClick={() => setAdding(false)}>{t('cancel', lang)}</Button><Button type="submit" loading={add.isPending}>{t('save', lang)}</Button></div>
        </form>
      )}
      {list.isError ? <ErrorText error={list.error} onRetry={() => void list.refetch()} />
        : !list.data?.length ? <p className="muted small mt-sm">{t('noFollowUps', lang)}</p>
        : <ul className="stack mt">{list.data.map((r) => <RecallRow key={r.id} lang={lang} clinicId={clinicId} r={r} today={todayIso()} canWrite={canWrite} canBook={canBook} compact />)}</ul>}
    </Card>
  );
}
