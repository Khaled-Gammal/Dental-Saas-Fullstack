import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button as IconButton } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DatePicker } from '../../components/date-picker';
import { navigate } from '../../hooks';
import { appointmentActionLabel, appointmentSourceLabel, appointmentStatusLabel } from '../../labels';
import { waitingList } from '../../calendar-model';
import { send, useAppointmentAction, useAppointments, useBalances, useBranches, useCheckIn, useClinicalMutation, type AppointmentAction } from '../../queries';
import { to } from '../../router';
import { RouteLink } from '../../ui/page';
import type { Appointment, AppointmentStatus, Branch } from '../../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, OtpInput, PageHeader, Skeleton } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { CalendarIcon, CheckIcon, EditIcon, PlusIcon } from '../../ui/icons';
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
      <SelectTrigger className={className ?? 'h-10 min-w-48'} aria-label="الفرع"><SelectValue /></SelectTrigger>
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
const VIEWS: { v: View; key: string }[] = [{ v: 'all', key: 'كل المواعيد' }, { v: 'waiting', key: 'قائمة الانتظار' }, { v: 'mine', key: 'مواعيدي' }];
/** What "Change" can do per status: move while pending/confirmed, set the chair until the visit ends. */
const CHANGEABLE: AppointmentStatus[] = ['pending', 'confirmed', 'checked_in', 'in_progress'];
/** A visit is opened once the patient has arrived (VISIT-001). */
const VISITABLE: AppointmentStatus[] = ['checked_in', 'in_progress'];

/** Opens the visit of an arrived patient (or the one already open) and goes to it; another doctor's is refused by the API. */
function OpenVisitButton({ clinicId, appointmentId }: { clinicId: string; appointmentId: string }) {
  const open = useClinicalMutation(clinicId, () => send<{ id: string }>('/visits', 'POST', { appointmentId }));
  return (
    <>
      <Button variant="secondary" loading={open.isPending} onClick={() => open.mutate(undefined, { onSuccess: (v) => navigate(to.visit(v.id)) })}>فتح الزيارة</Button>
      <ErrorText error={open.error} />
    </>
  );
}

export function Appointments({ clinicId, canWrite, canOwn, query, defaultView = 'all', canVisit = false, canReadVisit = false, canSeeBalances = false }: {
  clinicId: string; canWrite: boolean; canOwn: boolean; query?: Record<string, string>; defaultView?: View;
  /** invoices:read or invoices:read:own: show what each patient owes (BILLING-005 at check-in) */
  canSeeBalances?: boolean;
  /** clinical:write: open the visit of an arrived patient (the API checks it is the doctor's own); clinical:read: open an existing one */
  canVisit?: boolean; canReadVisit?: boolean;
}) {
  const today = isoDate(new Date());
  const date = query?.date && ISO.test(query.date) ? query.date : today;
  const branchId = query?.branch || undefined;
  const view: View = query?.view === 'waiting' || query?.view === 'mine' || query?.view === 'all' ? query.view : defaultView;
  const go = (next: { date?: string; branch?: string | null; view?: View }) => {
    const branch = next.branch === undefined ? branchId : next.branch || undefined;
    const v = next.view ?? view;
    navigate({ page: 'appointments', query: { date: next.date ?? date, ...(branch && { branch }), ...(v !== defaultView && { view: v }) } });
  };
  const branches = useBranches(clinicId);
  const day = useAppointments(clinicId, date, branchId, view === 'mine');
  // a doctor's own-only actions (appointments:write:own, their visits) show where every row is theirs: the "mine" view
  const own = canOwn && view === 'mine';
  const queue = waitingList(day.data?.appointments ?? [], Date.now());
  const patientIds = [...new Set((day.data?.appointments ?? []).flatMap((a) => (a.patient ? [a.patient.id] : [])))];
  const balances = useBalances(clinicId, patientIds, canSeeBalances).data ?? {};
  const tz = day.data?.timezone ?? 'Africa/Cairo';
  const time = (iso: string) => new Intl.DateTimeFormat(locale(), { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));

  const act = useAppointmentAction(clinicId);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [arriving, setArriving] = useState<Appointment | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<unknown>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  // opens the form on the day and branch being looked at
  const newButton = canWrite && (
    <Button onClick={() => navigate(to.create('appointments', { date, ...(branchId && { branch: branchId }) }))}><PlusIcon size={18} />موعد جديد</Button>
  );
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
      <PageHeader title="المواعيد" sub="مواعيد اليوم، تسجيل حضور المرضى، ومتابعة حالة كل زيارة" action={canWrite ? (
        <>
          {view !== 'mine' && <Button variant="secondary" onClick={() => setCheckingIn(true)}><CheckIcon size={18} />تسجيل الحضور</Button>}
          {newButton}
        </>
      ) : undefined} />
      {/* one row: the views on the start side; the day (stepper, today) and the branch on the end side */}
      <div className="day-toolbar">
        <div className="seg" role="group" aria-label="المواعيد">
          {VIEWS.filter((x) => x.v !== 'mine' || canOwn).map((x) => (
            <button key={x.v} type="button" aria-pressed={view === x.v} className={`seg-btn${view === x.v ? ' is-on' : ''}`} onClick={() => go({ view: x.v })}>
              {x.key}{x.v === 'waiting' && queue.waiting.length > 0 && <Badge tone="warning">{fmtNumber(queue.waiting.length)}</Badge>}
            </button>
          ))}
        </div>
        <div className="day-nav">
          {/* right-to-left: the previous day is on the right, its arrow points right */}
          <div className="day-stepper">
            <IconButton variant="outline" size="icon-lg" aria-label="اليوم السابق" onClick={() => go({ date: shiftDate(date, -1) })}><ChevronRight /></IconButton>
            <DatePicker value={date} onChange={(d) => go({ date: d })} label="التاريخ" />
            <IconButton variant="outline" size="icon-lg" aria-label="اليوم التالي" onClick={() => go({ date: shiftDate(date, 1) })}><ChevronLeft /></IconButton>
          </div>
          <IconButton variant="outline" className="h-10" disabled={date === today} onClick={() => go({ date: today })}>اليوم</IconButton>
          <BranchSelect branches={branches.data ?? []} value={branchId ?? ALL} onChange={(v) => go({ branch: v === ALL ? null : v })} allLabel="كل الفروع" />
        </div>
      </div>

      {canWrite && <CheckInDialog open={checkingIn} onOpenChange={setCheckingIn} clinicId={clinicId} branches={branches.data ?? []} defaultBranch={branchId} canSeeBalances={canSeeBalances} />}
      {actionError != null && <ErrorText error={actionError} />}

      <h2 className="day-title">
        <CalendarIcon size={18} />{new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))}
        {date === today && <Badge tone="primary">اليوم</Badge>}
        {!!day.data?.appointments.length && view !== 'waiting' && <span className="page-count">{fmtNumber(day.data.appointments.length)}</span>}
      </h2>
      {day.isError ? (
        <ErrorText error={day.error} onRetry={() => void day.refetch()} />
      ) : day.isLoading ? (
        <ul className="appts"><Skeleton h={84} count={4} /></ul>
      ) : view === 'waiting' ? (
        <WaitingView queue={queue} time={time} canStart={canWrite} onStart={(a) => run(a, 'start')} balances={balances} />
      ) : !day.data?.appointments.length ? (
        <Card><EmptyState icon={<CalendarIcon size={28} />} title="لا توجد مواعيد في هذا اليوم" text="المواعيد المحجوزة من الموقع تظهر هنا تلقائيًا." action={newButton || undefined} /></Card>
      ) : (
        <ul className="appts" aria-busy={day.isFetching || undefined}>
          {day.data.appointments.map((a) => {
            const actions = (ACTIONS[a.status] ?? []).filter((x) => canWrite || (own && OWN_ACTIONS.includes(x)));
            return (
              <Card as="li" key={a.id} className={`appt is-${a.status}`}>
                <div className="appt-time">
                  <strong><bdi dir="ltr">{time(a.starts_at)}</bdi></strong>
                  <span className="muted"><bdi dir="ltr">{time(a.ends_at)}</bdi></span>
                </div>
                <div className="appt-main">
                  <div className="appt-head">
                    <strong><bdi>{a.patient?.full_name ?? '—'}</bdi></strong>
                    <Badge tone={TONE[a.status]}>{appointmentStatusLabel[a.status]}</Badge>
                    <Owes balance={a.patient ? balances[a.patient.id] : undefined} />
                  </div>
                  <div className="appt-meta">
                    {a.patient && <span dir="ltr">{a.patient.phone}</span>}
                    <span><bdi>{arName(a.doctor.name_ar, a.doctor.name_en)}</bdi></span>
                    {a.service && <span><bdi>{arName(a.service.name_ar, a.service.name_en)}</bdi></span>}
                    <span className="muted">{appointmentSourceLabel[a.source]}</span>
                    {a.room && <span>الكرسي: <bdi>{a.room.name}</bdi></span>}
                  </div>
                  {a.patient_notes && <p className="appt-notes">{a.patient_notes}</p>}
                  {a.cancel_reason && <p className="appt-notes muted">{a.cancel_reason}</p>}
                </div>
                {(actions.length > 0 || (canWrite && CHANGEABLE.includes(a.status)) || (a.visit_id && canReadVisit) || (canVisit && (canWrite || own) && VISITABLE.includes(a.status))) && (
                  <div className="appt-actions">
                    {a.visit_id && canReadVisit ? <RouteLink route={to.visit(a.visit_id)} className="btn btn-secondary">فتح الزيارة</RouteLink>
                      : canVisit && (canWrite || own) && VISITABLE.includes(a.status) && <OpenVisitButton clinicId={clinicId} appointmentId={a.id} />}
                    {canWrite && CHANGEABLE.includes(a.status) && (
                      <RouteLink route={to.edit('appointments', a.id)} className="btn btn-ghost"><EditIcon size={16} />تغيير</RouteLink>
                    )}
                    {actions.map((x) => (
                      <Button key={x} variant={x === 'cancel' || x === 'noShow' ? 'ghost' : x === 'confirm' || x === 'complete' ? 'primary' : 'secondary'}
                        onClick={() => run(a, x)} loading={act.isPending && act.variables?.id === a.id && act.variables.action === x}>
                        {appointmentActionLabel[x]}
                      </Button>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </ul>
      )}

      <ConfirmDialog open={!!arriving} title="تسجيل الوصول بدون رمز" confirmLabel="وصل المريض"
        onConfirm={() => { if (arriving && note.trim().length >= 3) act.mutate({ id: arriving.id, action: 'arrive', note: note.trim() }, { onError: setActionError, onSettled: () => setArriving(null) }); }}
        onCancel={() => setArriving(null)}>
        <p>هذا الحجز من الموقع وله رمز حضور. إن لم يكن مع المريض، اكتب كيف تحققت من هويته.</p>
        <Field label="سبب التسجيل بدون رمز">{(f) => <Input id={f.id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="مثال: تم التحقق من البطاقة، الهاتف مفقود" />}</Field>
      </ConfirmDialog>
      <ConfirmDialog open={!!cancelling} title="إلغاء الموعد" confirmLabel="إلغاء الموعد" danger onConfirm={confirmCancel} onCancel={() => setCancelling(null)}>
        <p>سيُفرَّغ هذا الوقت ويمكن حجزه من جديد.</p>
        <Field label="سبب الإلغاء" optional="اختياري">{(f) => <Input id={f.id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
      </ConfirmDialog>
    </>
  );
}

/** Reception types the 6-digit code the patient shows; the API consumes it once and reports what is still to be paid. */
/** Check-in by the patient's code, in a dialog opened from the header (it stays open for the next patient). */
function CheckInDialog({ open, onOpenChange, clinicId, branches, defaultBranch, canSeeBalances }: {
  open: boolean; onOpenChange: (open: boolean) => void; clinicId: string; branches: Branch[]; defaultBranch?: string; canSeeBalances: boolean;
}) {
  const [code, setCode] = useState('');
  const [branch, setBranch] = useState('');
  const branchId = branch || defaultBranch || branches[0]?.id || '';
  const checkIn = useCheckIn(clinicId);
  const arrived = checkIn.data?.appointment.patient?.id;
  const owed = useBalances(clinicId, arrived ? [arrived] : [], canSeeBalances && checkIn.isSuccess).data?.[arrived ?? ''] ?? 0;
  const digits = toAsciiDigits(code).replace(/\D/g, '');
  const submit = (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (digits.length !== 6 || !branchId) return;
    checkIn.mutate({ code: digits, branchId }, { onSuccess: () => setCode('') });
  };
  // a fresh start each time it opens: no old code, no old result
  const change = (next: boolean) => { if (!next) { setCode(''); checkIn.reset(); } onOpenChange(next); };
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent dir="rtl" className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-card sm:max-w-md">
        <DialogHeader className="checkin-head">
          <span className="checkin-icon"><CheckIcon /></span>
          <div>
            <DialogTitle className="text-start">تسجيل الحضور</DialogTitle>
            <DialogDescription className="text-start">أدخل رمز الحضور الذي يظهره المريض (6 أرقام)</DialogDescription>
          </div>
        </DialogHeader>
      <form onSubmit={submit} className="checkin-form">
        <OtpInput id="checkin-code" value={code} onChange={setCode} label="رمز الحضور" invalid={checkIn.isError} />
        {branches.length > 1 && <BranchSelect branches={branches} value={branchId} onChange={setBranch} className="h-10 w-full" />}
        <Button type="submit" loading={checkIn.isPending} disabled={digits.length !== 6 || !branchId}>تسجيل الحضور</Button>
        {checkIn.isError && <ErrorText error={checkIn.error} />}
        {checkIn.isSuccess && (
          <Alert tone="success">
            تم تسجيل الحضور: <strong><bdi>{checkIn.data.appointment.patient?.full_name}</bdi></strong>
            {' · '}المطلوب سداده: <strong>{money(checkIn.data.result.amount_due_minor)}</strong>
            {owed > 0 && <>{' · '}رصيد مستحق من فواتير سابقة: <strong><bdi>{money(owed)}</bdi></strong></>}
          </Alert>
        )}
      </form>
      </DialogContent>
    </Dialog>
  );
}

/** BILLING-005: a patient with an outstanding balance from earlier invoices shows it where reception sees them. */
function Owes({ balance }: { balance: number | undefined }) {
  return balance && balance > 0 ? <Badge tone="warning">عليه <bdi>{money(balance)}</bdi></Badge> : null;
}

/** Reception's waiting list (SRS APPT-003): arrival order, minutes waited, who is with the doctor. Refreshes with the day. */
function WaitingView({ queue, time, canStart, onStart, balances }: {
  queue: ReturnType<typeof waitingList>; time: (iso: string) => string; canStart: boolean; onStart: (a: Appointment) => void; balances: Record<string, number>;
}) {
  if (!queue.waiting.length && !queue.withDoctor.length) {
    return <Card><EmptyState icon={<CheckIcon size={28} />} title="لا يوجد مرضى في الانتظار" text="يظهر هنا من سُجّل حضوره، بترتيب الوصول." /></Card>;
  }
  return (
    <ul className="appts">
      {queue.waiting.map(({ appointment: a, waitedMinutes }, i) => (
        <Card as="li" key={a.id} className="appt is-checked_in">
          <div className="appt-time"><strong>{fmtNumber(i + 1)}</strong><span className="muted"><bdi dir="ltr">{time(a.starts_at)}</bdi></span></div>
          <div className="appt-main">
            <div className="appt-head"><strong><bdi>{a.patient?.full_name ?? '—'}</bdi></strong>
              <Badge tone={waitedMinutes >= 20 ? 'warning' : 'neutral'}>ينتظر منذ {fmtNumber(waitedMinutes)} دقيقة</Badge>
              <Owes balance={a.patient ? balances[a.patient.id] : undefined} /></div>
            <div className="appt-meta">
              <span><bdi>{arName(a.doctor.name_ar, a.doctor.name_en)}</bdi></span>
              {a.service && <span><bdi>{arName(a.service.name_ar, a.service.name_en)}</bdi></span>}
              {a.room && <span>الكرسي: <bdi>{a.room.name}</bdi></span>}
            </div>
          </div>
          {canStart && <div className="appt-actions"><Button onClick={() => onStart(a)}>دخول للطبيب</Button></div>}
        </Card>
      ))}
      {queue.withDoctor.map((a) => (
        <Card as="li" key={a.id} className="appt is-in_progress">
          <div className="appt-time"><strong><bdi dir="ltr">{time(a.starts_at)}</bdi></strong></div>
          <div className="appt-main">
            <div className="appt-head"><strong><bdi>{a.patient?.full_name ?? '—'}</bdi></strong><Badge tone="success">مع الطبيب الآن</Badge></div>
            <div className="appt-meta"><span><bdi>{arName(a.doctor.name_ar, a.doctor.name_en)}</bdi></span></div>
          </div>
        </Card>
      ))}
    </ul>
  );
}
