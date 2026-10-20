'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons';
import { EMPTY_LEAD, leadBody, leadError, leadProblems, type LeadForm, type PublicPlan } from '../../lib/landing';
import { PICK_PLAN_EVENT } from './pricing';

type State = { kind: 'editing' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'failed'; message: string };
type Problems = Partial<Record<keyof LeadForm, string>>;

/**
 * LND-04: a clinic asks for a call. Sent to this site's own /api/leads (same origin), which passes it on to the API with
 * the visitor's address for its throttle. `website` is a honeypot: hidden from people, filled in only by bots.
 */
export function LeadFormCard({ plans, privacyUrl }: { plans: PublicPlan[]; privacyUrl: string }) {
  const [form, setForm] = useState<LeadForm>(EMPTY_LEAD);
  const [shown, setShown] = useState<Problems>({});
  const [state, setState] = useState<State>({ kind: 'editing' });
  const status = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPick = (e: Event) => {
      const code = (e as CustomEvent<string>).detail;
      if (plans.some((p) => p.code === code)) setForm((f) => ({ ...f, planCode: code }));
    };
    window.addEventListener(PICK_PLAN_EVENT, onPick);
    return () => window.removeEventListener(PICK_PLAN_EVENT, onPick);
  }, [plans]);
  useEffect(() => { if (state.kind === 'sent' || state.kind === 'failed') status.current?.focus(); }, [state.kind]);

  const set = (k: keyof LeadForm) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (shown[k]) setShown((s) => ({ ...s, [k]: undefined }));
  };

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    const problems = leadProblems(form);
    setShown(problems);
    const first = Object.keys(problems)[0];
    if (first) {
      document.getElementById(`lead-${first}`)?.focus();
      return;
    }
    setState({ kind: 'sending' });
    try {
      const res = await fetch('/api/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(leadBody(form)) });
      if (res.ok) {
        setState({ kind: 'sent' });
        return;
      }
      const err = (await res.json().catch(() => ({}))) as { code?: string };
      setState({ kind: 'failed', message: leadError(err.code) });
    } catch {
      setState({ kind: 'failed', message: leadError(undefined) });
    }
  }

  if (state.kind === 'sent') {
    return (
      <div className="bk-card bk-done l-sent" ref={status} tabIndex={-1} role="status">
        <span className="bk-check"><Icon name="check" size={32} /></span>
        <h3>وصل طلبك</h3>
        <p className="s-muted">سنتصل بك على الرقم <bdi dir="ltr">{form.phone.trim()}</bdi> لنتفق على موعد يناسبك.</p>
      </div>
    );
  }

  const attrs = (k: keyof LeadForm) => ({
    id: `lead-${k}`, name: k, value: form[k], onChange: set(k),
    'aria-invalid': shown[k] ? true : undefined, 'aria-describedby': shown[k] ? `lead-${k}-err` : undefined,
  });
  const field = (k: keyof LeadForm, label: string, input: ReactNode, optional = false) => (
    <label htmlFor={`lead-${k}`}>
      <span>{label}{optional && <span className="bk-optional"> (اختياري)</span>}</span>
      {input}
      {shown[k] && <span className="l-field-error" id={`lead-${k}-err`}>{shown[k]}</span>}
    </label>
  );

  return (
    <form className="bk-card bk-form l-form" onSubmit={submit} noValidate>
      {state.kind === 'failed' && <div className="bk-error" ref={status} tabIndex={-1} role="alert">{state.message}</div>}
      <div className="l-form-grid">
        {field('fullName', 'الاسم', <input {...attrs('fullName')} autoComplete="name" maxLength={120} required />)}
        {field('phone', 'رقم الموبايل', <input {...attrs('phone')} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" maxLength={30} required />)}
        {field('clinicName', 'اسم العيادة', <input {...attrs('clinicName')} autoComplete="organization" maxLength={150} />, true)}
        {field('city', 'المدينة', <input {...attrs('city')} autoComplete="address-level2" maxLength={80} />, true)}
        {field('email', 'البريد الإلكتروني', <input {...attrs('email')} type="email" autoComplete="email" dir="ltr" maxLength={254} />, true)}
        {plans.length > 0 && field('planCode', 'الباقة التي تهمك', (
          <select {...attrs('planCode')}>
            <option value="">لم أحدد بعد</option>
            {plans.map((p) => <option key={p.code} value={p.code}>{p.name_ar}</option>)}
          </select>
        ), true)}
      </div>
      {field('message', 'رسالتك', <textarea {...attrs('message')} rows={3} maxLength={2000} />, true)}
      <div className="l-hp" aria-hidden="true">
        <label htmlFor="lead-website">اترك هذا الحقل فارغًا</label>
        <input id="lead-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
      </div>
      <p className="bk-hint">بإرسال الطلب توافق على أن نتواصل معك بخصوص النظام، وفق <a href={privacyUrl} target="_blank" rel="noopener">سياسة الخصوصية</a>.</p>
      <div className="bk-actions">
        <button type="submit" className="s-btn s-btn-lg" disabled={state.kind === 'sending'}>
          {state.kind === 'sending' ? 'جارٍ الإرسال…' : 'أرسل الطلب'}
        </button>
      </div>
    </form>
  );
}
