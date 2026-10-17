import { useEffect, useState, type ReactNode } from 'react';
import { can, refreshSession, subscribeSession, type Session } from './api';
import { savedLang, t, type Lang } from './i18n';
import { LangContext } from './lang';
import { AuthLayout, Forgot, Login, ResetPassword, Signup, Verify, type AuthScreen } from './screens/auth';
import { AcceptInvite } from './screens/accept-invite';
import { navigate, useRoute } from './hooks';
import { StaffEdit } from './screens/staff/edit';
import { StaffInvite } from './screens/staff/invite';
import { StaffList } from './screens/staff/list';
import { BranchForm } from './screens/branches/form';
import { BranchHours } from './screens/branches/hours';
import { BranchesList } from './screens/branches/list';
import { DoctorForm } from './screens/doctors/form';
import { DoctorsList } from './screens/doctors/list';
import { DoctorSchedule } from './screens/doctors/schedule';
import { Appointments } from './screens/appointments/list';
import { NewAppointment } from './screens/appointments/new';
import { MoveAppointment } from './screens/appointments/move';
import { BookingRules } from './screens/calendar/booking-settings';
import { Holidays } from './screens/calendar/holidays';
import { BranchRooms } from './screens/calendar/rooms';
import { DoctorTimeOff } from './screens/calendar/time-off';
import { InvoicePage } from './screens/billing/invoice';
import { InvoicesList } from './screens/billing/list';
import { NewInvoice } from './screens/billing/new';
import { InvoicePrint, ReceiptPrint } from './screens/billing/print';
import { FollowUps } from './screens/clinical/followups';
import { PlanPage } from './screens/clinical/plans';
import { PrescriptionPrint } from './screens/clinical/prescription-print';
import { VisitPage } from './screens/clinical/visit';
import { PatientForm } from './screens/patients/form';
import { PatientsList } from './screens/patients/list';
import { PatientMerge } from './screens/patients/merge';
import { PatientProfile } from './screens/patients/profile';
import { GalleryForm } from './screens/gallery/form';
import { GalleryList } from './screens/gallery/list';
import { GalleryUpload } from './screens/gallery/new';
import { Overview } from './screens/overview';
import { Profile } from './screens/profile';
import { ServiceFormPage } from './screens/services/form';
import { ServicesList } from './screens/services/list';
import { AppShell } from './screens/shell';
import { Logo, Spinner } from './ui/components';
import { NotFound } from './ui/page';
import { invitationToken, to, type Route } from './router';

export function App() {
  const [lang, setLang] = useState<Lang>(savedLang);
  const [session, setSessionState] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [screen, setScreen] = useState<AuthScreen>({ name: 'login' });
  const route = useRoute();

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

  // an invitation link opens with or without a session: accepting it signs in as the invitee
  const invite = invitationToken(window.location.hash);

  let view: ReactNode;
  if (booting) {
    view = (
      <div className="boot" role="status" aria-label={t('loading', lang)}>
        <Logo name={t('brand', lang)} />
        <Spinner />
      </div>
    );
  } else if (invite) {
    view = (
      <AuthLayout lang={lang} onLang={toggleLang}>
        <AcceptInvite lang={lang} token={invite} done={() => navigate(to.list('overview'))} />
      </AuthLayout>
    );
  } else if (!session) {
    view = (
      <AuthLayout lang={lang} onLang={toggleLang}>
        {screen.name === 'signup' ? <Signup lang={lang} go={setScreen} />
          : screen.name === 'verify' ? <Verify lang={lang} email={screen.email} masked={screen.maskedEmail} justSent={screen.justSent} back={() => setScreen({ name: 'login' })} />
          : screen.name === 'forgot' ? <Forgot lang={lang} go={setScreen} />
          : screen.name === 'reset' ? <ResetPassword lang={lang} email={screen.email} go={setScreen} />
          : <Login lang={lang} go={setScreen} notice={screen.notice} />}
      </AuthLayout>
    );
  } else {
    view = (
      <AppShell lang={lang} onLang={toggleLang} session={session} page={route.page}>
        <Screen route={route} lang={lang} session={session} />
      </AppShell>
    );
  }
  return <LangContext.Provider value={lang}>{view}</LangContext.Provider>;
}

/** Route -> screen. Permissions only hide what the API would refuse; the server is the real gate. */
function Screen({ route, lang, session }: { route: Route; lang: Lang; session: Session }) {
  const clinicId = session.clinic.id;
  const settings = can(session, 'settings:write');
  const { page, id, action } = route;
  switch (page) {
    case 'overview': return <Overview lang={lang} session={session} />;
    case 'profile': return <Profile lang={lang} clinicId={clinicId} canEdit={settings} />;
    case 'branches': {
      const w = can(session, 'branches:write');
      if (action === 'new' && w) return <BranchForm lang={lang} clinicId={clinicId} />;
      if (action === 'edit' && w) return <BranchForm lang={lang} clinicId={clinicId} id={id} />;
      if (action === 'hours' && w) return <BranchHours lang={lang} clinicId={clinicId} id={id} />;
      if (action === 'rooms') return <BranchRooms lang={lang} clinicId={clinicId} id={id} canWrite={settings} />;
      if (action) return <NotFound text={t('noPermissionPage', lang)} back={to.list('branches')} backLabel={t('branches', lang)} />;
      return <BranchesList lang={lang} clinicId={clinicId} canWrite={w} />;
    }
    case 'appointments':
      if (action === 'new' && can(session, 'appointments:write')) return <NewAppointment lang={lang} clinicId={clinicId} patientId={route.query?.patient} prefill={route.query} canOverride={can(session, 'appointments:override')} />;
      if (action === 'edit' && can(session, 'appointments:write')) return <MoveAppointment lang={lang} clinicId={clinicId} id={id} canOverride={can(session, 'appointments:override')} />;
      if (action) return <NotFound text={t('noPermissionPage', lang)} back={to.list('appointments')} backLabel={t('navAppointments', lang)} />;
      return <Appointments lang={lang} clinicId={clinicId} canWrite={can(session, 'appointments:write')} canOwn={can(session, 'appointments:write:own')} query={route.query}
        canVisit={can(session, 'clinical:write')} canReadVisit={can(session, 'clinical:read') || can(session, 'clinical:write')}
        defaultView={session.clinic.role === 'doctor' ? 'mine' : 'all'} />; // a doctor opens on their own day (APPT-004)
    case 'gallery': {
      // website content is the owner's (SRS 2.2: Website & content)
      if (!can(session, 'website:write')) return <NotFound text={t('noPermissionPage', lang)} back={to.list('overview')} backLabel={t('navOverview', lang)} />;
      if (action === 'new') return <GalleryUpload lang={lang} clinicId={clinicId} query={route.query} />;
      if (action === 'edit') return <GalleryForm lang={lang} clinicId={clinicId} id={id} />;
      return <GalleryList lang={lang} clinicId={clinicId} query={route.query} />;
    }
    case 'patients': {
      const write = can(session, 'patients:write');
      if (!can(session, 'patients:read')) return <NotFound text={t('noPermissionPage', lang)} back={to.list('overview')} backLabel={t('navOverview', lang)} />;
      if (action === 'new' && write) return <PatientForm lang={lang} clinicId={clinicId} />;
      if (action === 'edit' && write) return <PatientForm lang={lang} clinicId={clinicId} id={id} />;
      if (action === 'view') return <PatientProfile lang={lang} clinicId={clinicId} id={id} session={session} />;
      if (action === 'merge' && can(session, 'patients:merge')) return <PatientMerge lang={lang} clinicId={clinicId} id={id} />;
      if (action) return <NotFound text={t('noPermissionPage', lang)} back={to.list('patients')} backLabel={t('navPatients', lang)} />;
      return <PatientsList lang={lang} clinicId={clinicId} canWrite={write} canBook={can(session, 'appointments:write')} />;
    }
    case 'doctors':
      if (action === 'new' && settings) return <DoctorForm lang={lang} clinicId={clinicId} />;
      if (action === 'edit' && settings) return <DoctorForm lang={lang} clinicId={clinicId} id={id} />;
      if (action === 'schedule' && settings) return <DoctorSchedule lang={lang} clinicId={clinicId} id={id} />;
      if (action === 'timeoff') return <DoctorTimeOff lang={lang} clinicId={clinicId} id={id} canWrite={settings} />;
      if (action) return <NotFound text={t('noPermissionPage', lang)} back={to.list('doctors')} backLabel={t('navDoctors', lang)} />;
      return <DoctorsList lang={lang} clinicId={clinicId} canWrite={settings} />;
    case 'services':
      if (action === 'new' && settings) return <ServiceFormPage lang={lang} clinicId={clinicId} catalogCode={route.query?.catalog} />;
      if (action === 'edit' && settings) return <ServiceFormPage lang={lang} clinicId={clinicId} id={id} />;
      if (action) return <NotFound text={t('noPermissionPage', lang)} back={to.list('services')} backLabel={t('navServices', lang)} />;
      return <ServicesList lang={lang} clinicId={clinicId} canWrite={settings} />;
    case 'visits':
      if (!can(session, 'clinical:read') && !can(session, 'clinical:write')) return <NotFound text={t('noPermissionPage', lang)} back={to.list('overview')} backLabel={t('navOverview', lang)} />;
      return <VisitPage lang={lang} clinicId={clinicId} id={id} canInvoice={can(session, 'invoices:write')} />;
    case 'plans': return <PlanPage lang={lang} clinicId={clinicId} id={id} />;
    case 'prescriptions': return <PrescriptionPrint lang={lang} clinicId={clinicId} id={id} />;
    case 'followups':
      return <FollowUps lang={lang} clinicId={clinicId} canWrite={can(session, 'patients:write')} canBook={can(session, 'appointments:write')} query={route.query} />;
    case 'invoices':
      if (action === 'new' && can(session, 'invoices:write')) return <NewInvoice lang={lang} clinicId={clinicId} query={route.query} />;
      if (action === 'view') return <InvoicePage lang={lang} clinicId={clinicId} id={id} />;
      if (action === 'print') return <InvoicePrint lang={lang} clinicId={clinicId} id={id} />;
      if (action || !can(session, 'invoices:read')) return <NotFound text={t('noPermissionPage', lang)} back={to.list('overview')} backLabel={t('navOverview', lang)} />;
      return <InvoicesList lang={lang} clinicId={clinicId} query={route.query} />;
    case 'payments':
      return <ReceiptPrint lang={lang} clinicId={clinicId} id={id} />;
    case 'holidays': return <Holidays lang={lang} clinicId={clinicId} canWrite={settings} />;
    case 'booking': return <BookingRules lang={lang} clinicId={clinicId} canWrite={settings} />;
    case 'staff':
      // staff & roles are the owner's (SRS 2.2)
      if (!can(session, 'staff:manage')) return <NotFound text={t('noPermissionPage', lang)} back={to.list('overview')} backLabel={t('navOverview', lang)} />;
      if (action === 'new') return <StaffInvite lang={lang} clinicId={clinicId} />;
      if (action === 'edit') return <StaffEdit lang={lang} clinicId={clinicId} id={id} />;
      return <StaffList lang={lang} clinicId={clinicId} session={session} />;
    default:
      return <NotFound text={t('notFoundText', lang)} back={to.list('overview')} backLabel={t('navOverview', lang)} />;
  }
}
