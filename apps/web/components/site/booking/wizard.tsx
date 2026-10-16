'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toAsciiDigits } from '@dental/ui/text';
import { Icon } from '../../icons';
import { BOOKING_ERRORS, todayIn, type BookingOptions, type BookingSummary, type DetailsOutcome, type Hold, type SlotsResponse } from '../../../lib/booking';
import { ar, arNoun, DAYS_AR, NOUNS, priceText } from '../../../lib/site';

type Step = 'choose' | 'time' | 'details' | 'otp' | 'done';
const ANY = 'any';

class BookingError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Same-origin calls; the proxy route adds the clinic hostname. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/booking/${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  } catch {
    throw new BookingError('network', BOOKING_ERRORS.network);
  }
  if (!res.ok) {
    const p = (await res.json().catch(() => ({}))) as { code?: string; detail?: string; title?: string };
    const code = p.code ?? 'error';
    throw new BookingError(code, BOOKING_ERRORS[code] ?? p.detail ?? p.title ?? 'حدث خطأ، حاول مرة أخرى.');
  }
  return res.json();
}

const fmtTime = (iso: string, tz: string) => new Intl.DateTimeFormat('ar-EG', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const fmtLong = (iso: string, tz: string) => new Intl.DateTimeFormat('ar-EG', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const dayLabel = (date: string) => { const d = new Date(`${date}T00:00:00Z`); return { weekday: DAYS_AR[d.getUTCDay()], day: d.getUTCDate(), month: new Intl.DateTimeFormat('ar-EG', { month: 'short', timeZone: 'UTC' }).format(d) }; };
const addDays = (date: string, n: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

const STEPS: { key: Step; label: string }[] = [{ key: 'choose', label: 'الخدمة' }, { key: 'time', label: 'الموعد' }, { key: 'details', label: 'بياناتك' }, { key: 'done', label: 'التأكيد' }];
const stepIndex = (s: Step) => (s === 'otp' ? 2 : STEPS.findIndex((x) => x.key === s));

/** `preset` comes from the page URL (?service= / ?doctor=): a card on the home page opens the wizard with that choice made. */
export function BookingWizard({ options, clinicName, preset = {} }: { options: BookingOptions; clinicName: string; preset?: { service?: string; doctor?: string } }) {
  const presetDoctor = options.doctors.find((d) => d.id === preset.doctor);
  const presetService = options.services.find((s) => s.id === preset.service);
  const [step, setStep] = useState<Step>('choose');
  const [branchId, setBranchId] = useState(presetDoctor?.branch_ids[0] ?? options.branches[0]?.id ?? '');
  const [serviceId, setServiceId] = useState(presetService?.id ?? '');
  const [doctorId, setDoctorId] = useState(presetDoctor?.id ?? ANY);
  const [date, setDate] = useState(options.dates.first);
  const [slots, setSlots] = useState<SlotsResponse | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [hold, setHold] = useState<Hold | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', notes: '' });
  const [maskedEmail, setMaskedEmail] = useState('');
  const [code, setCode] = useState('');
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const doctorsHere = useMemo(() => options.doctors.filter((d) => d.branch_ids.includes(branchId) && (!serviceId || d.service_ids.includes(serviceId))), [options.doctors, branchId, serviceId]);
  const service = options.services.find((s) => s.id === serviceId);
  const branch = options.branches.find((b) => b.id === branchId);
  /** the zone every time on screen is shown in: the one the server computed the slots in (branch, else clinic) */
  const tz = booking?.timezone ?? slots?.timezone ?? branch?.timezone ?? options.policy.timezone;
  // "today" in the zone the slots are computed in (the branch's), on this visitor's clock: the options may be cached
  // from before midnight. Rendered first with the server's value so the HTML matches, then corrected after mount.
  const branchTz = branch?.timezone ?? options.policy.timezone;
  const [firstDate, setFirstDate] = useState(options.dates.first);
  useEffect(() => { setFirstDate(todayIn(branchTz)); }, [branchTz]);
  useEffect(() => { if (date < firstDate) setDate(firstDate); }, [date, firstDate]);
  const dates = useMemo(() => Array.from({ length: Math.min(options.policy.maxDaysAhead + 1, 21) }, (_, i) => addDays(firstDate, i)), [options.policy.maxDaysAhead, firstDate]);

  const fail = (e: unknown) => { setError(e instanceof Error ? e.message : 'حدث خطأ، حاول مرة أخرى.'); setTimeout(() => errorRef.current?.focus(), 0); };

  const loadSlots = useCallback(async (d: string) => {
    if (!serviceId || !branchId) return;
    setLoadingSlots(true); setError(null);
    try {
      const q = new URLSearchParams({ branchId, serviceId, date: d, ...(doctorId !== ANY && { doctorId }) });
      setSlots(await call<SlotsResponse>(`slots?${q}`));
    } catch (e) { setSlots(null); fail(e); } finally { setLoadingSlots(false); }
  }, [branchId, serviceId, doctorId]);

  useEffect(() => { if (step === 'time') void loadSlots(date); }, [step, date, loadSlots]);

  // the hold is 10 minutes; when it runs out the visitor picks a time again
  useEffect(() => {
    if (!hold || step === 'done') return;
    const tick = () => {
      const left = Math.max(0, Math.round((new Date(hold.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) { setHold(null); setStep('time'); setError(BOOKING_ERRORS.hold_expired); }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [hold, step]);

  /** Frees a hold the visitor walked away from, at once instead of after 10 minutes. Best effort: errors are ignored. */
  /**
   * Frees a hold the visitor walked away from, at once instead of after 10 minutes. Best effort (errors ignored),
   * but awaited by callers that reload the times next — otherwise the reload can still see the slot as held.
   */
  const release = async (h: Hold | null): Promise<void> => {
    if (!h) return;
    await fetch(`/api/booking/holds/${h.holdId}/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', keepalive: true }).catch(() => undefined);
  };
  // leaving or closing the page while a slot is held releases it (sendBeacon survives the unload)
  useEffect(() => {
    if (!hold || step === 'done') return;
    const onHide = () => navigator.sendBeacon(`/api/booking/holds/${hold.holdId}/release`, new Blob(['{}'], { type: 'application/json' }));
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [hold, step]);
  const backToTimes = async () => {
    setBusy(true);
    await release(hold);
    setHold(null); setBusy(false); setStep('time'); // the times reload after the release, so the freed slot is offered again
  };

  const pickSlot = async (startsAt: string) => {
    setBusy(true); setError(null);
    if (hold) { await release(hold); setHold(null); } // one hold per visitor: picking again frees the previous slot first
    try {
      const h = await call<Hold>('holds', { method: 'POST', body: JSON.stringify({ branchId, serviceId, startsAt, ...(doctorId !== ANY && { doctorId }) }) });
      setHold(h); setStep('details');
    } catch (e) { fail(e); void loadSlots(date); } finally { setBusy(false); }
  };

  const submitDetails = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!hold) return;
    setBusy(true); setError(null);
    try {
      const out = await call<DetailsOutcome>(`holds/${hold.holdId}/details`, { method: 'POST', body: JSON.stringify({ fullName: form.fullName.trim(), phone: toAsciiDigits(form.phone), email: form.email.trim(), notes: form.notes.trim() || undefined }) });
      if (out.status === 'booked') { setBooking(out.booking); setStep('done'); } else { setMaskedEmail(out.maskedEmail); setCode(''); setStep('otp'); }
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const confirm = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!hold) return;
    setBusy(true); setError(null);
    try {
      const b = await call<BookingSummary>(`holds/${hold.holdId}/confirm`, { method: 'POST', body: JSON.stringify({ code: toAsciiDigits(code) }) });
      setBooking(b); setStep('done');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const canBook = options.branches.length > 0 && options.services.length > 0 && options.doctors.length > 0;
  if (!canBook) return <p className="bk-empty">الحجز عبر الموقع غير متاح حاليًا. تواصل مع العيادة مباشرة لحجز موعدك.</p>;

  return (
    <div className="bk">
      <ol className="bk-steps" aria-label="خطوات الحجز">
        {STEPS.map((s, i) => <li key={s.key} className={i === stepIndex(step) ? 'is-current' : i < stepIndex(step) ? 'is-done' : ''} aria-current={i === stepIndex(step) ? 'step' : undefined}><span>{i + 1}</span>{s.label}</li>)}
      </ol>
      {error && <p ref={errorRef} tabIndex={-1} className="bk-error" role="alert">{error}</p>}

      {step === 'choose' && (
        <section className="bk-card" aria-labelledby="bk-choose">
          <h2 id="bk-choose">ماذا تحتاج؟</h2>
          {options.branches.length > 1 && (
            <fieldset className="bk-group"><legend>الفرع</legend>
              <div className="bk-options">
                {options.branches.map((b) => <button key={b.id} type="button" className="bk-opt" aria-pressed={branchId === b.id} onClick={() => { setBranchId(b.id); setDoctorId(ANY); }}><strong><bdi>{ar(b.name_ar, b.name_en)}</bdi></strong>{(b.address_ar || b.city) && <span>{[ar(b.address_ar, b.address_en), b.city].filter(Boolean).join('، ')}</span>}</button>)}
              </div>
            </fieldset>
          )}
          <fieldset className="bk-group"><legend>الخدمة</legend>
            <div className="bk-options">
              {options.services.map((s) => <button key={s.id} type="button" className="bk-opt" aria-pressed={serviceId === s.id} onClick={() => { setServiceId(s.id); setDoctorId(ANY); }}><strong><bdi>{ar(s.name_ar, s.name_en)}</bdi></strong><span>{priceText(s.price_minor, s.price_max_minor)} · {s.duration_minutes} {arNoun(s.duration_minutes, NOUNS.minute)}</span></button>)}
            </div>
          </fieldset>
          {serviceId && (
            <fieldset className="bk-group"><legend>الطبيب</legend>
              <div className="bk-options bk-options-compact">
                <button type="button" className="bk-opt" aria-pressed={doctorId === ANY} onClick={() => setDoctorId(ANY)}><strong>أي طبيب متاح</strong><span>أقرب موعد</span></button>
                {doctorsHere.map((d) => <button key={d.id} type="button" className="bk-opt" aria-pressed={doctorId === d.id} onClick={() => setDoctorId(d.id)}><strong><bdi>{ar(d.name_ar, d.name_en)}</bdi></strong>{ar(d.title_ar, d.title_en) && <span>{ar(d.title_ar, d.title_en)}</span>}</button>)}
              </div>
              {doctorsHere.length === 0 && <p className="bk-hint">لا يوجد طبيب يقدم هذه الخدمة في هذا الفرع. جرّب فرعًا آخر.</p>}
            </fieldset>
          )}
          <div className="bk-actions">
            <button type="button" className="s-btn s-btn-lg" disabled={!serviceId || doctorsHere.length === 0} onClick={() => setStep('time')}>اختيار الموعد<Icon name="chevronDown" size={16} className="bk-arrow" /></button>
          </div>
        </section>
      )}

      {step === 'time' && (
        <section className="bk-card" aria-labelledby="bk-time">
          <h2 id="bk-time">اختر اليوم والوقت</h2>
          <p className="bk-summary"><bdi>{ar(service?.name_ar, service?.name_en)}</bdi> · {doctorId === ANY ? 'أي طبيب' : <bdi>{ar(doctorsHere.find((d) => d.id === doctorId)?.name_ar, doctorsHere.find((d) => d.id === doctorId)?.name_en)}</bdi>} · <bdi>{ar(branch?.name_ar, branch?.name_en)}</bdi> <button type="button" className="bk-link" onClick={() => setStep('choose')}>تغيير</button></p>
          <div className="bk-dates" role="radiogroup" aria-label="اليوم">
            {dates.map((d) => { const l = dayLabel(d); return <button key={d} type="button" role="radio" aria-checked={date === d} className="bk-date" onClick={() => setDate(d)}><span>{l.weekday}</span><strong>{l.day}</strong><span>{l.month}</span></button>; })}
          </div>
          <div className="bk-slots" aria-live="polite" aria-busy={loadingSlots}>
            {loadingSlots ? <p className="bk-hint">جارٍ تحميل المواعيد…</p>
              : !slots || slots.slots.length === 0 ? <p className="bk-hint">لا توجد مواعيد متاحة في هذا اليوم، جرّب يومًا آخر.</p>
                : slots.slots.map((s) => <button key={s.startsAt} type="button" className="bk-slot" disabled={busy} onClick={() => void pickSlot(s.startsAt)}><bdi dir="ltr">{fmtTime(s.startsAt, tz)}</bdi></button>)}
          </div>
        </section>
      )}

      {(step === 'details' || step === 'otp') && hold && (
        <section className="bk-card" aria-labelledby="bk-details">
          <div className="bk-hold" role="status">
            <Icon name="clock" size={16} />
            <span>محجوز لك مؤقتًا: <strong>{fmtLong(hold.startsAt, tz)}</strong></span>
            <span className="bk-timer"><bdi dir="ltr">{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</bdi></span>
          </div>
          {step === 'details' ? (
            <form onSubmit={submitDetails} className="bk-form" noValidate>
              <h2 id="bk-details">بياناتك</h2>
              <label>الاسم الكامل<input required minLength={2} maxLength={120} autoComplete="name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>
              <label>رقم الموبايل<input required type="tel" inputMode="tel" dir="ltr" autoComplete="tel" placeholder="01012345678" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              <label>البريد الإلكتروني<input required type="email" inputMode="email" dir="ltr" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label>ملاحظات <span className="bk-optional">(اختياري)</span><textarea rows={2} maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
              <p className="bk-hint">{options.policy.otpRequired ? 'سنرسل رمز تحقق إلى بريدك الإلكتروني لتأكيد الحجز.' : 'سيصلك تأكيد الحجز ورمز الحضور على بريدك الإلكتروني.'}</p>
              <div className="bk-actions">
                <button type="button" className="s-btn s-btn-ghost" onClick={() => void backToTimes()} disabled={busy}>رجوع</button>
                <button type="submit" className="s-btn s-btn-lg" disabled={busy || form.fullName.trim().length < 2 || form.phone.trim().length < 8 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())}>{busy ? 'لحظة…' : options.policy.otpRequired ? 'إرسال رمز التحقق' : 'تأكيد الحجز'}</button>
              </div>
            </form>
          ) : (
            <form onSubmit={confirm} className="bk-form" noValidate>
              <h2 id="bk-details">أدخل رمز التحقق</h2>
              <p className="bk-hint">أرسلنا رمزًا من 6 أرقام إلى <bdi dir="ltr">{maskedEmail}</bdi>. تحقق من صندوق الوارد أو الرسائل غير المرغوبة.</p>
              <label className="sr-only" htmlFor="bk-code">الرمز</label>
              <input id="bk-code" className="bk-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
              <div className="bk-actions">
                <button type="button" className="s-btn s-btn-ghost" disabled={busy} onClick={(e) => void submitDetails(e)}>إعادة إرسال الرمز</button>
                <button type="submit" className="s-btn s-btn-lg" disabled={busy || toAsciiDigits(code).length !== 6}>{busy ? 'لحظة…' : 'تأكيد الحجز'}</button>
              </div>
            </form>
          )}
        </section>
      )}

      {step === 'done' && booking && (
        <section className="bk-card bk-done" aria-labelledby="bk-done">
          <span className="bk-check"><Icon name="check" size={28} /></span>
          <h2 id="bk-done">{booking.status === 'confirmed' ? 'تم تأكيد موعدك' : 'تم استلام طلب الحجز'}</h2>
          <p className="bk-hint">{booking.status === 'confirmed' ? 'نراك قريبًا في' : 'ستتصل بك العيادة للتأكيد. الموعد المطلوب:'} <strong><bdi>{clinicName}</bdi></strong></p>
          <dl className="bk-recap">
            <div><dt>الموعد</dt><dd>{fmtLong(booking.startsAt, tz)}</dd></div>
            <div><dt>الطبيب</dt><dd><bdi>{ar(booking.appointment.doctor.name_ar, booking.appointment.doctor.name_en)}</bdi></dd></div>
            {booking.appointment.service && <div><dt>الخدمة</dt><dd><bdi>{ar(booking.appointment.service.name_ar, booking.appointment.service.name_en)}</bdi></dd></div>}
            <div><dt>الفرع</dt><dd><bdi>{ar(branch?.name_ar, branch?.name_en)}</bdi></dd></div>
          </dl>
          <div className="bk-code-box">
            <span>رمز الحضور، أظهره في الاستقبال</span>
            <strong dir="ltr">{booking.code}</strong>
            <span className="bk-optional">أرسلناه أيضًا إلى بريدك الإلكتروني</span>
          </div>
          <div className="bk-actions"><a className="s-btn s-btn-ghost" href="/">العودة إلى الموقع</a></div>
        </section>
      )}
    </div>
  );
}
