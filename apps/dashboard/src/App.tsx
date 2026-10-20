import { useEffect, useState, type ReactNode } from 'react';
import { can, refreshSession, subscribeSession, type Session } from './api';
import { t } from './i18n';
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
import { Discounts } from './screens/billing/discounts';
import { CashBox } from './screens/finance/cash';
import { Expenses } from './screens/finance/expenses';
import { Reports } from './screens/reports/reports';
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
    // index.html already says lang="ar" dir="rtl"; no language is stored or offered (L10N-001/002)
    document.title = `${t('title')} · ${t('brand')}`;
    try { localStorage.removeItem('lang'); } catch { /* storage blocked: nothing was saved either */ }
  }, []);

  // an invitation link opens with or without a session: accepting it signs in as the invitee
  const invite = invitationToken(window.location.hash);

  let view: ReactNode;
  if (booting) {
    view = (
      <div className="boot" role="status" aria-label={t('loading')}>
        <Logo name={t('brand')} />
        <Spinner />
      </div>
    );
  } else if (invite) {
    view = (
      <AuthLayout>
        <AcceptInvite token={invite} done={() => navigate(to.list('overview'))} />
      </AuthLayout>
    );
  } else if (!session) {
    view = (
      <AuthLayout>
        {screen.name === 'signup' ? <Signup go={setScreen} />
          : screen.name === 'verify' ? <Verify email={screen.email} masked={screen.maskedEmail} justSent={screen.justSent} back={() => setScreen({ name: 'login' })} />
          : screen.name === 'forgot' ? <Forgot go={setScreen} />
          : screen.name === 'reset' ? <ResetPassword email={screen.email} go={setScreen} />
          : <Login go={setScreen} notice={screen.notice} />}
      </AuthLayout>
    );
  } else {
    view = (
      <AppShell session={session} page={route.page}>
        <Screen route={route} session={session} />
      </AppShell>
    );
  }
  return view;
}

/** Route -> screen. Permissions only hide what the API would refuse; the server is the real gate. */
function Screen({ route, session }: { route: Route; session: Session }) {
  const clinicId = session.clinic.id;
  const settings = can(session, 'settings:write');
  const { page, id, action } = route;
  switch (page) {
    case 'overview': return <Overview session={session} />;
    case 'profile': return <Profile clinicId={clinicId} canEdit={settings} />;
    case 'branches': {
      const w = can(session, 'branches:write');
      if (action === 'new' && w) return <BranchForm clinicId={clinicId} />;
      if (action === 'edit' && w) return <BranchForm clinicId={clinicId} id={id} />;
      if (action === 'hours' && w) return <BranchHours clinicId={clinicId} id={id} />;
      if (action === 'rooms') return <BranchRooms clinicId={clinicId} id={id} canWrite={settings} />;
      if (action) return <NotFound text={t('noPermissionPage')} back={to.list('branches')} backLabel={t('branches')} />;
      return <BranchesList clinicId={clinicId} canWrite={w} />;
    }
    case 'appointments':
      if (action === 'new' && can(session, 'appointments:write')) return <NewAppointment clinicId={clinicId} patientId={route.query?.patient} prefill={route.query} canOverride={can(session, 'appointments:override')} />;
      if (action === 'edit' && can(session, 'appointments:write')) return <MoveAppointment clinicId={clinicId} id={id} canOverride={can(session, 'appointments:override')} />;
      if (action) return <NotFound text={t('noPermissionPage')} back={to.list('appointments')} backLabel={t('navAppointments')} />;
      return <Appointments clinicId={clinicId} canWrite={can(session, 'appointments:write')} canOwn={can(session, 'appointments:write:own')} query={route.query}
        canVisit={can(session, 'clinical:write')} canSeeBalances={can(session, 'invoices:read') || can(session, 'invoices:read:own')} canReadVisit={can(session, 'clinical:read') || can(session, 'clinical:write')}
        defaultView={session.clinic.role === 'doctor' ? 'mine' : 'all'} />; // a doctor opens on their own day (APPT-004)
    case 'gallery': {
      // website content is the owner's (SRS 2.2: Website & content)
      if (!can(session, 'website:write')) return <NotFound text={t('noPermissionPage')} back={to.list('overview')} backLabel={t('navOverview')} />;
      if (action === 'new') return <GalleryUpload clinicId={clinicId} query={route.query} />;
      if (action === 'edit') return <GalleryForm clinicId={clinicId} id={id} />;
      return <GalleryList clinicId={clinicId} query={route.query} />;
    }
    case 'patients': {
      const write = can(session, 'patients:write');
      if (!can(session, 'patients:read')) return <NotFound text={t('noPermissionPage')} back={to.list('overview')} backLabel={t('navOverview')} />;
      if (action === 'new' && write) return <PatientForm clinicId={clinicId} />;
      if (action === 'edit' && write) return <PatientForm clinicId={clinicId} id={id} />;
      if (action === 'view') return <PatientProfile clinicId={clinicId} id={id} session={session} />;
      if (action === 'merge' && can(session, 'patients:merge')) return <PatientMerge clinicId={clinicId} id={id} />;
      if (action) return <NotFound text={t('noPermissionPage')} back={to.list('patients')} backLabel={t('navPatients')} />;
      return <PatientsList clinicId={clinicId} canWrite={write} canBook={can(session, 'appointments:write')} />;
    }
    case 'doctors':
      if (action === 'new' && settings) return <DoctorForm clinicId={clinicId} />;
      if (action === 'edit' && settings) return <DoctorForm clinicId={clinicId} id={id} />;
      if (action === 'schedule' && settings) return <DoctorSchedule clinicId={clinicId} id={id} />;
      if (action === 'timeoff') return <DoctorTimeOff clinicId={clinicId} id={id} canWrite={settings} />;
      if (action) return <NotFound text={t('noPermissionPage')} back={to.list('doctors')} backLabel={t('navDoctors')} />;
      return <DoctorsList clinicId={clinicId} canWrite={settings} />;
    case 'services':
      if (action === 'new' && settings) return <ServiceFormPage clinicId={clinicId} catalogCode={route.query?.catalog} />;
      if (action === 'edit' && settings) return <ServiceFormPage clinicId={clinicId} id={id} />;
      if (action) return <NotFound text={t('noPermissionPage')} back={to.list('services')} backLabel={t('navServices')} />;
      return <ServicesList clinicId={clinicId} canWrite={settings} />;
    case 'visits':
      if (!can(session, 'clinical:read') && !can(session, 'clinical:write')) return <NotFound text={t('noPermissionPage')} back={to.list('overview')} backLabel={t('navOverview')} />;
      return <VisitPage clinicId={clinicId} id={id} canInvoice={can(session, 'invoices:write')} />;
    case 'plans': return <PlanPage clinicId={clinicId} id={id} />;
    case 'prescriptions': return <PrescriptionPrint clinicId={clinicId} id={id} />;
    case 'followups':
      return <FollowUps clinicId={clinicId} canWrite={can(session, 'patients:write')} canBook={can(session, 'appointments:write')} query={route.query} />;
    case 'invoices':
      if (action === 'new' && can(session, 'invoices:write')) return <NewInvoice clinicId={clinicId} query={route.query} />;
      if (action === 'view') return <InvoicePage clinicId={clinicId} id={id} />;
      if (action === 'print') return <InvoicePrint clinicId={clinicId} id={id} />;
      if (action || !can(session, 'invoices:read')) return <NotFound text={t('noPermissionPage')} back={to.list('overview')} backLabel={t('navOverview')} />;
      return <InvoicesList clinicId={clinicId} query={route.query} />;
    case 'discounts':
      if (!can(session, 'discounts:approve')) return <NotFound text={t('noPermissionPage')} back={to.list('overview')} backLabel={t('navOverview')} />;
      return <Discounts clinicId={clinicId} canSetLimits={can(session, 'staff:manage')} />;
    case 'expenses': {
      const rights = { all: can(session, 'expenses:write'), read: can(session, 'expenses:read'), approve: can(session, 'expenses:approve') };
      if (!rights.read) return <NotFound text={t('noPermissionPage')} back={to.list('overview')} backLabel={t('navOverview')} />;
      return <Expenses clinicId={clinicId} rights={rights} />;
    }
    case 'cash':
      if (!can(session, 'cash:operate')) return <NotFound text={t('noPermissionPage')} back={to.list('overview')} backLabel={t('navOverview')} />;
      return <CashBox clinicId={clinicId} />;
    case 'reports':
      return <Reports clinicId={clinicId} session={session} query={route.query} />;
    case 'payments':
      return <ReceiptPrint clinicId={clinicId} id={id} />;
    case 'holidays': return <Holidays clinicId={clinicId} canWrite={settings} />;
    case 'booking': return <BookingRules clinicId={clinicId} canWrite={settings} />;
    case 'staff':
      // staff & roles are the owner's (SRS 2.2)
      if (!can(session, 'staff:manage')) return <NotFound text={t('noPermissionPage')} back={to.list('overview')} backLabel={t('navOverview')} />;
      if (action === 'new') return <StaffInvite clinicId={clinicId} />;
      if (action === 'edit') return <StaffEdit clinicId={clinicId} id={id} />;
      return <StaffList clinicId={clinicId} session={session} />;
    default:
      return <NotFound text={t('notFoundText')} back={to.list('overview')} backLabel={t('navOverview')} />;
  }
}
