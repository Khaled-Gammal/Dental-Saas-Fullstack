'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { telHref } from '@dental/ui/text';
import { Icon, Phone } from '../../icons';
import { todayIn } from '../../../lib/booking';
import { blockText, MANAGE_ERRORS, pickerDates, STATUS_TEXT, type ManageSlots, type ManageView } from '../../../lib/manage';
import { DAYS_AR } from '../../../lib/site';

class ManageError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Same-origin calls; the proxy route adds the clinic's hostname. */
async function call<T>(action: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/appointment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  } catch {
    throw new ManageError('network', MANAGE_ERRORS.network);
  }
  if (!res.ok) {
    const p = (await res.json().catch(() => ({}))) as { code?: string };
    const code = p.code ?? 'error';
    // never the server's English text (L10N-003): our words for the code, else a plain Arabic message
    throw new ManageError(code, MANAGE_ERRORS[code] ?? (res.status === 429 ? MANAGE_ERRORS.rate_limited : 'حدث خطأ، حاول مرة أخرى.'));
  }
  return res.json();
}

// Arabic with Latin digits and a 12-hour clock (CLR-08), in the branch's zone
const fmtTime = (iso: string, tz: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
const fmtLong = (iso: string, tz: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
const dayLabel = (date: string) => { const d = new Date(`${date}T00:00:00Z`); return { weekday: DAYS_AR[d.getUTCDay()], day: d.getUTCDate(), month: new Intl.DateTimeFormat('ar-EG-u-nu-latn', { month: 'short', timeZone: 'UTC' }).format(d) }; };

type Mode = 'view' | 'confirmCancel' | 'pick' | 'confirmMove';
type Done = 'cancelled' | 'moved' | null;

/**
 * Phase 2E: the patient's booking with what they may still do: cancel it (asked twice), or pick another time with the
 * same doctor (a date strip and the free times, then a confirmation). When a change is no longer allowed, says why
 * and offers the clinic's phone.
 */
export function ManageAppointment({ token, initial, bookUrl }: { token: string; initial: ManageView; /** the site's booking wizard, when it has one */ bookUrl?: string | null }) {
  const [view, setView] = useState(initial);
  const [mode, setMode] = useState<Mode>('view');
  const [done, setDone] = useState<Done>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const tz = view.timezone;
  // "today" on this visitor's clock in the branch's zone (the page may have been open since yesterday)
  const [first, setFirst] = useState(view.dates.first);
  useEffect(() => { const t = todayIn(tz); setFirst(t > view.dates.first ? t : view.dates.first); }, [tz, view.dates.first]);
  const dates = useMemo(() => pickerDates(first, view.dates.last), [first, view.dates.last]);
  const [date, setDate] = useState(view.dates.first);
  const [slots, setSlots] = useState<ManageSlots | null>(null);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const tel = telHref(view.clinic.phone);

  const fail = (e: unknown) => { setError(e instanceof Error ? e.message : 'حدث خطأ، حاول مرة أخرى.'); setTimeout(() => errorRef.current?.focus(), 0); };
  /** after a refusal the booking may have changed (another tab, the clinic): show it as it is now */
  const refresh = async () => { try { setView(await call<ManageView>('view', { token })); } catch { /* keep what is shown */ } };

  const loadSlots = useCallback(async (d: string) => {
    setLoading(true); setError(null);
    try { setSlots(await call<ManageSlots>('slots', { token, date: d })); } catch (e) { setSlots(null); fail(e); } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { if (mode === 'pick') void loadSlots(date); }, [mode, date, loadSlots]);
  useEffect(() => { if (date < first) setDate(first); }, [date, first]);

  const cancel = async () => {
    setBusy(true); setError(null);
    try { setView(await call<ManageView>('cancel', { token })); setDone('cancelled'); setMode('view'); } catch (e) { fail(e); setMode('view'); void refresh(); } finally { setBusy(false); }
  };
  const move = async () => {
    if (!chosen) return;
    setBusy(true); setError(null);
    try { setView(await call<ManageView>('reschedule', { token, startsAt: chosen })); setDone('moved'); setMode('view'); setChosen(null); }
    catch (e) {
      fail(e);
      const code = e instanceof ManageError ? e.code : '';
      if (code === 'slot_unavailable' || code === 'slot_taken') { setMode('pick'); void loadSlots(date); } else { setMode('view'); void refresh(); }
    } finally { setBusy(false); }
  };

  const active = view.status === 'pending' || view.status === 'confirmed';
  const cancelWhy = blockText(view.cancel.block, 'cancel');
  const moveWhy = view.cancel.allowed ? blockText(view.reschedule.block, 'reschedule') : null; // one reason is enough
  const until = fmtLong(view.changeUntil, tz);

  return (
    <div className="bk">
      {error && <p ref={errorRef} tabIndex={-1} className="bk-error" role="alert">{error}</p>}

      {done && (
        <section className="bk-card bk-done" aria-live="polite">
          <span className="bk-check"><Icon name="check" size={28} /></span>
          <h2>{done === 'cancelled' ? 'تم إلغاء موعدك' : 'تم تغيير موعدك'}</h2>
          <p className="bk-hint">
            {done === 'cancelled' ? 'أرسلنا لك تأكيد الإلغاء على بريدك الإلكتروني، وأبلغنا العيادة.'
              : view.status === 'pending' ? 'أبلغنا العيادة، وستؤكد الموعد الجديد قريبًا. أرسلنا لك التفاصيل على بريدك الإلكتروني.'
                : 'أرسلنا لك تفاصيل الموعد الجديد على بريدك الإلكتروني.'}
          </p>
          {done === 'cancelled' && bookUrl && <a className="s-btn s-btn-ghost" href={bookUrl}>حجز موعد جديد</a>}
        </section>
      )}

      {mode !== 'pick' && (
        <section className="bk-card" aria-labelledby="mg-title">
          <h2 id="mg-title">{view.patientFirstName ? <>مرحبًا <bdi>{view.patientFirstName}</bdi>،</> : 'تفاصيل الموعد'}</h2>
          <dl className="bk-recap">
            <div><dt>الحالة</dt><dd>{STATUS_TEXT[view.status] ?? '—'}</dd></div>
            <div><dt>الموعد</dt><dd>{fmtLong(view.startsAt, tz)}</dd></div>
            {view.doctor && <div><dt>الطبيب</dt><dd><bdi>{view.doctor}</bdi></dd></div>}
            {view.service && <div><dt>الخدمة</dt><dd><bdi>{view.service}</bdi></dd></div>}
            {view.branch.name && <div><dt>الفرع</dt><dd><bdi>{view.branch.name}</bdi>{view.branch.address && <span className="bk-optional"> — <bdi>{view.branch.address}</bdi></span>}</dd></div>}
          </dl>

          {mode === 'confirmCancel' ? (
            <div className="bk-form" role="group" aria-labelledby="mg-cancel-q">
              <p id="mg-cancel-q"><strong>هل تريد إلغاء هذا الموعد؟</strong> سيصبح الوقت متاحًا لمريض آخر.</p>
              <div className="bk-actions">
                <button type="button" className="s-btn s-btn-ghost" disabled={busy} onClick={() => setMode('view')}>رجوع</button>
                <button type="button" className="s-btn" disabled={busy} onClick={() => void cancel()}>{busy ? 'لحظة…' : 'نعم، ألغِ الموعد'}</button>
              </div>
            </div>
          ) : mode === 'confirmMove' && chosen ? (
            <div className="bk-form" role="group" aria-labelledby="mg-move-q">
              <p id="mg-move-q"><strong>تغيير الموعد إلى {fmtLong(chosen, tz)}؟</strong>{view.status === 'confirmed' && ' قد تحتاج العيادة إلى تأكيد الموعد الجديد.'}</p>
              <div className="bk-actions">
                <button type="button" className="s-btn s-btn-ghost" disabled={busy} onClick={() => setMode('pick')}>اختيار وقت آخر</button>
                <button type="button" className="s-btn" disabled={busy} onClick={() => void move()}>{busy ? 'لحظة…' : 'تأكيد الموعد الجديد'}</button>
              </div>
            </div>
          ) : active && (view.cancel.allowed || view.reschedule.allowed) ? (
            <>
              <p className="bk-hint">يمكنك الإلغاء أو التغيير حتى {until}.{view.reschedule.allowed && view.reschedule.left === 1 && ' يمكنك تغيير الموعد مرة واحدة أخرى من هنا.'}</p>
              {moveWhy && <p className="bk-hint">{moveWhy}</p>}
              <div className="bk-actions">
                {view.cancel.allowed && <button type="button" className="s-btn s-btn-ghost" onClick={() => { setError(null); setMode('confirmCancel'); }}>إلغاء الموعد</button>}
                {view.reschedule.allowed && <button type="button" className="s-btn" onClick={() => { setError(null); setChosen(null); setMode('pick'); }}><Icon name="calendar" size={16} />تغيير الموعد</button>}
              </div>
            </>
          ) : (
            cancelWhy && <p className="bk-hint">{cancelWhy}</p>
          )}
          {(!view.cancel.allowed || !view.reschedule.allowed) && active && tel && (
            <div className="bk-actions"><a className="s-btn s-btn-ghost" href={tel}><Phone />اتصل بالعيادة</a></div>
          )}
        </section>
      )}

      {mode === 'pick' && (
        <section className="bk-card" aria-labelledby="mg-pick">
          <h2 id="mg-pick">اختر الموعد الجديد</h2>
          <p className="bk-summary">الموعد الحالي: {fmtLong(view.startsAt, tz)}{view.doctor && <> · <bdi>{view.doctor}</bdi></>} <button type="button" className="bk-link" onClick={() => setMode('view')}>رجوع</button></p>
          <div className="bk-dates" role="radiogroup" aria-label="اليوم">
            {dates.map((d) => { const l = dayLabel(d); return <button key={d} type="button" role="radio" aria-checked={date === d} className="bk-date" onClick={() => setDate(d)}><span>{l.weekday}</span><strong>{l.day}</strong><span>{l.month}</span></button>; })}
          </div>
          <div className="bk-slots" aria-live="polite" aria-busy={loading}>
            {loading ? <p className="bk-hint">جارٍ تحميل المواعيد…</p>
              : !slots || slots.slots.length === 0 ? <p className="bk-hint">لا توجد مواعيد متاحة في هذا اليوم، جرّب يومًا آخر.</p>
                : slots.slots.map((s) => (
                  <button key={s.startsAt} type="button" className="bk-slot" disabled={busy || s.startsAt === view.startsAt}
                    onClick={() => { setChosen(s.startsAt); setMode('confirmMove'); }}><bdi dir="ltr">{fmtTime(s.startsAt, tz)}</bdi></button>
                ))}
          </div>
        </section>
      )}
    </div>
  );
}
