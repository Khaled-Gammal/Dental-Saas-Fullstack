import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, hasToken, setToken } from './api';
import { t, type Lang } from './i18n';

interface Branch { id: string; name_ar: string | null; name_en: string | null; slug: string; city: string | null; is_main: boolean }
interface LoginResult { accessToken: string; user: { name: string }; clinic: { nameAr: string | null; nameEn: string | null; role: string } }

const DEMO_USERS = ['owner.a@demo.test', 'reception.a@demo.test', 'doctor.a@demo.test', 'owner.b@demo.test'];

export function App() {
  const [lang, setLang] = useState<Lang>((localStorage.getItem('lang') as Lang) ?? 'ar');
  const [session, setSession] = useState<LoginResult | null>(() => {
    const s = sessionStorage.getItem('session');
    return s && hasToken() ? (JSON.parse(s) as LoginResult) : null;
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('lang', lang);
  }, [lang]);

  const signOut = () => {
    setToken(null);
    sessionStorage.removeItem('session');
    setSession(null);
  };

  return (
    <div className="shell">
      <header>
        <strong>{t('title', lang)}</strong>
        {session && <span className="muted">{lang === 'ar' ? session.clinic.nameAr : session.clinic.nameEn} · {session.user.name} ({session.clinic.role})</span>}
        <span className="spacer" />
        <button className="link" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'العربية'}</button>
        {session && <button className="link" onClick={signOut}>{t('signOut', lang)}</button>}
      </header>
      <main>{session ? <Branches lang={lang} /> : <DevLogin lang={lang} onDone={(s) => { sessionStorage.setItem('session', JSON.stringify(s)); setSession(s); }} />}</main>
    </div>
  );
}

function DevLogin({ lang, onDone }: { lang: Lang; onDone: (s: LoginResult) => void }) {
  const [email, setEmail] = useState(DEMO_USERS[0]);
  const login = useMutation({
    mutationFn: () => api<LoginResult>('/auth/dev-login', { method: 'POST', body: JSON.stringify({ email }) }),
    onSuccess: (r) => { setToken(r.accessToken); onDone(r); },
  });
  return (
    <section className="card narrow">
      <h2>{t('signIn', lang)}</h2>
      <p className="muted">{t('devNote', lang)}</p>
      <select value={email} onChange={(e) => setEmail(e.target.value)}>
        {DEMO_USERS.map((u) => <option key={u}>{u}</option>)}
      </select>
      <button onClick={() => login.mutate()} disabled={login.isPending}>{t('signIn', lang)}</button>
      {login.error && <p className="error">{(login.error as Error).message}</p>}
    </section>
  );
}

function Branches({ lang }: { lang: Lang }) {
  const qc = useQueryClient();
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const [nameAr, setNameAr] = useState('');
  const [slug, setSlug] = useState('');
  const create = useMutation({
    mutationFn: () => api<Branch>('/branches', { method: 'POST', body: JSON.stringify({ nameAr, slug }) }),
    onSuccess: () => { setNameAr(''); setSlug(''); void qc.invalidateQueries({ queryKey: ['branches'] }); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };

  return (
    <section>
      <h2>{t('branches', lang)}</h2>
      {branches.isLoading && <p className="muted">…</p>}
      {branches.error && <p className="error">{(branches.error as Error).message}</p>}
      <ul className="list">
        {branches.data?.map((b) => (
          <li key={b.id} className="card">
            <strong>{lang === 'ar' ? b.name_ar ?? b.name_en : b.name_en ?? b.name_ar}</strong>
            <span className="muted">{b.slug}{b.is_main ? ` · ${t('main', lang)}` : ''}</span>
          </li>
        ))}
      </ul>
      <form className="card narrow" onSubmit={submit}>
        <h3>{t('addBranch', lang)}</h3>
        <input placeholder={t('nameAr', lang)} value={nameAr} onChange={(e) => setNameAr(e.target.value)} required />
        <input placeholder={t('slug', lang)} value={slug} onChange={(e) => setSlug(e.target.value)} dir="ltr" required />
        <button disabled={create.isPending}>{t('save', lang)}</button>
        {create.error && <p className="error">{(create.error as ApiError).message}</p>}
      </form>
    </section>
  );
}
