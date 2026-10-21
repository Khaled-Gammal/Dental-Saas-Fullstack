import { useState, type FormEvent } from 'react';
import { arName } from '@dental/ui/text';
import { moveBody } from '../../calendar-model';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { useLeave, useUnsavedChanges } from '../../hooks';
import { useAppointment, useDoctors, useMoveAppointment, useRooms, useStaffSlots } from '../../queries';
import { to } from '../../router';
import type { Appointment, Doctor, Room } from '../../types';
import { Alert, Card, Field, Input, Switch } from '../../ui/components';
import { FormPage, ResourceState } from '../../ui/page';
import { zonedToUtc } from '../../util';
import { TimeField } from '../../components/time-field';

const loc = () => ('ar-EG-u-nu-latn');
const dateIn = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
const todayIso = () => new Date().toLocaleDateString('en-CA');

/**
 * `#/appointments/<id>/edit`: move a booking to another free time or doctor at the same branch, and/or set its chair
 * (SRS APPT-001, APPT-006). The free times treat the booking's own current time as free. With `appointments:override`
 * a time outside the schedule can be chosen with a reason; the database still refuses a double booking.
 */
export function MoveAppointment({ clinicId, id, canOverride }: { clinicId: string; id?: string; canOverride: boolean }) {
  const appt = useAppointment(clinicId, id);
  const doctors = useDoctors(clinicId);
  const rooms = useRooms(clinicId, appt.data?.branch_id);
  if (!appt.data || !doctors.data) {
    const q = [appt, doctors].find((x) => x.isError) ?? appt;
    return <ResourceState isLoading={!q.isError} isError={q.isError} error={q.error} notFound={false} refetch={() => void q.refetch()} back={to.list('appointments')} backLabel="المواعيد" />;
  }
  return <MoveBody key={appt.data.id} clinicId={clinicId} appt={appt.data} canOverride={canOverride}
    doctors={doctors.data.filter((d) => d.is_active && d.branch_ids.includes(appt.data!.branch_id))} rooms={(rooms.data ?? []).filter((r) => r.is_active || r.id === appt.data!.room_id)} />;
}

function MoveBody({ clinicId, appt, doctors, rooms, canOverride }: {
  clinicId: string; appt: Appointment; doctors: Doctor[]; rooms: Room[]; canOverride: boolean;
}) {
  const canMove = appt.status === 'pending' || appt.status === 'confirmed';
  const lengthMin = Math.round((Date.parse(appt.ends_at) - Date.parse(appt.starts_at)) / 60_000);
  // the branch's zone comes with the free times; Cairo until they load (every branch defaults to it)
  const [date, setDate] = useState(() => dateIn(appt.starts_at, 'Africa/Cairo'));
  const [doctorId, setDoctorId] = useState(appt.doctor_id);
  const [slot, setSlot] = useState('');
  const [override, setOverride] = useState(false);
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [roomId, setRoomId] = useState(appt.room_id ?? '');
  const leave = useLeave(to.list('appointments'));
  const move = useMoveAppointment(clinicId);

  const slots = useStaffSlots(clinicId, { branchId: appt.branch_id, doctorId, date, durationMinutes: lengthMin, excludeAppointmentId: appt.id });
  const tz = slots.data?.timezone ?? 'Africa/Cairo';
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(loc(), { timeZone: tz, ...opts }).format(new Date(iso));
  const fmtTime = (iso: string) => fmt(iso, { hour: 'numeric', minute: '2-digit', hour12: true });

  const startsAt = !canMove ? appt.starts_at
    : override ? (time && /^\d{2}:\d{2}$/.test(time) ? new Date(zonedToUtc(date, time, tz)).toISOString() : '')
    : slot || (doctorId === appt.doctor_id ? appt.starts_at : '');
  const body = moveBody(
    { startsAt: appt.starts_at, doctorId: appt.doctor_id, roomId: appt.room_id },
    { startsAt: startsAt || appt.starts_at, doctorId, roomId: roomId || null, overrideReason: override ? reason : undefined },
  );
  const dirty = Object.keys(body).length > 0;
  const ready = dirty && !!startsAt && (!override || reason.trim().length >= 3);
  useUnsavedChanges(dirty, 'لديك تغييرات غير محفوظة. هل تريد المغادرة بدون حفظ؟');
  const reset = () => { setSlot(''); setTime(''); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    move.mutate({ id: appt.id, body }, { onSuccess: (a) => leave('تم حفظ التغيير.', { page: 'appointments', query: { date: dateIn(a.starts_at, tz) } }) });
  };
  const crumbs = [{ label: 'نظرة عامة', route: to.list('overview') }, { label: 'المواعيد', route: to.list('appointments') }, { label: 'تغيير الموعد' }];

  return (
    <FormPage title="تغيير الموعد" sub="اختر وقتًا آخر أو طبيبًا آخر في نفس الفرع، أو حدّد الكرسي." crumbs={crumbs} back={to.list('appointments')} onSubmit={submit}
      saving={move.isPending} canSave={ready} error={move.error}>
      <Card>
        <h2><bdi>{appt.patient?.full_name ?? '—'}</bdi></h2>
        <p className="muted mt-sm">
          الموعد الحالي: <strong><bdi>{fmt(appt.starts_at, { weekday: 'long', day: 'numeric', month: 'long' })} · <span dir="ltr">{fmtTime(appt.starts_at)}</span></bdi></strong>
          {' · '}<bdi>{arName(appt.doctor.name_ar, appt.doctor.name_en)}</bdi>
        </p>
        {!canMove && <Alert tone="info">يمكن تغيير الوقت للمواعيد المؤكدة أو المنتظرة فقط؛ بعد الحضور يمكن تحديد الكرسي فقط.</Alert>}
      </Card>

      {canMove && (
        <Card>
          <div className="row-between">
            <h2>الوقت الجديد</h2>
            {canOverride && <Switch checked={override} onChange={(v) => { setOverride(v); reset(); }} label="خارج جدول الطبيب" />}
          </div>
          <div className="grid-2 mt">
            <Field label="الطبيب">
              {(a) => <Choice id={a.id} value={doctorId} onChange={(v) => { setDoctorId(v); reset(); }}
                options={doctors.map((d) => ({ value: d.id, label: arName(d.name_ar, d.name_en, '—') }))} />}
            </Field>
            <Field label="التاريخ">
              {(a) => <DatePicker id={a.id} value={date} onChange={(d) => { setDate(d); reset(); }} min={todayIso()} />}
            </Field>
          </div>
          {override ? (
            <div className="grid-2 mt">
              <Field label="الوقت" hint={'بتوقيت الفرع ({tz})'.replace('{tz}', tz)}>{(a) => <TimeField id={a.id} describedBy={a.describedBy} value={time} onChange={setTime} />}</Field>
              <Field label="سبب الحجز خارج الجدول" hint="يُحفظ مع الموعد للمراجعة.">{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
            </div>
          ) : slots.isLoading ? <p className="muted small mt-sm" role="status">جارٍ التحميل…</p>
            : slots.isError ? <p className="field-error mt-sm">تعذّر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.</p>
            : !slots.data?.slots.length ? <p className="muted small mt-sm">لا توجد أوقات متاحة في هذا اليوم.</p>
            : (
              <div className="slot-grid mt" role="radiogroup" aria-label="الوقت">
                {slots.data.slots.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={slot === s} className={`slot-btn${slot === s ? ' is-on' : ''}`} onClick={() => setSlot(slot === s ? '' : s)}>
                    <bdi dir="ltr">{fmtTime(s)}</bdi>
                  </button>
                ))}
              </div>
            )}
          <p className="muted small mt-sm">إذا تغيّر اليوم لحجز من الموقع، يصل المريض رمز حضور جديد بالبريد ويتوقف القديم.</p>
        </Card>
      )}

      <Card>
        <Field label="الكرسي" optional="اختياري">
          {(a) => <Choice id={a.id} value={roomId} onChange={setRoomId} noneLabel="بدون كرسي" options={rooms.map((r) => ({ value: r.id, label: r.name }))} />}
        </Field>
      </Card>
    </FormPage>
  );
}
