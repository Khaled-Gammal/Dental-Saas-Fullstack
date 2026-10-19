import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '../../components/date-picker';
import { navigate } from '../../hooks';
import { t, type Key } from '../../i18n';
import { waitingList } from '../../calendar-model';
import { send, useAppointmentAction, useAppointments, useBranches, useCheckIn, useClinicalMutation, type AppointmentAction } from '../../queries';
import { to } from '../../router';
import { RouteLink } from '../../ui/page';
import type { Appointment, AppointmentStatus, Branch } from '../../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, OtpInput, PageHeader, Skeleton } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { CalendarIcon, CheckIcon, EditIcon } from '../../ui/icons';
import { fmtNumber, toAsciiDigits } from '../../util';
import { money } from '../../money';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ALL = 'all'; // Radix Select cannot carry an empty value
const isoDate = (d: Date) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD in the browser's zone
const shiftDate = (date: string, days: number) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); return isoDate(d); };
const locale = () => ('ar-EG-u-nu-latn');

const TONE: Record<AppointmentStatus, 'neutral' | 'primary' | 'success' | 'warning'> = {
  held: 'neutral', expired: 'neutral', pending: 'warning', confirmed: 'primary', checked_in: 'success', in_progress: 'success', completed: 'neutral', cancelled: 'neutral', no_show: 'neutral',
};
/** What reception may do next, per status (the API enforces the same lifecycle). */
const ACTIONS: Partial<Record<AppointmentStatus, AppointmentAction[]>> = {
  pending: ['arrive', 'confirm', 'cancel', 'noShow'], confirmed: ['arrive', 'cancel', 'noShow'], checked_in: ['start', 'complete', 'cancel'], in_progress: ['complete'],
};
const OWN_ACTIONS: AppointmentAction[] = ['start', 'complete']; // a doctor with appointments:write:own, on their own visits

function BranchSelect({ branches, value, onChange, allLabel, className }: { branches: Branch[]; value: string; onChange: (id: string) => void; allLabel?: string; className?: string }) {
  return (
    <Select value={value} onValueChange={onChange} dir={'rtl'}>
      <SelectTrigger className={className ?? 'h-10 min-w-48'} aria-label={t('branch')}><SelectValue /></SelectTrigger>
      <SelectContent>
        {allLabel && <SelectItem value={ALL}>{allLabel}</SelectItem>}
        {branches.map((b) => <SelectItem key={b.id} value={b.id}>{arName(b.name_ar, b.name_en, b.slug)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * One day of appointments with reception check-in. The day and branch live in the URL (`#/appointments?date=…&branch=…`)
 * so the screen can be reloaded or shared. `canWrite` = appointments:write, `canOwn` = appointments:write:own.
 */
type View = 'all' | 'waiting' | 'mine';
const VIEWS: { v: View; key: Key }[] = [{ v: 'all', key: 'viewAll' }, { v: 'waiting', key: 'viewWaiting' }, { v: 'mine', key: 'viewMine' }];
/** What "Change" can do per status: move while pending/confirmed, set the chair until the visit ends. */
const CHANGEABLE: AppointmentStatus[] = ['pending', 'confirmed', 'checked_in', 'in_progress'];
/** A visit is opened once the patient has arrived (VISIT-001). */
const VISITABLE: AppointmentStatus[] = ['checked_in', 'in_progress'];

/** Opens the visit of an arrived patient (or the one already open) and goes to it; another doctor's is refused by the API. */
function OpenVisitButton({ clinicId, appointmentId }: { clinicId: string; appointmentId: string }) {
  const open = useClinicalMutation(clinicId, () => send<{ id: string }>('/visits', 'POST', { appointmentId }));
  return (
    <>
      <Button variant="secondary" loading={open.isPending} onClick={() => open.mutate(undefined, { onSuccess: (v) => navigate(to.visit(v.id)) })}>{t('openVisit')}</Button>
      <ErrorText error={open.error} />
    </>
  );
}

export function Appointments({ clinicId, canWrite, canOwn, query, defaultView = 'all', canVisit = false, canReadVisit = false }: {
  clinicId: string; canWrite: boolean; canOwn: boolean; query?: Record<string, string>; defaultView?: View;
  /** clinical:write: open the visit of an arrived patient (the API checks it is the doctor's own); clinical:read: open an existing one */
  canVisit?: boolean; canReadVisit?: boolean;
}) {
  const date = query?.date && ISO.test(query.date) ? query.date : isoDate(new Date());
  const branchId = query?.branch || undefined;
  const view: View = query?.view === 'waiting' || query?.view === 'mine' || query?.view === 'all' ? query.view : defaultView;
  const go = (next: { date?: string; branch?: string | null; view?: View }) => {
    const branch = next.branch === undefined ? branchId : next.branch || undefined;
    const v = next.view ?? view;
    navigate({ page: 'appointments', query: { date: next.date ?? date, ...(branch && { branch }), ...(v !== defaultView && { view: v }) } });
  };
  const branches = useBranches(clinicId);
  const day = useAppointments(clinicId, date, branchId, view === 'mine');
  const queue = waitingList(day.data?.appointments ?? [], Date.now());
  const tz = day.data?.timezone ?? 'Africa/Cairo';
  const time = (iso: string) => new Intl.DateTimeFormat(locale(), { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));

  const act = useAppointmentAction(clinicId);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [arriving, setArriving] = useState<Appointment | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<unknown>(null);
  const run = (a: Appointment, action: AppointmentAction) => {
    setActionError(null);
    if (action === 'cancel') { setCancelling(a); setReason(''); return; }
    // a website booking has a code; checking in without it is allowed with a reason ("ID checked, phone lost")
    if (action === 'arrive' && a.has_code) { setArriving(a); setNote(''); return; }
    act.mutate({ id: a.id, action }, { onError: setActionError });
  };
  const confirmCancel = () => {
    if (!cancelling) return;
    act.mutate({ id: cancelling.id, action: 'cancel', reason: reason.trim() || undefined }, { onError: setActionError, onSettled: () => setCancelling(null) });
  };

  return (
    <>
      <PageHeader title={t('navAppointments')} sub={t('appointmentsSub')} />
      <div className="day-toolbar">
        <div className="day-nav">
          <Button variant="secondary" onClick={() => go({ date: shiftDate(date, -1) })}>{t('prevDay')}</Button>
          <DatePicker value={date} onChange={(d) => go({ date: d })} label={t('date')} />
          <Button variant="secondary" onClick={() => go({ date: shiftDate(date, 1) })}>{t('nextDay')}</Button>
          <Button variant="ghost" onClick={() => go({ date: isoDate(new Date()) })}>{t('today')}</Button>
        </div>
        <BranchSelect branches={branches.data ?? []} value={branchId ?? ALL} onChange={(v) => go({ branch: v === ALL ? null : v })} allLabel={t('allBranches')} />
      </div>

      <div className="seg mt" role="tablist" aria-label={t('navAppointments')}>
        {VIEWS.filter((x) => x.v !== 'mine' || canOwn).map((x) => (
          <button key={x.v} type="button" role="tab" aria-selected={view === x.v} className={`seg-btn${view === x.v ? ' is-on' : ''}`} onClick={() => go({ view: x.v })}>
            {t(x.key)}{x.v === 'waiting' && queue.waiting.length > 0 && <Badge tone="warning">{fmtNumber(queue.waiting.length)}</Badge>}
          </button>
        ))}
      </div>

      {canWrite && view !== 'mine' && <CheckInPanel clinicId={clinicId} branches={branches.data ?? []} defaultBranch={branchId} />}
      {actionError != null && <ErrorText error={actionError} />}

      <h2 className="day-title"><CalendarIcon size={18} />{new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))}</h2>
      {day.isError ? (
        <ErrorText error={day.error} onRetry={() => void day.refetch()} />
      ) : day.isLoading ? (
        <ul className="appts"><Skeleton h={84} count={4} /></ul>
      ) : view === 'waiting' ? (
        <WaitingView queue={queue} time={time} canStart={canWrite || canOwn} onStart={(a) => run(a, 'start')} />
      ) : !day.data?.appointments.length ? (
        <Card><EmptyState icon={<CalendarIcon size={28} />} title={t('noAppointments')} text={t('noAppointmentsText')} /></Card>
      ) : (
        <ul className="appts" aria-busy={day.isFetching || undefined}>
          {day.data.appointments.map((a) => {
            const actions = (ACTIONS[a.status] ?? []).filter((x) => canWrite || (canOwn && OWN_ACTIONS.includes(x)));
            return (
              <Card as="li" key={a.id} className={`appt is-${a.status}`}>
                <div className="appt-time">
                  <strong><bdi dir="ltr">{time(a.starts_at)}</bdi></strong>
                  <span className="muted"><bdi dir="ltr">{time(a.ends_at)}</bdi></span>
                </div>
                <div className="appt-main">
                  <div className="appt-head">
                    <strong><bdi>{a.patient?.full_name ?? '—'}</bdi></strong>
                    <Badge tone={TONE[a.status]}>{t(`status_${a.status}` as Key)}</Badge>
                  </div>
                  <div className="appt-meta">
                    {a.patient && <span dir="ltr">{a.patient.phone}</span>}
                    <span><bdi>{arName(a.doctor.name_ar, a.doctor.name_en)}</bdi></span>
                    {a.service && <span><bdi>{arName(a.service.name_ar, a.service.name_en)}</bdi></span>}
                    <span className="muted">{t(`source_${a.source}` as Key)}</span>
                    {a.room && <span>{t('roomLabel')}: <bdi>{a.room.name}</bdi></span>}
                  </div>
                  {a.patient_notes && <p className="appt-notes">{a.patient_notes}</p>}
                  {a.cancel_reason && <p className="appt-notes muted">{a.cancel_reason}</p>}
                </div>
                {(actions.length > 0 || (canWrite && CHANGEABLE.includes(a.status)) || (a.visit_id && canReadVisit) || (canVisit && VISITABLE.includes(a.status))) && (
                  <div className="appt-actions">
                    {a.visit_id && canReadVisit ? <RouteLink route={to.visit(a.visit_id)} className="btn btn-secondary">{t('openVisit')}</RouteLink>
                      : canVisit && VISITABLE.includes(a.status) && <OpenVisitButton clinicId={clinicId} appointmentId={a.id} />}
                    {canWrite && CHANGEABLE.includes(a.status) && (
                      <RouteLink route={to.edit('appointments', a.id)} className="btn btn-ghost"><EditIcon size={16} />{t('editAppointment')}</RouteLink>
                    )}
                    {actions.map((x) => (
                      <Button key={x} variant={x === 'cancel' || x === 'noShow' ? 'ghost' : x === 'confirm' || x === 'complete' ? 'primary' : 'secondary'}
                        onClick={() => run(a, x)} loading={act.isPending && act.variables?.id === a.id && act.variables.action === x}>
                        {t(`act_${x}` as Key)}
                      </Button>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </ul>
      )}

      <ConfirmDialog open={!!arriving} title={t('arriveWithoutCode')} confirmLabel={t('act_arrive')}
        onConfirm={() => { if (arriving && note.trim().length >= 3) act.mutate({ id: arriving.id, action: 'arrive', note: note.trim() }, { onError: setActionError, onSettled: () => setArriving(null) }); }}
        onCancel={() => setArriving(null)}>
        <p>{t('arriveWithoutCodeText')}</p>
        <Field label={t('arriveNote')}>{(f) => <Input id={f.id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t('arriveNoteExample')} />}</Field>
      </ConfirmDialog>
      <ConfirmDialog open={!!cancelling} title={t('cancelAppointment')} confirmLabel={t('act_cancel')} danger onConfirm={confirmCancel} onCancel={() => setCancelling(null)}>
        <p>{t('cancelAppointmentText')}</p>
        <Field label={t('cancelReason')} optional={t('optional')}>{(f) => <Input id={f.id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
      </ConfirmDialog>
    </>
  );
}

/** Reception types the 6-digit code the patient shows; the API consumes it once and reports what is still to be paid. */
function CheckInPanel({ clinicId, branches, defaultBranch }: { clinicId: string; branches: Branch[]; defaultBranch?: string }) {
  const [code, setCode] = useState('');
  const [branch, setBranch] = useState('');
  const branchId = branch || defaultBranch || branches[0]?.id || '';
  const checkIn = useCheckIn(clinicId);
  const digits = toAsciiDigits(code).replace(/\D/g, '');
  const submit = (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (digits.length !== 6 || !branchId) return;
    checkIn.mutate({ code: digits, branchId }, { onSuccess: () => setCode('') });
  };
  return (
    <Card className="checkin">
      <form onSubmit={submit} className="checkin-form">
        <div className="checkin-head">
          <span className="checkin-icon"><CheckIcon /></span>
          <div><h2>{t('checkInTitle')}</h2><p className="muted">{t('checkInHint')}</p></div>
        </div>
        <div className="checkin-row">
          <OtpInput id="checkin-code" value={code} onChange={setCode} label={t('bookingCode')} invalid={checkIn.isError} />
          {branches.length > 1 && <BranchSelect branches={branches} value={branchId} onChange={setBranch} />}
          <Button type="submit" loading={checkIn.isPending} disabled={digits.length !== 6 || !branchId}>{t('checkInBtn')}</Button>
        </div>
        {checkIn.isError && <ErrorText error={checkIn.error} />}
        {checkIn.isSuccess && (
          <Alert tone="success">
            {t('checkedInOk')}: <strong><bdi>{checkIn.data.appointment.patient?.full_name}</bdi></strong>
            {' · '}{t('amountDue')}: <strong>{money(checkIn.data.result.amount_due_minor)}</strong>
          </Alert>
        )}
      </form>
    </Card>
  );
}

/** Reception's waiting list (SRS APPT-003): arrival order, minutes waited, who is with the doctor. Refreshes with the day. */
function WaitingView({ queue, time, canStart, onStart }: {
  queue: ReturnType<typeof waitingList>; time: (iso: string) => string; canStart: boolean; onStart: (a: Appointment) => void;
}) {
  if (!queue.waiting.length && !queue.withDoctor.length) {
    return <Card><EmptyState icon={<CheckIcon size={28} />} title={t('noWaiting')} text={t('noWaitingText')} /></Card>;
  }
  return (
    <ul className="appts">
      {queue.waiting.map(({ appointment: a, waitedMinutes }, i) => (
        <Card as="li" key={a.id} className="appt is-checked_in">
          <div className="appt-time"><strong>{fmtNumber(i + 1)}</strong><span className="muted"><bdi dir="ltr">{time(a.starts_at)}</bdi></span></div>
          <div className="appt-main">
            <div className="appt-head"><strong><bdi>{a.patient?.full_name ?? '—'}</bdi></strong>
              <Badge tone={waitedMinutes >= 20 ? 'warning' : 'neutral'}>{t('waitingFor')} {fmtNumber(waitedMinutes)} {t('minutesShort')}</Badge></div>
            <div className="appt-meta">
              <span><bdi>{arName(a.doctor.name_ar, a.doctor.name_en)}</bdi></span>
              {a.service && <span><bdi>{arName(a.service.name_ar, a.service.name_en)}</bdi></span>}
              {a.room && <span>{t('roomLabel')}: <bdi>{a.room.name}</bdi></span>}
            </div>
          </div>
          {canStart && <div className="appt-actions"><Button onClick={() => onStart(a)}>{t('callIn')}</Button></div>}
        </Card>
      ))}
      {queue.withDoctor.map((a) => (
        <Card as="li" key={a.id} className="appt is-in_progress">
          <div className="appt-time"><strong><bdi dir="ltr">{time(a.starts_at)}</bdi></strong></div>
          <div className="appt-main">
            <div className="appt-head"><strong><bdi>{a.patient?.full_name ?? '—'}</bdi></strong><Badge tone="success">{t('withDoctor')}</Badge></div>
            <div className="appt-meta"><span><bdi>{arName(a.doctor.name_ar, a.doctor.name_en)}</bdi></span></div>
          </div>
        </Card>
      ))}
    </ul>
  );
}
