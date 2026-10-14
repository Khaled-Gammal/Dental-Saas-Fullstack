import { useEffect, useState, type ReactNode } from 'react';
import { can, refreshSession, subscribeSession, type Session } from './api';
import { savedLang, t, type Lang } from './i18n';
import { LangContext } from './lang';
import { AuthLayout, Login, Signup, Verify, type AuthScreen } from './screens/auth';
import { Branches, Overview } from './screens/pages';
import { Profile } from './screens/profile';
import { AppShell } from './screens/shell';
import { Logo, Spinner } from './ui/components';
import { useHashPage } from './util';

export function App() {
  const [lang, setLang] = useState<Lang>(savedLang);
  const [session, setSessionState] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [screen, setScreen] = useState<AuthScreen>({ name: 'login' });
  const [page, go] = useHashPage();

  useEffect(() => {
    subscribeSession((s) => {
      setSessionState(s);
      if (!s) setScreen({ name: 'login' }); // after sign-out or an ended session, never show a stale screen
    });
    // restore the session from the refresh cookie after a page reload
    refreshSession().catch(() => null).finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = `${t('title', lang)} · ${t('brand', lang)}`;
    try { localStorage.setItem('lang', lang); } catch { /* storage blocked: keep it for this visit only */ }
  }, [lang]);

  const toggleLang = () => setLang(lang === 'ar' ? 'en' : 'ar');

  let view: ReactNode;
  if (booting) {
    view = (
      <div className="boot" role="status" aria-label={t('loading', lang)}>
        <Logo name={t('brand', lang)} />
        <Spinner />
      </div>
    );
  } else if (!session) {
    view = (
      <AuthLayout lang={lang} onLang={toggleLang}>
        {screen.name === 'signup' ? <Signup lang={lang} go={setScreen} />
          : screen.name === 'verify' ? <Verify lang={lang} phone={screen.phone} masked={screen.maskedPhone} justSent={screen.justSent} back={() => setScreen({ name: 'login' })} />
          : <Login lang={lang} go={setScreen} />}
      </AuthLayout>
    );
  } else {
    view = (
      <AppShell lang={lang} onLang={toggleLang} session={session} page={page} go={go}>
        {page === 'branches' ? <Branches lang={lang} clinicId={session.clinic.id} canWrite={can(session, 'branches:write')} />
          : page === 'profile' ? <Profile lang={lang} clinicId={session.clinic.id} canEdit={can(session, 'settings:write')} />
          : <Overview lang={lang} session={session} go={go} />}
      </AppShell>
    );
  }
  return <LangContext.Provider value={lang}>{view}</LangContext.Provider>;
}
