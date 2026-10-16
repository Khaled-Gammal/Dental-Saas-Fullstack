import { useState } from 'react';
import { pickName } from '@dental/ui/text';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '../../components/date-picker';
import { navigate } from '../../hooks';
import { t, type Key, type Lang } from '../../i18n';
import { useAppointmentAction, useAppointments, useBranches, useCheckIn, type AppointmentAction } from '../../queries';
import type { Appointment, AppointmentStatus, Branch } from '../../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, OtpInput, PageHeader, Skeleton } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { CalendarIcon, CheckIcon } from '../../ui/icons';
import { fmtNumber, toAsciiDigits } from '../../util';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ALL = 'all'; // Radix Select cannot carry an empty value
const isoDate = (d: Date) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD in the browser's zone
const shiftDate = (date: string, days: number) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); return isoDate(d); };
const locale = (lang: Lang) => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');

const TONE: Record<AppointmentStatus, 'neutral' | 'primary' | 'success' | 'warning'> = {
  held: 'neutral', expired: 'neutral', pending: 'warning', confirmed: 'primary', checked_in: 'success', in_progress: 'success', completed: 'neutral', cancelled: 'neutral', no_show: 'neutral',
};
/** What reception may do next, per status (the API enforces the same lifecycle). */
const ACTIONS: Partial<Record<AppointmentStatus, AppointmentAction[]>> = {
  pending: ['arrive', 'confirm', 'cancel', 'noShow'], confirmed: ['arrive', 'cancel', 'noShow'], checked_in: ['start', 'complete', 'cancel'], in_progress: ['complete'],
};
const OWN_ACTIONS: AppointmentAction[] = ['start', 'complete']; // a doctor with appointments:write:own, on their own visits

function BranchSelect({ lang, branches, value, onChange, allLabel, className }: { lang: Lang; branches: Branch[]; value: string; onChange: (id: string) => void; allLabel?: string; className?: string }) {
  return (
    <Select value={value} onValueChange={onChange} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <SelectTrigger className={className ?? 'h-10 min-w-48'} aria-label={t('branch', lang)}><SelectValue /></SelectTrigger>
      <SelectContent>
        {allLabel && <SelectItem value={ALL}>{allLabel}</SelectItem>}
        {branches.map((b) => <SelectItem key={b.id} value={b.id}>{pickName(lang, b.name_ar, b.name_en, b.slug)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * One day of appointments with reception check-in. The day and branch live in the URL (`#/appointments?date=…&branch=…`)
 * so the screen can be reloaded or shared. `canWrite` = appointments:write, `canOwn` = appointments:write:own.
 */
export function Appointments({ lang, clinicId, canWrite, canOwn, query }: { lang: Lang; clinicId: string; canWrite: boolean; canOwn: boolean; query?: Record<string, string> }) {
  const date = query?.date && ISO.test(query.date) ? query.date : isoDate(new Date());
  const branchId = query?.branch || undefined;
  const go = (next: { date?: string; branch?: string | null }) => {
    const branch = next.branch === undefined ? branchId : next.branch || undefined;
    navigate({ page: 'appointments', query: { date: next.date ?? date, ...(branch && { branch }) } });
  };
  const branches = useBranches(clinicId);
  const day = useAppointments(clinicId, date, branchId);
  const tz = day.data?.timezone ?? 'Africa/Cairo';
  const time = (iso: string) => new Intl.DateTimeFormat(locale(lang), { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

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
      <PageHeader title={t('navAppointments', lang)} sub={t('appointmentsSub', lang)} />
      <div className="day-toolbar">
        <div className="day-nav">
          <Button variant="secondary" onClick={() => go({ date: shiftDate(date, -1) })}>{t('prevDay', lang)}</Button>
          <DatePicker value={date} onChange={(d) => go({ date: d })} lang={lang} label={t('date', lang)} />
          <Button variant="secondary" onClick={() => go({ date: shiftDate(date, 1) })}>{t('nextDay', lang)}</Button>
          <Button variant="ghost" onClick={() => go({ date: isoDate(new Date()) })}>{t('today', lang)}</Button>
        </div>
        <BranchSelect lang={lang} branches={branches.data ?? []} value={branchId ?? ALL} onChange={(v) => go({ branch: v === ALL ? null : v })} allLabel={t('allBranches', lang)} />
      </div>

      {canWrite && <CheckInPanel lang={lang} clinicId={clinicId} branches={branches.data ?? []} defaultBranch={branchId} />}
      {actionError != null && <ErrorText error={actionError} />}

      <h2 className="day-title"><CalendarIcon size={18} />{new Intl.DateTimeFormat(locale(lang), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))}</h2>
      {day.isError ? (
        <ErrorText error={day.error} onRetry={() => void day.refetch()} />
      ) : day.isLoading ? (
        <ul className="appts"><Skeleton h={84} count={4} /></ul>
      ) : !day.data?.appointments.length ? (
        <Card><EmptyState icon={<CalendarIcon size={28} />} title={t('noAppointments', lang)} text={t('noAppointmentsText', lang)} /></Card>
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
                    <Badge tone={TONE[a.status]}>{t(`status_${a.status}` as Key, lang)}</Badge>
                  </div>
                  <div className="appt-meta">
                    {a.patient && <span dir="ltr">{a.patient.phone}</span>}
                    <span><bdi>{pickName(lang, a.doctor.name_ar, a.doctor.name_en)}</bdi></span>
                    {a.service && <span><bdi>{pickName(lang, a.service.name_ar, a.service.name_en)}</bdi></span>}
                    <span className="muted">{t(`source_${a.source}` as Key, lang)}</span>
                  </div>
                  {a.patient_notes && <p className="appt-notes">{a.patient_notes}</p>}
                  {a.cancel_reason && <p className="appt-notes muted">{a.cancel_reason}</p>}
                </div>
                {actions.length > 0 && (
                  <div className="appt-actions">
                    {actions.map((x) => (
                      <Button key={x} variant={x === 'cancel' || x === 'noShow' ? 'ghost' : x === 'confirm' || x === 'complete' ? 'primary' : 'secondary'}
                        onClick={() => run(a, x)} loading={act.isPending && act.variables?.id === a.id && act.variables.action === x}>
                        {t(`act_${x}` as Key, lang)}
                      </Button>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </ul>
      )}

      <ConfirmDialog open={!!arriving} title={t('arriveWithoutCode', lang)} confirmLabel={t('act_arrive', lang)}
        onConfirm={() => { if (arriving && note.trim().length >= 3) act.mutate({ id: arriving.id, action: 'arrive', note: note.trim() }, { onError: setActionError, onSettled: () => setArriving(null) }); }}
        onCancel={() => setArriving(null)}>
        <p>{t('arriveWithoutCodeText', lang)}</p>
        <Field label={t('arriveNote', lang)}>{(f) => <Input id={f.id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t('arriveNoteExample', lang)} />}</Field>
      </ConfirmDialog>
      <ConfirmDialog open={!!cancelling} title={t('cancelAppointment', lang)} confirmLabel={t('act_cancel', lang)} danger onConfirm={confirmCancel} onCancel={() => setCancelling(null)}>
        <p>{t('cancelAppointmentText', lang)}</p>
        <Field label={t('cancelReason', lang)} optional={t('optional', lang)}>{(f) => <Input id={f.id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
      </ConfirmDialog>
    </>
  );
}

/** Reception types the 6-digit code the patient shows; the API consumes it once and reports what is still to be paid. */
function CheckInPanel({ lang, clinicId, branches, defaultBranch }: { lang: Lang; clinicId: string; branches: Branch[]; defaultBranch?: string }) {
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
          <div><h2>{t('checkInTitle', lang)}</h2><p className="muted">{t('checkInHint', lang)}</p></div>
        </div>
        <div className="checkin-row">
          <OtpInput id="checkin-code" value={code} onChange={setCode} label={t('bookingCode', lang)} invalid={checkIn.isError} />
          {branches.length > 1 && <BranchSelect lang={lang} branches={branches} value={branchId} onChange={setBranch} />}
          <Button type="submit" loading={checkIn.isPending} disabled={digits.length !== 6 || !branchId}>{t('checkInBtn', lang)}</Button>
        </div>
        {checkIn.isError && <ErrorText error={checkIn.error} />}
        {checkIn.isSuccess && (
          <Alert tone="success">
            {t('checkedInOk', lang)}: <strong><bdi>{checkIn.data.appointment.patient?.full_name}</bdi></strong>
            {' · '}{t('amountDue', lang)}: <strong>{fmtNumber(checkIn.data.result.amount_due_minor / 100, lang)} {t('egp', lang)}</strong>
          </Alert>
        )}
      </form>
    </Card>
  );
}
