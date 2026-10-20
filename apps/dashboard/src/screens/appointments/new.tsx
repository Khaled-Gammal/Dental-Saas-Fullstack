import { useMemo, useState, type FormEvent } from 'react';
import { arName } from '@dental/ui/text';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { useDebounced, useLeave, useUnsavedChanges } from '../../hooks';
import { t } from '../../i18n';
import { send, useBookAppointment, useBranches, useDoctors, usePatient, usePatients, useServices, useStaffSlots } from '../../queries';
import { to } from '../../router';
import type { Appointment, PatientRow } from '../../types';
import { Alert, Button, Card, Field, Input, Switch, TextArea } from '../../ui/components';
import { AlertIcon } from '../../ui/icons';
import { FormPage } from '../../ui/page';
import { zonedToUtc } from '../../util';
import { useCan } from '../../can';
import { TimeField } from '../../components/time-field';

const todayIso = () => new Date().toLocaleDateString('en-CA');
const SOURCES = ['phone', 'walk_in', 'whatsapp', 'dashboard'] as const;
const loc = () => ('ar-EG-u-nu-latn');

/**
 * `#/appointments/new?patient=<id>`: reception books a patient into a doctor's free time. Free slots come from the
 * same engine as the website (hours, schedule, bookings, time off, holidays). With `appointments:override` a time
 * outside the schedule can be booked with a reason. The database still refuses a double booking.
 * From a visit or plan (APPT-007) `?doctor=&branch=&service=&plan=&item=` pre-fill it and the booking is linked to the
 * planned item; from the follow-up list `?recall=` links it to the follow-up.
 */
export function NewAppointment({ clinicId, patientId, canOverride, prefill }: { clinicId: string; patientId?: string; canOverride: boolean; prefill?: Record<string, string> }) {
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null);
  const preset = usePatient(clinicId, patient ? undefined : patientId);
  const chosen = patient ?? (preset.data ? { id: preset.data.id, name: preset.data.full_name } : null);
  const allergies = preset.data && chosen?.id === preset.data.id ? preset.data.medicalHistory?.allergies ?? [] : [];

  const branches = useBranches(clinicId);
  const doctors = useDoctors(clinicId);
  const services = useServices(clinicId);
  const activeBranches = (branches.data ?? []).filter((b) => b.is_active);
  const [branchId, setBranchId] = useState(prefill?.branch ?? '');
  const branch = branchId || (activeBranches.length === 1 ? activeBranches[0].id : '');
  const doctorsHere = (doctors.data ?? []).filter((d) => d.is_active && d.branch_ids.includes(branch));
  const [doctorId, setDoctorId] = useState(prefill?.doctor ?? '');
  const doctor = doctorsHere.some((d) => d.id === doctorId) ? doctorId : '';
  const [serviceId, setServiceId] = useState(prefill?.service ?? '');
  const service = (services.data ?? []).find((s) => s.id === serviceId && s.is_active);
  const [date, setDate] = useState(todayIso());
  const [slot, setSlot] = useState('');
  const [override, setOverride] = useState(false);
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('30');
  const [reason, setReason] = useState('');
  const [source, setSource] = useState<(typeof SOURCES)[number]>('phone');
  const [notes, setNotes] = useState('');

  const slots = useStaffSlots(clinicId, { branchId: branch, doctorId: doctor, serviceId: service?.id, date });
  const tz = slots.data?.timezone ?? 'Africa/Cairo';
  const fmtTime = (iso: string) => new Intl.DateTimeFormat(loc(), { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));

  const startsAt = override ? (time && /^\d{2}:\d{2}$/.test(time) ? new Date(zonedToUtc(date, time, tz)).toISOString() : '') : slot;
  const minutes = Number(duration);
  const ready = !!chosen && !!branch && !!doctor && !!startsAt && (!override || (reason.trim().length >= 3 && (!!service || (minutes >= 5 && minutes <= 480))));
  const dirty = !!(chosen || doctor || slot || time || notes);
  useUnsavedChanges(dirty, t('leaveUnsaved'));

  const book = useBookAppointment(clinicId);
  const leave = useLeave({ page: 'appointments', query: { date, ...(branch && { branch }) } });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !chosen) return;
    book.mutate({
      patientId: chosen.id, branchId: branch, doctorId: doctor, serviceId: service?.id ?? null, startsAt, source,
      ...(!service && { durationMinutes: override ? minutes : slots.data?.durationMinutes }),
      ...(notes.trim() && { notes: notes.trim() }), ...(override && { overrideReason: reason.trim() }),
    }, {
      onSuccess: async (appt) => {
        // the link is a second call: if it fails the booking still stands, and the item or follow-up stays open
        const id = (appt as Appointment).id;
        if (prefill?.plan && prefill.item) await send(`/plans/${prefill.plan}/items/${prefill.item}/schedule`, 'POST', { appointmentId: id }).catch(() => null);
        if (prefill?.recall) await send(`/recalls/${prefill.recall}/book`, 'POST', { appointmentId: id }).catch(() => null);
        leave(t('appointmentBooked'));
      },
    });
  };

  const crumbs = [{ label: t('navAppointments'), route: to.list('appointments') }, { label: t('newAppointment') }];
  const reset = () => { setSlot(''); book.reset(); };

  return (
    <FormPage title={t('newAppointment')} crumbs={crumbs} back={to.list('appointments')} onSubmit={submit} saving={book.isPending} canSave={ready} error={book.error}>
      <Card>
        <h2>{t('patient')}</h2>
        {chosen ? (
          <div className="row-between mt-sm">
            <strong><bdi>{chosen.name}</bdi></strong>
            {/* dropping ?patient= from the URL too, so a reload does not bring the old choice back */}
            <button type="button" className="link-btn" onClick={() => { setPatient(null); window.location.hash = '#/appointments/new'; }}>{t('change')}</button>
          </div>
        ) : <PatientPicker clinicId={clinicId} onPick={(p) => setPatient({ id: p.id, name: p.full_name })} />}
        {allergies.length > 0 && <Alert tone="danger"><AlertIcon size={16} /> <strong>{t('allergies')}:</strong> <bdi>{allergies.join('، ')}</bdi></Alert>}
      </Card>

      <Card>
        <h2>{t('whenAndWho')}</h2>
        <div className="grid-2 mt">
          <Field label={t('branch')}>
            {(a) => <Choice id={a.id} value={branch} onChange={(v) => { setBranchId(v); setDoctorId((d) => ((doctors.data ?? []).some((x) => x.id === d && x.branch_ids.includes(v)) ? d : '')); reset(); }} placeholder={t('pickBranch')}
              options={activeBranches.map((b) => ({ value: b.id, label: arName(b.name_ar, b.name_en, b.slug) }))} />}
          </Field>
          <Field label={t('doctor')}>
            {(a) => <Choice id={a.id} value={doctor} onChange={(v) => { setDoctorId(v); reset(); }} placeholder={t(branch ? 'pickDoctor' : 'pickBranchFirst')} disabled={!branch}
              options={doctorsHere.map((d) => ({ value: d.id, label: arName(d.name_ar, d.name_en) }))} />}
          </Field>
          <Field label={t('service')} optional={t('optional')}>
            {(a) => <Choice id={a.id} value={service?.id ?? ''} onChange={(v) => { setServiceId(v); reset(); }} noneLabel={t('noService')}
              options={(services.data ?? []).filter((s) => s.is_active).map((s) => ({ value: s.id, label: `${arName(s.name_ar, s.name_en)} · ${s.duration_minutes} ${t('minutes')}` }))} />}
          </Field>
          <Field label={t('date')}>
            {(a) => <DatePicker id={a.id} value={date} onChange={(d) => { setDate(d); reset(); }} min={todayIso()} />}
          </Field>
        </div>
      </Card>

      <Card>
        <div className="row-between">
          <h2>{t('time')}</h2>
          {canOverride && <Switch checked={override} onChange={(v) => { setOverride(v); reset(); }} label={t('outsideSchedule')} />}
        </div>
        {override ? (
          <div className="grid-2 mt">
            <Field label={t('time')} hint={t('tzHint').replace('{tz}', tz)}>{(a) => <TimeField id={a.id} describedBy={a.describedBy} value={time} onChange={setTime} />}</Field>
            {!service && <Field label={t('duration')}>{(a) => <Input id={a.id} type="number" dir="ltr" min={5} max={480} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />}</Field>}
            <Field label={t('overrideReason')} hint={t('overrideHint')}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
          </div>
        ) : !doctor ? <p className="muted small mt-sm">{t('pickDoctorForSlots')}</p>
          : slots.isLoading ? <p className="muted small mt-sm" role="status">{t('loading')}</p>
            : slots.isError ? <p className="field-error mt-sm">{t('err_network')}</p>
              : !slots.data?.slots.length ? <p className="muted small mt-sm">{t('noSlots')}</p>
                : (
                  <div className="slot-grid mt" role="radiogroup" aria-label={t('time')}>
                    {slots.data.slots.map((s) => (
                      <button key={s} type="button" role="radio" aria-checked={slot === s} className={`slot-btn${slot === s ? ' is-on' : ''}`} onClick={() => setSlot(s)}>
                        <bdi dir="ltr">{fmtTime(s)}</bdi>
                      </button>
                    ))}
                  </div>
                )}
      </Card>

      <Card>
        <div className="grid-2">
          <Field label={t('bookedVia')}>
            {(a) => <Choice id={a.id} value={source} onChange={(v) => setSource(v as (typeof SOURCES)[number])} options={SOURCES.map((s) => ({ value: s, label: t(`source_${s}`) }))} />}
          </Field>
        </div>
        <div className="stack mt">
          <Field label={t('internalNotes')} optional={t('optional')}>{(a) => <TextArea id={a.id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}</Field>
        </div>
      </Card>
    </FormPage>
  );
}

/** Find the patient by name, mobile or file number; create one if nobody matches. */
function PatientPicker({ clinicId, onPick }: { clinicId: string; onPick: (p: PatientRow) => void }) {
  const canAdd = useCan()('patients:write');
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim(), 250);
  const found = usePatients(clinicId, search);
  const rows = useMemo(() => (search ? found.data?.pages[0]?.items ?? [] : []), [found.data, search]);
  return (
    <div className="stack mt-sm">
      <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('patientSearchHint')} aria-label={t('patientSearch')} autoFocus />
      {search && (
        <ul className="pick-list" aria-busy={found.isFetching || undefined}>
          {rows.map((p) => (
            <li key={p.id}><button type="button" className="pick-item" onClick={() => onPick(p)} disabled={p.is_blocked}>
              <strong><bdi>{p.full_name}</bdi></strong><span className="muted small">#{p.file_no} · <span dir="ltr">{p.phone}</span></span>
            </button></li>
          ))}
          {!found.isFetching && rows.length === 0 && <li className="muted small">{t('noPatientMatch')}</li>}
        </ul>
      )}
      {canAdd && <p className="small"><Button variant="ghost" onClick={() => { window.location.hash = '#/patients/new'; }}>{t('addPatient')}</Button></p>}
    </div>
  );
}
