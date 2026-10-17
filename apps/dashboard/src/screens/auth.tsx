import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, type ApiError, setSession, type Session } from '../api';
import { DEMO_PASSWORD, DEMO_USERS, ROOT_DOMAIN } from '../config';
import { t, type Lang } from '../i18n';
import { Alert, Button, ErrorText, Field, Input, LinkButton, Logo, OtpInput, PasswordInput } from '../ui/components';
import { CalendarIcon, CheckIcon, GlobeIcon, LangIcon, PhoneIcon, ShieldIcon } from '../ui/icons';
import { DentalArch, SmileCanvas } from '../ui/illustrations';
import { useDebounced } from '../hooks';
import { passwordChecks, toAsciiDigits } from '../util';

/** Sign-up is confirmed by an email code (SRS AUTH-101; no SMS). */
export type AuthScreen = { name: 'login' } | { name: 'signup' } | { name: 'verify'; email: string; maskedEmail: string; justSent: boolean };

const RESEND_COOLDOWN_S = 30;

/** Split screen: brand story on one side, the form on the other. Collapses to the form alone on phones. */
export function AuthLayout({ lang, onLang, children }: { lang: Lang; onLang: () => void; children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <Logo name={t('brand', lang)} light />
        <div className="auth-brand-body">
          <h1>{t('authTagline', lang)}</h1>
          <ul className="auth-points">
            <li><span><GlobeIcon size={18} /></span>{t('authPoint1', lang)}</li>
            <li><span><CalendarIcon size={18} /></span>{t('authPoint2', lang)}</li>
            <li><span><ShieldIcon size={18} /></span>{t('authPoint3', lang)}</li>
          </ul>
        </div>
        <SmileCanvas className="auth-canvas" />
        <DentalArch filled={14} className="auth-arch" />
      </aside>
      <div className="auth-main">
        <div className="auth-top">
          <span className="auth-mobile-logo"><Logo name={t('brand', lang)} /></span>
          <LinkButton onClick={onLang} lang={lang === 'ar' ? 'en' : 'ar'}><LangIcon size={18} />{t('switchLang', lang)}</LinkButton>
        </div>
        <div className="auth-form">{children}</div>
      </div>
    </div>
  );
}

export function Login({ lang, go }: { lang: Lang; go: (s: AuthScreen) => void }) {
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
        <h2>{t('signIn', lang)}</h2>
        <p>{t('signInSub', lang)}</p>
      </header>
      <form onSubmit={submit} className="stack" noValidate={false}>
        <Field label={t('identifier', lang)}>
          {(a) => <Input id={a.id} describedBy={a.describedBy} value={identifier} onChange={(e) => setIdentifier(e.target.value)} dir="ltr" autoComplete="username" required autoFocus />}
        </Field>
        <Field label={t('password', lang)}>
          {(a) => <PasswordInput id={a.id} describedBy={a.describedBy} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" required showLabel={t('showPw', lang)} hideLabel={t('hidePw', lang)} />}
        </Field>
        <ErrorText error={login.error} />
        <Button type="submit" block loading={login.isPending}>{t('signIn', lang)}</Button>
      </form>
      <p className="form-foot">
        <LinkButton onClick={() => go({ name: 'signup' })}>{t('noAccount', lang)}</LinkButton>
      </p>
      {import.meta.env.DEV && <DevQuickLogin lang={lang} />}
    </>
  );
}

function DevQuickLogin({ lang }: { lang: Lang }) {
  const [email, setEmail] = useState(DEMO_USERS[0]);
  const quick = useMutation({
    mutationFn: () => api<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: email, password: DEMO_PASSWORD }) }),
    onSuccess: setSession,
  });
  return (
    <details className="dev">
      <summary>{t('devQuick', lang)}</summary>
      <div className="dev-row">
        <select className="input" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" aria-label="demo user">
          {DEMO_USERS.map((u) => <option key={u}>{u}</option>)}
        </select>
        <Button variant="secondary" onClick={() => quick.mutate()} loading={quick.isPending}>{t('signIn', lang)}</Button>
      </div>
      <ErrorText error={quick.error} />
    </details>
  );
}

export function Signup({ lang, go }: { lang: Lang; go: (s: AuthScreen) => void }) {
  const [f, setF] = useState({ fullName: '', email: '', phone: '', password: '', clinicNameAr: '', clinicNameEn: '', slug: '' });
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

  const signup = useMutation({
    mutationFn: () => api<{ email: string; website: string }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ ...f, phone: toAsciiDigits(f.phone), clinicNameEn: f.clinicNameEn || undefined, slug: typedSlug, locale: lang }),
    }),
    onSuccess: (r) => go({ name: 'verify', email: f.email.trim().toLowerCase(), maskedEmail: r.email, justSent: true }),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); signup.mutate(); };

  return (
    <>
      <header className="form-head">
        <h2>{t('signUp', lang)}</h2>
        <p>{t('signUpSub', lang)}</p>
      </header>
      <form onSubmit={submit} className="stack">
        <fieldset className="group">
          <legend>{t('aboutYou', lang)}</legend>
          <Field label={t('fullName', lang)}>{(a) => <Input id={a.id} value={f.fullName} onChange={set('fullName')} required autoComplete="name" autoFocus />}</Field>
          <div className="grid-2">
            <Field label={t('email', lang)}>{(a) => <Input id={a.id} type="email" value={f.email} onChange={set('email')} dir="ltr" required autoComplete="email" />}</Field>
            <Field label={t('phone', lang)}>
              {(a) => (
                <div className="input-wrap" dir="ltr">
                  <span className="input-lead" aria-hidden><PhoneIcon size={16} /></span>
                  <Input id={a.id} type="tel" value={f.phone} onChange={set('phone')} dir="ltr" placeholder="01012345678" required autoComplete="tel" className="has-lead" />
                </div>
              )}
            </Field>
          </div>
          <Field label={t('password', lang)}
            hint={
              <ul className="checks" aria-live="polite">
                <li className={pw.length ? 'ok' : ''}><CheckIcon size={14} />{t('pwLen', lang)}</li>
                <li className={pw.letter ? 'ok' : ''}><CheckIcon size={14} />{t('pwLetter', lang)}</li>
                <li className={pw.digit ? 'ok' : ''}><CheckIcon size={14} />{t('pwDigit', lang)}</li>
              </ul>
            }>
            {(a) => <PasswordInput id={a.id} describedBy={a.describedBy} value={f.password} onChange={set('password')} required minLength={8} maxLength={128}
              autoComplete="new-password" showLabel={t('showPw', lang)} hideLabel={t('hidePw', lang)} />}
          </Field>
        </fieldset>

        <fieldset className="group">
          <legend>{t('aboutClinic', lang)}</legend>
          <div className="grid-2">
            <Field label={t('clinicNameAr', lang)}>{(a) => <Input id={a.id} value={f.clinicNameAr} onChange={set('clinicNameAr')} required dir="rtl" />}</Field>
            <Field label={t('clinicNameEn', lang)} optional={t('optional', lang)}>
              {(a) => <Input id={a.id} value={f.clinicNameEn} onChange={set('clinicNameEn')} dir="ltr" />}
            </Field>
          </div>
          <Field label={t('slug', lang)}
            error={slug === typedSlug && slugCheck.data?.available === false ? t('slugTaken', lang) : undefined}
            hint={slugPending ? t('checking', lang)
              : slug.length >= 3 && slugCheck.data?.available ? <span className="ok-text"><CheckIcon size={14} /> <bdi dir="ltr">{slug}.{ROOT_DOMAIN}</bdi> — {t('slugFree', lang)}</span>
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

        <ErrorText error={signup.error} />
        <Button type="submit" block loading={signup.isPending} disabled={slugCheck.data?.available === false && slug === typedSlug}>{t('create', lang)}</Button>
      </form>
      <p className="form-foot"><LinkButton onClick={() => go({ name: 'login' })}>{t('haveAccount', lang)}</LinkButton></p>
    </>
  );
}

export function Verify({ lang, email, masked, justSent, back }: { lang: Lang; email: string; masked: string; justSent: boolean; back: () => void }) {
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
        <h2>{t('verifyTitle', lang)}</h2>
        <p>{t('verifySent', lang)} <bdi dir="ltr" className="strong">{masked}</bdi></p>
      </header>
      <form onSubmit={submit} className="stack">
        <Field label={t('code', lang)}>
          {(a) => <OtpInput id={a.id} value={code} onChange={onCode} invalid={!!verify.error} label={t('code', lang)} />}
        </Field>
        <ErrorText error={verify.error} />
        <Button type="submit" block loading={verify.isPending} disabled={code.length !== 6}>{t('verify', lang)}</Button>
      </form>
      <div className="form-foot center">
        <span className="muted">{t('verifyAgain', lang)} </span>
        {cooldown > 0
          ? <span className="muted">{t('resendIn', lang)} <bdi>{cooldown}</bdi>{t('sec', lang)}</span>
          : <LinkButton onClick={() => resend.mutate()} disabled={resend.isPending}>{t('resend', lang)}</LinkButton>}
      </div>
      {resend.isSuccess && <Alert tone="success">{t('resent', lang)}</Alert>}
      <ErrorText error={resend.error} />
      <p className="form-foot center"><LinkButton onClick={back}>{t('changePhone', lang)}</LinkButton></p>
      {import.meta.env.DEV && <p className="dev-note">{t('devHint', lang)}</p>}
    </>
  );
}
