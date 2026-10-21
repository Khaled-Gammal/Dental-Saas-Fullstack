import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, type ApiError, setSession, type Session } from '../api';
import { DEMO_PASSWORD, DEMO_USERS, ROOT_DOMAIN } from '../config';
import { Alert, Button, ErrorText, Field, Input, LinkButton, Logo, OtpInput, PasswordInput } from '../ui/components';
import { LegalConsent, useLegalDocs } from '../components/legal';
import { CalendarIcon, CheckIcon, GlobeIcon, PhoneIcon, ShieldIcon } from '../ui/icons';
import { DentalArch, SmileCanvas } from '../ui/illustrations';
import { useDebounced } from '../hooks';
import type { SubscribeIntent } from '../router';
import { passwordChecks, toAsciiDigits } from '../util';

/** Sign-up is confirmed by an email code (SRS AUTH-101; no SMS). */
export type AuthScreen = { name: 'login'; notice?: string } | { name: 'signup'; subscribe?: SubscribeIntent } | { name: 'verify'; email: string; maskedEmail: string; justSent: boolean }
  | { name: 'forgot' } | { name: 'reset'; email: string };

const RESEND_COOLDOWN_S = 30;

/** Split screen: brand story on one side, the form on the other. Collapses to the form alone on phones. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <Logo name="منصة الأسنان" light />
        <div className="auth-brand-body">
          <h1>موقع لعيادتك ونظام إدارة كامل في مكان واحد</h1>
          <ul className="auth-points">
            <li><span><GlobeIcon size={18} /></span>موقع احترافي باسم عيادتك خلال دقائق</li>
            <li><span><CalendarIcon size={18} /></span>حجوزات أونلاين مع كود تأكيد للاستقبال</li>
            <li><span><ShieldIcon size={18} /></span>بيانات كل عيادة معزولة ومحمية</li>
          </ul>
        </div>
        <SmileCanvas className="auth-canvas" />
        <DentalArch filled={14} className="auth-arch" />
      </aside>
      <div className="auth-main">
        <div className="auth-top">
          <span className="auth-mobile-logo"><Logo name="منصة الأسنان" /></span>
        </div>
        <div className="auth-form">{children}</div>
      </div>
    </div>
  );
}

export function Login({ go, notice }: { go: (s: AuthScreen) => void; notice?: string }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation<Session, ApiError>({
    mutationFn: () => api<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: identifier.trim(), password }) }),
    onSuccess: setSession,
    onError: (e) => {
      if (e.code === 'email_not_verified' && typeof e.body.email === 'string') {
        go({ name: 'verify', email: e.body.email, maskedEmail: String(e.body.maskedEmail ?? e.body.email), justSent: false });
      }
    },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); login.mutate(); };

  return (
    <>
      <header className="form-head">
        <h2>تسجيل الدخول</h2>
        <p>أهلًا بعودتك، سجّل الدخول لمتابعة عيادتك</p>
      </header>
      {notice && <Alert tone="success">{notice}</Alert>}
      <form onSubmit={submit} className="stack" noValidate={false}>
        <Field label="البريد الإلكتروني أو رقم الموبايل">
          {(a) => <Input id={a.id} describedBy={a.describedBy} value={identifier} onChange={(e) => setIdentifier(e.target.value)} dir="ltr" autoComplete="username" required autoFocus />}
        </Field>
        <Field label="كلمة المرور">
          {(a) => <PasswordInput id={a.id} describedBy={a.describedBy} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" required showLabel="إظهار كلمة المرور" hideLabel="إخفاء كلمة المرور" />}
        </Field>
        <ErrorText error={login.error} />
        <Button type="submit" block loading={login.isPending}>تسجيل الدخول</Button>
      </form>
      <p className="form-foot row-between">
        <LinkButton onClick={() => go({ name: 'signup' })}>عيادة جديدة؟ أنشئ حسابًا</LinkButton>
        <LinkButton onClick={() => go({ name: 'forgot' })}>نسيت كلمة المرور؟</LinkButton>
      </p>
      {import.meta.env.DEV && <DevQuickLogin />}
    </>
  );
}

function DevQuickLogin() {
  const [email, setEmail] = useState(DEMO_USERS[0]);
  const quick = useMutation({
    mutationFn: () => api<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: email, password: DEMO_PASSWORD }) }),
    onSuccess: setSession,
  });
  return (
    <details className="dev">
      <summary>دخول سريع (تطوير فقط)</summary>
      <div className="dev-row">
        <select className="input" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" aria-label="الحساب التجريبي">
          {DEMO_USERS.map((u) => <option key={u}>{u}</option>)}
        </select>
        <Button variant="secondary" onClick={() => quick.mutate()} loading={quick.isPending}>تسجيل الدخول</Button>
      </div>
      <ErrorText error={quick.error} />
    </details>
  );
}

/** H7 «اشترك الآن»: the plan's Arabic name, read from the public plans (the link carries only its code). */
function SubscribeNotice({ intent }: { intent: SubscribeIntent }) {
  const plans = useQuery({ queryKey: ['public-plans'], queryFn: () => api<{ code: string; name_ar: string }[]>('/public/plans'), staleTime: 300_000 });
  const name = plans.data?.find((p) => p.code === intent.planCode)?.name_ar;
  if (plans.isLoading) return null;
  return (
    <Alert tone="info">
      {'اخترت الاشتراك في باقة «{plan}» بدفع {cycle}. أنشئ حساب عيادتك الآن وابدأ العمل فورًا، وسنتواصل معك لإتمام الدفع وتفعيل الاشتراك.'.replace('{plan}', name ?? intent.planCode).replace('{cycle}', intent.cycle === 'yearly' ? 'سنوي' : 'شهري')}
    </Alert>
  );
}

export function Signup({ go, subscribe }: { go: (s: AuthScreen) => void; subscribe?: SubscribeIntent }) {
  const [f, setF] = useState({ fullName: '', email: '', phone: '', password: '', clinicNameAr: '', slug: '' });
  type Form = typeof f;
  // functional update: never reads a stale `f`; `clean` lets a field normalise its value (e.g. the slug)
  const set = (k: keyof Form, clean: (v: string) => string = (v) => v) =>
    (e: { target: { value: string } }) => { const v = clean(e.target.value); setF((prev) => ({ ...prev, [k]: v })); };

  const typedSlug = f.slug.trim().toLowerCase();
  const slug = useDebounced(typedSlug, 300); // one check after typing stops, not one per key
  const slugCheck = useQuery({
    queryKey: ['slug', slug],
    queryFn: () => api<{ available: boolean }>(`/auth/slug-available?slug=${encodeURIComponent(slug)}`),
    enabled: slug.length >= 3,
    staleTime: 10_000,
  });
  const slugPending = typedSlug.length >= 3 && (typedSlug !== slug || slugCheck.isFetching);
  const pw = passwordChecks(f.password);
  // H6: the owner accepts the current Terms, Privacy Policy and DPA (when the platform has published them)
  const legal = useLegalDocs();
  const [agreed, setAgreed] = useState(false);
  const legalDocs = legal.data ?? [];

  const signup = useMutation({
    mutationFn: () => api<{ email: string; website: string }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ ...f, phone: toAsciiDigits(f.phone), slug: typedSlug, locale: 'ar', acceptedDocuments: agreed ? legalDocs.map((d) => d.id) : [], subscribe }),
    }),
    onSuccess: (r) => go({ name: 'verify', email: f.email.trim().toLowerCase(), maskedEmail: r.email, justSent: true }),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); signup.mutate(); };

  return (
    <>
      <header className="form-head">
        <h2>إنشاء حساب للعيادة</h2>
        <p>ابدأ تجربة مجانية، بدون بطاقة دفع</p>
      </header>
      {subscribe && <SubscribeNotice intent={subscribe} />}
      <form onSubmit={submit} className="stack">
        <fieldset className="group">
          <legend>بياناتك</legend>
          <Field label="اسمك">{(a) => <Input id={a.id} value={f.fullName} onChange={set('fullName')} required autoComplete="name" autoFocus />}</Field>
          <div className="grid-2">
            <Field label="البريد الإلكتروني">{(a) => <Input id={a.id} type="email" value={f.email} onChange={set('email')} dir="ltr" required autoComplete="email" />}</Field>
            <Field label="رقم الموبايل">
              {(a) => (
                <div className="input-wrap" dir="ltr">
                  <span className="input-lead" aria-hidden><PhoneIcon size={16} /></span>
                  <Input id={a.id} type="tel" value={f.phone} onChange={set('phone')} dir="ltr" placeholder="01012345678" required autoComplete="tel" className="has-lead" />
                </div>
              )}
            </Field>
          </div>
          <Field label="كلمة المرور"
            hint={
              <ul className="checks" aria-live="polite">
                <li className={pw.length ? 'ok' : ''}><CheckIcon size={14} />8 أحرف على الأقل</li>
                <li className={pw.letter ? 'ok' : ''}><CheckIcon size={14} />حرف واحد على الأقل</li>
                <li className={pw.digit ? 'ok' : ''}><CheckIcon size={14} />رقم واحد على الأقل</li>
              </ul>
            }>
            {(a) => <PasswordInput id={a.id} describedBy={a.describedBy} value={f.password} onChange={set('password')} required minLength={8} maxLength={128}
              autoComplete="new-password" showLabel="إظهار كلمة المرور" hideLabel="إخفاء كلمة المرور" />}
          </Field>
        </fieldset>

        <fieldset className="group">
          <legend>عيادتك</legend>
          <div className="grid-2">
            <Field label="اسم العيادة" hint="بالعربية، أو بالإنجليزية إن كان اسم علامتك التجارية مكتوبًا بها.">
              {(a) => <Input id={a.id} describedBy={a.describedBy} value={f.clinicNameAr} onChange={set('clinicNameAr')} required dir="auto" />}
            </Field>
          </div>
          <Field label="عنوان موقع العيادة"
            error={slug === typedSlug && slugCheck.data?.available === false ? 'هذا العنوان غير متاح، جرّب عنوانًا آخر' : undefined}
            hint={slugPending ? 'جارٍ التحقق…'
              : slug.length >= 3 && slugCheck.data?.available ? <span className="ok-text"><CheckIcon size={14} /> <bdi dir="ltr">{slug}.{ROOT_DOMAIN}</bdi> — متاح</span>
              : undefined}>
            {(a) => (
              <div className="addon" dir="ltr">
                <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={f.slug}
                  onChange={set('slug', (v) => v.toLowerCase())} placeholder="my-clinic" required
                  pattern="[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]" autoCapitalize="off" spellCheck={false} />
                <span className="addon-text">.{ROOT_DOMAIN}</span>
              </div>
            )}
          </Field>
        </fieldset>

        <LegalConsent docs={legalDocs} checked={agreed} onChange={setAgreed} />
        <ErrorText error={signup.error} />
        <Button type="submit" block loading={signup.isPending}
          disabled={(slugCheck.data?.available === false && slug === typedSlug) || (legalDocs.length > 0 && !agreed)}>إنشاء الحساب</Button>
      </form>
      <p className="form-foot"><LinkButton onClick={() => go({ name: 'login' })}>لديك حساب؟ سجّل الدخول</LinkButton></p>
    </>
  );
}

export function Verify({ email, masked, justSent, back }: { email: string; masked: string; justSent: boolean; back: () => void }) {
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(justSent ? RESEND_COOLDOWN_S : 0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const verify = useMutation({
    mutationFn: (c: string) => api<Session>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ email, code: c }) }),
    onSuccess: setSession,
  });
  const resend = useMutation({
    mutationFn: () => api('/auth/otp/resend', { method: 'POST', body: JSON.stringify({ email }) }),
    onSuccess: () => { setCooldown(RESEND_COOLDOWN_S); setCode(''); verify.reset(); },
  });
  const onCode = (v: string) => {
    const c = toAsciiDigits(v).replace(/\D/g, '').slice(0, 6);
    setCode(c);
    if (c.length === 6 && !verify.isPending) verify.mutate(c); // submit as soon as the 6th digit lands (also on paste/autofill)
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (code.length === 6) verify.mutate(code); };

  return (
    <>
      <header className="form-head">
        <div className="form-icon"><ShieldIcon size={22} /></div>
        <h2>تأكيد البريد الإلكتروني</h2>
        <p>أرسلنا رمزًا من 6 أرقام إلى <bdi dir="ltr" className="strong">{masked}</bdi></p>
      </header>
      <form onSubmit={submit} className="stack">
        <Field label="الرمز">
          {(a) => <OtpInput id={a.id} value={code} onChange={onCode} invalid={!!verify.error} label="الرمز" />}
        </Field>
        <ErrorText error={verify.error} />
        <Button type="submit" block loading={verify.isPending} disabled={code.length !== 6}>تأكيد</Button>
      </form>
      <div className="form-foot center">
        <span className="muted">لم يصلك الرمز؟ </span>
        {cooldown > 0
          ? <span className="muted">يمكنك الإعادة بعد <bdi>{cooldown}</bdi>ث</span>
          : <LinkButton onClick={() => resend.mutate()} disabled={resend.isPending}>إعادة إرسال الرمز</LinkButton>}
      </div>
      {resend.isSuccess && <Alert tone="success">تم إرسال رمز جديد</Alert>}
      <ErrorText error={resend.error} />
      <p className="form-foot center"><LinkButton onClick={back}>تعديل البيانات</LinkButton></p>
      {import.meta.env.DEV && <p className="dev-note">في بيئة التطوير تظهر الرسائل في Mailpit: localhost:8025</p>}
    </>
  );
}

/** Forgot password, step 1: the email (SRS AUTH-102). The API answers the same whether or not the account exists. */
export function Forgot({ go }: { go: (s: AuthScreen) => void }) {
  const [email, setEmail] = useState('');
  const send = useMutation({
    mutationFn: () => api('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email: email.trim() }) }),
    onSuccess: () => go({ name: 'reset', email: email.trim().toLowerCase() }),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); send.mutate(); };
  return (
    <>
      <header className="form-head">
        <div className="form-icon"><ShieldIcon size={22} /></div>
        <h2>إعادة تعيين كلمة المرور</h2>
        <p>أدخل بريدك الإلكتروني وسنرسل لك رمزًا من 6 أرقام.</p>
      </header>
      <form onSubmit={submit} className="stack">
        <Field label="البريد الإلكتروني">
          {(a) => <Input id={a.id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" autoComplete="email" required autoFocus />}
        </Field>
        <ErrorText error={send.error} />
        <Button type="submit" block loading={send.isPending}>إرسال الرمز</Button>
      </form>
      <p className="form-foot center"><LinkButton onClick={() => go({ name: 'login' })}>العودة لتسجيل الدخول</LinkButton></p>
    </>
  );
}

/** Forgot password, step 2: the emailed code and the new password. Every session of the account ends. */
export function ResetPassword({ email, go }: { email: string; go: (s: AuthScreen) => void }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const pwc = passwordChecks(password);
  const pwOk = pwc.length && pwc.letter && pwc.digit;
  const reset = useMutation({
    mutationFn: () => api('/auth/password/reset', { method: 'POST', body: JSON.stringify({ email, code, password }) }),
    onSuccess: () => go({ name: 'login', notice: 'تم تغيير كلمة المرور. سجّل الدخول بها الآن.' }),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (code.length === 6 && pwOk) reset.mutate(); };
  return (
    <>
      <header className="form-head">
        <div className="form-icon"><ShieldIcon size={22} /></div>
        <h2>كلمة مرور جديدة</h2>
        <p>أدخل الرمز الذي أرسلناه إلى بريدك وكلمة المرور الجديدة.</p>
      </header>
      <form onSubmit={submit} className="stack">
        <Field label="الرمز">
          {(a) => <OtpInput id={a.id} value={code} onChange={(v) => setCode(toAsciiDigits(v).replace(/\D/g, '').slice(0, 6))} label="الرمز" />}
        </Field>
        <Field label="كلمة المرور الجديدة">
          {(a) => <PasswordInput id={a.id} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required
            showLabel="إظهار كلمة المرور" hideLabel="إخفاء كلمة المرور" />}
        </Field>
        <ErrorText error={reset.error} />
        <Button type="submit" block loading={reset.isPending} disabled={code.length !== 6 || !pwOk}>حفظ</Button>
      </form>
      <p className="form-foot center"><LinkButton onClick={() => go({ name: 'login' })}>العودة لتسجيل الدخول</LinkButton></p>
      {import.meta.env.DEV && <p className="dev-note">في بيئة التطوير تظهر الرسائل في Mailpit: localhost:8025</p>}
    </>
  );
}
