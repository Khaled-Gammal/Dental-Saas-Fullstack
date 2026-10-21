import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { arName, initials } from '@dental/ui/text';
import { CalendarDays, Check, Clock, Footprints, LayoutDashboard, MapPin, MessageCircle, Phone, Search, Stethoscope, Tag, UserPlus, UserRound, type LucideIcon } from 'lucide-react';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { useDebounced, useLeave, useUnsavedChanges } from '../../hooks';
import { appointmentSourceLabel } from '../../labels';
import { currencyLabel } from '../../money';
import { send, useBookAppointment, useBranches, useDoctors, usePatient, usePatients, useServices, useStaffSlots } from '../../queries';
import { to } from '../../router';
import { priceParts } from '../../service-model';
import type { Appointment, Doctor, PatientRow } from '../../types';
import { Alert, Badge, Button, Card, Field, Input, Switch, TextArea } from '../../ui/components';
import { AlertIcon } from '../../ui/icons';
import { FormPage } from '../../ui/page';
import { fmtNumber, zonedToUtc } from '../../util';
import { useCan } from '../../can';
import { TimeField } from '../../components/time-field';

const todayIso = () => new Date().toLocaleDateString('en-CA');
const tomorrowIso = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA'); };
const SOURCES = ['phone', 'walk_in', 'whatsapp', 'dashboard'] as const;
const SOURCE_ICON: Record<(typeof SOURCES)[number], LucideIcon> = { phone: Phone, walk_in: Footprints, whatsapp: MessageCircle, dashboard: LayoutDashboard };
const loc = () => ('ar-EG-u-nu-latn');
/** the free times split by part of the day, in the branch's zone */
const PERIODS = [
  { label: 'صباحًا', from: 0, to: 12 },
  { label: 'بعد الظهر', from: 12, to: 17 },
  { label: 'مساءً', from: 17, to: 24 },
];
type Chosen = { id: string; name: string; fileNo?: number; phone?: string };

/**
 * `#/appointments/new?patient=<id>`: reception books a patient into a doctor's free time. Free slots come from the
 * same engine as the website (hours, schedule, bookings, time off, holidays). With `appointments:override` a time
 * outside the schedule can be booked with a reason. The database still refuses a double booking.
 * From a visit or plan (APPT-007) `?doctor=&branch=&service=&plan=&item=` pre-fill it and the booking is linked to the
 * planned item; from the follow-up list `?recall=` links it to the follow-up.
 */
export function NewAppointment({ clinicId, patientId, canOverride, prefill }: { clinicId: string; patientId?: string; canOverride: boolean; prefill?: Record<string, string> }) {
  const [patient, setPatient] = useState<Chosen | null>(null);
  const preset = usePatient(clinicId, patient ? undefined : patientId);
  const chosen: Chosen | null = patient ?? (preset.data ? { id: preset.data.id, name: preset.data.full_name, fileNo: preset.data.file_no, phone: preset.data.phone } : null);
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
  // ?date= from the appointments page: that day, unless it has passed
  const [date, setDate] = useState(() => (prefill?.date && /^\d{4}-\d{2}-\d{2}$/.test(prefill.date) && prefill.date > todayIso() ? prefill.date : todayIso()));
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
  const hourOf = (iso: string) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));

  const startsAt = override ? (time && /^\d{2}:\d{2}$/.test(time) ? new Date(zonedToUtc(date, time, tz)).toISOString() : '') : slot;
  const minutes = Number(duration);
  const ready = !!chosen && !!branch && !!doctor && !!startsAt && (!override || (reason.trim().length >= 3 && (!!service || (minutes >= 5 && minutes <= 480))));
  const dirty = !!(chosen || doctor || slot || time || notes);
  useUnsavedChanges(dirty, 'لديك تغييرات غير محفوظة. هل تريد المغادرة بدون حفظ؟');

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
        leave('تم حجز الموعد');
      },
    });
  };

  const crumbs = [{ label: 'المواعيد', route: to.list('appointments') }, { label: 'موعد جديد' }];
  const reset = () => { setSlot(''); book.reset(); };
  const pickDate = (d: string) => { setDate(d); reset(); };

  // the summary beside the form: what will be booked, and what is still missing
  const branchRow = activeBranches.find((b) => b.id === branch);
  const doctorRow = doctorsHere.find((d) => d.id === doctor);
  const length = override ? (service?.duration_minutes ?? (minutes || null)) : (slots.data?.durationMinutes ?? service?.duration_minutes ?? null);
  const price = service ? priceParts(service, fmtNumber) : null;
  const dayText = new Intl.DateTimeFormat(loc(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  const missing = [
    !chosen && 'المريض', !branch && 'الفرع', !doctor && 'الطبيب', !startsAt && 'الوقت',
    override && reason.trim().length < 3 && 'سبب الحجز خارج الجدول',
  ].filter(Boolean) as string[];

  const summary = (
    <Card className="appt-summary">
      <h2>ملخص الموعد</h2>
      <dl>
        <SummaryRow icon={UserRound} label="المريض" value={chosen && <bdi>{chosen.name}</bdi>} />
        <SummaryRow icon={MapPin} label="الفرع" value={branchRow && arName(branchRow.name_ar, branchRow.name_en, branchRow.slug)} />
        <SummaryRow icon={Stethoscope} label="الطبيب" value={doctorRow && arName(doctorRow.name_ar, doctorRow.name_en)} />
        <SummaryRow icon={Tag} label="الخدمة" value={service ? arName(service.name_ar, service.name_en) : 'بدون خدمة محددة'}
          sub={service && (price ? `${price} ${currencyLabel()}` : 'السعر حسب الكشف')} />
        <SummaryRow icon={CalendarDays} label="اليوم" value={dayText} />
        <SummaryRow icon={Clock} label="الوقت" value={startsAt && <bdi dir="ltr">{fmtTime(startsAt)}</bdi>}
          sub={startsAt && length ? `${fmtNumber(length)} ${'دقيقة'}` : undefined} />
      </dl>
      {override && startsAt && <Badge tone="warning" dot>خارج جدول الطبيب</Badge>}
      {missing.length > 0
        ? <p className="muted small appt-summary-missing">ينقص: {missing.join('، ')}</p>
        : <p className="small appt-summary-ready"><Check className="size-4" aria-hidden />جاهز للحجز</p>}
    </Card>
  );

  return (
    <FormPage title="موعد جديد" sub="اختر المريض والطبيب، ثم وقتًا من الأوقات المتاحة." crumbs={crumbs} back={to.list('appointments')}
      onSubmit={submit} saving={book.isPending} canSave={ready} error={book.error} saveLabel="حجز الموعد" aside={summary}>
      <Step n={1} title="المريض" done={!!chosen}>
        {chosen ? (
          <div className="appt-patient">
            <span className="avatar" aria-hidden>{initials(chosen.name)}</span>
            <div className="min-w-0">
              <strong><bdi>{chosen.name}</bdi></strong>
              {chosen.fileNo != null && <span className="muted small">#{chosen.fileNo}{chosen.phone && <> · <span dir="ltr">{chosen.phone}</span></>}</span>}
            </div>
            {/* dropping ?patient= from the URL too, so a reload does not bring the old choice back */}
            <Button variant="ghost" onClick={() => { setPatient(null); window.location.hash = '#/appointments/new'; }}>تغيير</Button>
          </div>
        ) : <PatientPicker clinicId={clinicId} onPick={(p) => setPatient({ id: p.id, name: p.full_name, fileNo: p.file_no, phone: p.phone })} />}
        {allergies.length > 0 && <Alert tone="danger"><AlertIcon size={16} /> <strong>الحساسية:</strong> <bdi>{allergies.join('، ')}</bdi></Alert>}
      </Step>

      <Step n={2} title="الفرع والطبيب والخدمة" done={!!branch && !!doctor}>
        <div className="grid-2">
          <Field label="الفرع">
            {(a) => <Choice id={a.id} value={branch} onChange={(v) => { setBranchId(v); setDoctorId((d) => ((doctors.data ?? []).some((x) => x.id === d && x.branch_ids.includes(v)) ? d : '')); reset(); }} placeholder="اختر الفرع"
              options={activeBranches.map((b) => ({ value: b.id, label: arName(b.name_ar, b.name_en, b.slug) }))} />}
          </Field>
          <Field label="الخدمة" optional="اختياري">
            {(a) => <Choice id={a.id} value={service?.id ?? ''} onChange={(v) => { setServiceId(v); reset(); }} noneLabel="بدون خدمة محددة"
              options={(services.data ?? []).filter((s) => s.is_active).map((s) => ({ value: s.id, label: `${arName(s.name_ar, s.name_en)} · ${s.duration_minutes} ${'دقيقة'}` }))} />}
          </Field>
        </div>
        <div className="field">
          <span className="field-label" id="appt-doctor-label">الطبيب</span>
          {!branch ? <p className="muted small">اختر الفرع أولًا.</p>
            : doctors.isLoading ? <p className="muted small" role="status">جارٍ التحميل…</p>
              : doctorsHere.length === 0 ? <p className="muted small">لا يوجد طبيب نشط في هذا الفرع.</p>
                : (
                  <div className="appt-doctors" role="radiogroup" aria-labelledby="appt-doctor-label">
                    {doctorsHere.map((d) => <DoctorOption key={d.id} d={d} on={doctor === d.id} onPick={() => { setDoctorId(d.id); reset(); }} />)}
                  </div>
                )}
        </div>
      </Step>

      <Step n={3} title="اليوم والوقت" done={!!startsAt && (!override || reason.trim().length >= 3)}
        action={canOverride && <Switch checked={override} onChange={(v) => { setOverride(v); reset(); }} label="خارج جدول الطبيب" />}>
        <div className="appt-day">
          <Field label="التاريخ">
            {(a) => <DatePicker id={a.id} value={date} onChange={pickDate} min={todayIso()} />}
          </Field>
          <div className="seg" role="group" aria-label="اختصار التاريخ">
            {[{ d: todayIso(), label: 'اليوم' }, { d: tomorrowIso(), label: 'غدًا' }].map((x) => (
              <button key={x.label} type="button" aria-pressed={date === x.d} className={`seg-btn${date === x.d ? ' is-on' : ''}`} onClick={() => pickDate(x.d)}>{x.label}</button>
            ))}
          </div>
        </div>
        {override ? (
          <div className="grid-2">
            <Field label="الوقت" hint={'بتوقيت الفرع ({tz})'.replace('{tz}', tz)}>{(a) => <TimeField id={a.id} describedBy={a.describedBy} value={time} onChange={setTime} />}</Field>
            {!service && <Field label="المدة (بالدقائق)">{(a) => <Input id={a.id} type="number" dir="ltr" min={5} max={480} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />}</Field>}
            <Field label="سبب الحجز خارج الجدول" hint="يُحفظ مع الموعد للمراجعة.">{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
          </div>
        ) : !doctor ? <p className="appt-slots-note muted small">اختر الطبيب لعرض الأوقات المتاحة.</p>
          : slots.isLoading ? <p className="appt-slots-note muted small" role="status">جارٍ التحميل…</p>
            : slots.isError ? <p className="field-error">تعذّر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.</p>
              : !slots.data?.slots.length ? <p className="appt-slots-note muted small">لا توجد أوقات متاحة في هذا اليوم. جرّب يومًا آخر.</p>
                : (
                  <div className="appt-slots" role="radiogroup" aria-label="الوقت">
                    {PERIODS.map((p) => {
                      const here = slots.data.slots.filter((s) => { const h = hourOf(s); return h >= p.from && h < p.to; });
                      if (!here.length) return null;
                      return (
                        <div key={p.label} className="appt-period">
                          <h3>{p.label} <span className="muted">· {fmtNumber(here.length)}</span></h3>
                          <div className="slot-grid">
                            {here.map((s) => (
                              <button key={s} type="button" role="radio" aria-checked={slot === s} className={`slot-btn${slot === s ? ' is-on' : ''}`} onClick={() => setSlot(s)}>
                                <bdi dir="ltr">{fmtTime(s)}</bdi>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
      </Step>

      <Step n={4} title="تفاصيل الحجز">
        <div className="field">
          <span className="field-label" id="appt-source-label">طريقة الحجز</span>
          <div className="seg appt-sources" role="radiogroup" aria-labelledby="appt-source-label">
            {SOURCES.map((s) => {
              const Icon = SOURCE_ICON[s];
              return (
                <button key={s} type="button" role="radio" aria-checked={source === s} className={`seg-btn${source === s ? ' is-on' : ''}`} onClick={() => setSource(s)}>
                  <Icon className="size-4" aria-hidden />{appointmentSourceLabel[s]}
                </button>
              );
            })}
          </div>
        </div>
        <Field label="ملاحظات داخلية" optional="اختياري" hint="لا يراها المريض.">
          {(a) => <TextArea id={a.id} describedBy={a.describedBy} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}
        </Field>
      </Step>
    </FormPage>
  );
}

/** One numbered part of the booking; the number turns into a check once the part is filled. */
function Step({ n, title, done, action, children }: { n: number; title: string; done?: boolean; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="appt-step">
      <div className="appt-step-head">
        <span className={`appt-step-num${done ? ' is-done' : ''}`} aria-hidden>{done ? <Check className="size-4" /> : fmtNumber(n)}</span>
        <h2>{title}</h2>
        {action && <div className="appt-step-action">{action}</div>}
      </div>
      {children}
    </Card>
  );
}

function SummaryRow({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="appt-summary-row">
      <dt><Icon className="size-4" aria-hidden />{label}</dt>
      <dd>{value ? <>{value}{sub && <span className="muted small">{sub}</span>}</> : <span className="faint">—</span>}</dd>
    </div>
  );
}

function DoctorOption({ d, on, onPick }: { d: Doctor; on: boolean; onPick: () => void }) {
  const name = arName(d.name_ar, d.name_en);
  return (
    <button type="button" role="radio" aria-checked={on} className={`appt-doctor${on ? ' is-on' : ''}`} onClick={onPick}>
      {d.photo ? <img className="avatar avatar-photo" src={d.photo.thumbUrl} alt="" width={36} height={36} loading="lazy" /> : <span className="avatar" aria-hidden>{initials(name)}</span>}
      <span className="min-w-0">
        <strong><bdi>{name}</bdi></strong>
        {d.title_ar && <span className="muted small">{d.title_ar}</span>}
      </span>
      {on && <Check className="appt-doctor-check size-4" aria-hidden />}
    </button>
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
    <div className="stack">
      <div className="appt-patient-search">
        <div className="appt-search">
          <Search className="size-4" aria-hidden />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="الاسم أو رقم الموبايل أو رقم الملف" aria-label="بحث عن مريض" autoFocus />
        </div>
        {canAdd && <Button variant="secondary" onClick={() => { window.location.hash = '#/patients/new'; }}><UserPlus className="size-4" />مريض جديد</Button>}
      </div>
      {search && (
        <ul className="pick-list" aria-busy={found.isFetching || undefined}>
          {rows.map((p) => (
            <li key={p.id}><button type="button" className="pick-item appt-pick" onClick={() => onPick(p)} disabled={p.is_blocked}>
              <span className="avatar" aria-hidden>{initials(p.full_name)}</span>
              <span className="min-w-0">
                <strong><bdi>{p.full_name}</bdi></strong>
                <span className="muted small">#{p.file_no} · <span dir="ltr">{p.phone}</span></span>
              </span>
              {p.is_blocked && <Badge tone="danger" dot>محظور</Badge>}
            </button></li>
          ))}
          {!found.isFetching && rows.length === 0 && <li className="muted small">لا يوجد مريض مطابق</li>}
        </ul>
      )}
    </div>
  );
}
