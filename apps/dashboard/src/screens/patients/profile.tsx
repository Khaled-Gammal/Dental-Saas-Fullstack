import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { ApiError, can, type Session } from '../../api';
import { useFlash } from '../../hooks';
import { appointmentStatusLabel, auditActionLabel, genderLabel, patientFieldLabel, profileTabLabel, signerRelationLabel } from '../../labels';
import { money } from '../../money';
import { ageOn, initialProfileTab, nextAppointment, profileTabs, type ProfileTab } from '../../patient-model';
import { usePatient, usePatientActivity, usePatientBilling, usePatientVisits, useSavePatient } from '../../queries';
import { to, type Route } from '../../router';
import type { AuditEntry, PatientDetail, PatientVisit } from '../../types';
import { Alert, Badge, Button, Card, ErrorText, PageHeader } from '../../ui/components';
import { CalendarIcon, EditIcon, PhoneIcon, ShieldIcon } from '../../ui/icons';
import { MedicalAlerts } from '../../ui/medical-alerts';
import { Breadcrumbs, ResourceState, RouteLink } from '../../ui/page';
import { clinicTimeZone, clinicToday, fmtNumber, LOC } from '../../util';
import { ChartCard } from '../clinical/chart';
import { PatientFollowUpsCard } from '../clinical/followups';
import { PlansCard } from '../clinical/plans';
import { PatientBillingCard } from '../billing/list';
import { FilesCard } from './files-card';
import { MedicalHistoryCard } from './medical-history';


/**
 * `#/patients/:id/view[?tab=]` (redesign R6): the patient's header (who, how to reach them, what they owe, the next
 * appointment) and safety alerts stay on top; the record below is split in tabs so the doctor and reception each
 * reach what they need without scrolling past the rest. A doctor lands on the clinical tab, reception on the overview.
 */
export function PatientProfile({ clinicId, id, session, query }: { clinicId: string; id?: string; session: Session; query?: Record<string, string> }) {
  const one = usePatient(clinicId, id);
  if (!one.data) {
    // a merged record's old link: say where it went (SRS PATIENT-003)
    if (one.error instanceof ApiError && one.error.code === 'patient_merged' && typeof one.error.body.mergedInto === 'string') {
      return <Alert tone="info">هذا الملف دُمج في ملف آخر. <RouteLink route={to.view('patients', one.error.body.mergedInto)}>فتح الملف</RouteLink></Alert>;
    }
    return <ResourceState isLoading={one.isLoading} isError={one.isError} error={one.error} notFound={false} refetch={() => void one.refetch()} back={to.list('patients')} backLabel="المرضى" />;
  }
  return <ProfileBody clinicId={clinicId} p={one.data} session={session} query={query} />;
}

function ProfileBody({ clinicId, p, session, query }: { clinicId: string; p: PatientDetail; session: Session; query?: Record<string, string> }) {
  const flash = useFlash();
  const has = (perm: string) => can(session, perm);
  const write = has('patients:write');
  const seesClinical = !!p.medicalHistory;
  const allowed = profileTabs(has, seesClinical);
  const billing = usePatientBilling(clinicId, p.id, allowed.includes('billing'));
  // review R10: a doctor reads the account of their own patients only (invoices:read:own); for anyone else's the API
  // answers 403, so the tab goes rather than opening onto an error
  const billingRefused = billing.error instanceof ApiError && billing.error.status === 403;
  const tabs = billingRefused ? allowed.filter((t) => t !== 'billing') : allowed;
  const tab = initialProfileTab(tabs, query?.tab, has);
  const owed = billing.data && billing.data.balance_minor > 0 ? billing.data.balance_minor : 0;
  const unbilled = billing.data?.unbilled.length ?? 0;
  const next = nextAppointment(p.appointments, Date.now());
  const age = ageOn(p.date_of_birth ?? '', clinicToday());
  const tabRoute = (t: ProfileTab) => ({ page: 'patients' as const, id: p.id, action: 'view' as const, query: { tab: t } });
  const canBook = has('appointments:write') && !p.is_blocked;

  return (
    <>
      <Breadcrumbs items={[{ label: 'المرضى', route: to.list('patients') }, { label: p.full_name }]} />
      <PageHeader
        title={p.full_name}
        sub={
          <span className="profile-sub">
            <span>ملف رقم <bdi dir="ltr">{fmtNumber(p.file_no)}</bdi></span>
            {age !== null && <span>{fmtNumber(age)} سنة</span>}
            {p.gender && <span>{genderLabel[p.gender]}</span>}
            <a href={`tel:${p.phone}`} dir="ltr" className="link-plain"><PhoneIcon size={14} /> {p.phone}</a>
          </span>
        }
        action={
          <div className="row-end">
            {has('patients:merge') && <RouteLink route={{ page: 'patients', id: p.id, action: 'merge' }} className="btn btn-ghost">دمج ملف مكرر</RouteLink>}
            {write && <RouteLink route={to.edit('patients', p.id)} className="btn btn-secondary"><EditIcon size={16} />تعديل</RouteLink>}
            {canBook && <RouteLink route={to.create('appointments', { patient: p.id })} className="btn btn-primary"><CalendarIcon size={16} />حجز موعد</RouteLink>}
          </div>
        }
      />
      <div className="profile-facts">
        {tabs.includes('billing') && billing.data && (
          <RouteLink route={tabRoute('billing')} className={`fact${owed ? ' is-owed' : ''}`}>
            <span className="fact-label">المتبقي</span>
            <strong><bdi>{owed ? money(owed, billing.data.currency) : 'لا مستحقات'}</bdi></strong>
            {unbilled > 0 && <Badge tone="warning">{fmtNumber(unbilled)} لم يُفوتر</Badge>}
          </RouteLink>
        )}
        <RouteLink route={tabRoute('appointments')} className="fact">
          <span className="fact-label">الموعد القادم</span>
          <strong>{next ? <bdi>{shortWhen().format(new Date(next.starts_at))}</bdi> : 'لا يوجد'}</strong>
          {next && <span className="muted small"><bdi>{arName(next.doctor_ar, next.doctor_en)}</bdi></span>}
        </RouteLink>
      </div>
      {flash && <Alert tone="success">{flash}</Alert>}
      <MedicalAlerts history={p.medicalHistory} />
      {p.is_blocked && <Alert tone="danger">هذا المريض ممنوع من الحجز.</Alert>}
      {p.needs_review && <ReviewBanner clinicId={clinicId} patient={p} canWrite={write} />}

      <div className="profile-tabs">
        <nav className="seg" aria-label="أقسام ملف المريض">
          {tabs.map((t) => (
            <RouteLink key={t} route={tabRoute(t)} className={`seg-btn${t === tab ? ' is-on' : ''}`} aria-current={t === tab ? 'page' : undefined}>
              {profileTabLabel[t]}
              {t === 'billing' && owed > 0 && <span className="tab-dot" aria-label="عليه مستحقات" />}
            </RouteLink>
          ))}
        </nav>
        <span className="profile-tabs-who" aria-hidden><bdi>{p.full_name}</bdi>{owed > 0 && billing.data && <> · <bdi className="text-owed">{money(owed, billing.data.currency)}</bdi></>}</span>
      </div>

      {tab === 'overview' && (
        <div className="profile-grid">
          <div className="stack"><DetailsCard p={p} /></div>
          <div className="stack">
            <SummaryCard clinicId={clinicId} p={p} seesClinical={seesClinical} tabRoute={tabRoute} next={next} canBook={canBook} />
            {!seesClinical && <PlansCard clinicId={clinicId} patientId={p.id} canCreate={has('treatments:write:own')} />}
          </div>
        </div>
      )}
      {tab === 'clinical' && (
        <div className="profile-grid">
          <div className="stack">
            <ClinicalVisitsCard clinicId={clinicId} patientId={p.id} />
            <ChartCard clinicId={clinicId} patientId={p.id} canWrite={has('clinical:write')} age={age} />
          </div>
          <div className="stack">
            <MedicalHistoryCard clinicId={clinicId} patientId={p.id} history={p.medicalHistory} canEdit={has('clinical:write')} />
            <PlansCard clinicId={clinicId} patientId={p.id} canCreate={has('treatments:write:own')} />
            <FilesCard clinicId={clinicId} patientId={p.id} canWrite={has('clinical:write')} />
          </div>
        </div>
      )}
      {tab === 'billing' && <PatientBillingCard clinicId={clinicId} patientId={p.id} canWrite={has('invoices:write')} />}
      {tab === 'appointments' && (
        <div className="profile-grid">
          <div className="stack"><VisitsCard p={p} /></div>
          <div className="stack">
            <PatientFollowUpsCard clinicId={clinicId} patientId={p.id} canWrite={write} canBook={canBook} />
          </div>
        </div>
      )}
      {tab === 'activity' && <ActivityCard clinicId={clinicId} patientId={p.id} defaultOpen />}
    </>
  );
}

const shortWhen = () => new Intl.DateTimeFormat(LOC, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: clinicTimeZone() });

/** The overview's at-a-glance card: the next appointment, the last clinical visit, the account; each opens its tab. */
function SummaryCard({ clinicId, p, seesClinical, tabRoute, next, canBook }: {
  clinicId: string; p: PatientDetail; seesClinical: boolean; tabRoute: (t: ProfileTab) => Route; next: PatientVisit | null; canBook: boolean;
}) {
  const visits = usePatientVisits(clinicId, p.id, seesClinical);
  const last = visits.data?.[0];
  const drafts = visits.data?.filter((v) => v.status === 'draft').length ?? 0;
  return (
    <Card>
      <h2>ملخص</h2>
      <dl className="detail-list mt">
        <div>
          <dt>الموعد القادم</dt>
          <dd>
            {next ? (
              <><bdi>{shortWhen().format(new Date(next.starts_at))}</bdi> · <bdi>{arName(next.service_ar, next.service_en, 'موعد')}</bdi> · <bdi>{arName(next.doctor_ar, next.doctor_en)}</bdi></>
            ) : canBook ? <RouteLink route={to.create('appointments', { patient: p.id })}>لا يوجد · حجز موعد</RouteLink> : <span className="muted">لا يوجد</span>}
          </dd>
        </div>
        {seesClinical && (
          <div>
            <dt>آخر زيارة</dt>
            <dd>
              {last ? (
                <><RouteLink route={to.visit(last.id)}>{shortWhen().format(new Date(last.visit_at))}</RouteLink> · <bdi>{arName(last.doctor.name_ar, last.doctor.name_en)}</bdi>
                  {last.diagnosis && <> · <bdi>{last.diagnosis}</bdi></>}</>
              ) : <span className="muted">لا توجد زيارات بعد</span>}
              {drafts > 0 && <> <RouteLink route={tabRoute('clinical')}><Badge tone="warning">{fmtNumber(drafts)} مسودة</Badge></RouteLink></>}
            </dd>
          </div>
        )}
      </dl>
    </Card>
  );
}

/**
 * Website bookings flag records for review (SRS BOOK-11): a new record (is it a real, new person?) or a matched one
 * booked with a different email (review R11: the address on file is kept; the one used is in the activity log).
 */
function ReviewBanner({ clinicId, patient, canWrite }: { clinicId: string; patient: PatientDetail; canWrite: boolean }) {
  const save = useSavePatient(clinicId, patient.id);
  return (
    <Alert tone="info">
      <div className="row-between">
        <span>هذا الملف يحتاج مراجعة بسبب حجز عبر الموقع: تأكد أنه ليس ملفًا مكررًا، وإن حُجز ببريد مختلف فراجع البريد المستخدم في سجل النشاط قبل تعديله.</span>
        {canWrite && <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate({ needsReview: false })}>تمت المراجعة</Button>}
      </div>
      <ErrorText error={save.error} />
    </Alert>
  );
}

function DetailsCard({ p }: { p: PatientDetail }) {
  const age = ageOn(p.date_of_birth ?? '', clinicToday());
  const rows: [string, React.ReactNode][] = [
    ['رقم الموبايل', <a href={`tel:${p.phone}`} dir="ltr" className="link-plain"><PhoneIcon size={14} /> {p.phone}</a>],
    ...(p.phone_alt ? [['موبايل آخر', <span dir="ltr">{p.phone_alt}</span>] as [string, React.ReactNode]] : []),
    ...(p.email ? [['البريد الإلكتروني', <span dir="ltr">{p.email}</span>] as [string, React.ReactNode]] : []),
    ...(p.date_of_birth ? [['تاريخ الميلاد', <span>{new Intl.DateTimeFormat(LOC, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${p.date_of_birth}T00:00:00Z`))}{age !== null && <> · {fmtNumber(age)} سنة</>}</span>] as [string, React.ReactNode]] : []),
    ...(p.gender ? [['النوع', genderLabel[p.gender] ?? p.gender] as [string, React.ReactNode]] : []),
    ...(p.city || p.address ? [['العنوان', <bdi>{[p.address, p.city].filter(Boolean).join('، ')}</bdi>] as [string, React.ReactNode]] : []),
    ...(p.occupation ? [['المهنة', <bdi>{p.occupation}</bdi>] as [string, React.ReactNode]] : []),
    ...(p.referral_source ? [['كيف عرف العيادة', <bdi>{p.referral_source}</bdi>] as [string, React.ReactNode]] : []),
  ];
  const guardian = p.guardian_patient_name ?? p.guardian_name;
  return (
    <Card>
      <h2>التواصل</h2>
      <dl className="detail-list mt">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        {guardian && (
          <div><dt>ولي الأمر</dt><dd>
            {p.guardian_patient_id ? <RouteLink route={to.view('patients', p.guardian_patient_id)}><bdi>{guardian}</bdi></RouteLink> : <bdi>{guardian}</bdi>}
            {p.guardian_relation && <> · {signerRelationLabel[p.guardian_relation]}</>}
            {p.guardian_phone && <> · <span dir="ltr">{p.guardian_phone}</span></>}
          </dd></div>
        )}
        <div><dt>الرسائل التسويقية</dt><dd>{p.marketing_opt_in ? <Badge tone="success">موافق</Badge> : <span className="muted">غير موافق</span>}</dd></div>
      </dl>
      {p.tags.filter((x) => x !== 'needs_review').length > 0 && (
        <div className="chips mt">{p.tags.filter((x) => x !== 'needs_review').map((x) => <Badge key={x}><bdi>{x}</bdi></Badge>)}</div>
      )}
      {p.notes && <p className="history-notes mt">{p.notes}</p>}
    </Card>
  );
}

function VisitsCard({ p }: { p: PatientDetail }) {
  const fmt = new Intl.DateTimeFormat(LOC, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: clinicTimeZone() });
  const now = Date.now();
  return (
    <Card>
      <h2>المواعيد</h2>
      {p.appointments.length === 0 ? <p className="muted small mt-sm">لا توجد مواعيد بعد.</p> : (
        <ol className="timeline mt">
          {p.appointments.map((a) => (
            <li key={a.id} className={new Date(a.starts_at).getTime() > now ? 'is-upcoming' : undefined}>
              <span className="timeline-when">{fmt.format(new Date(a.starts_at))}</span>
              <span className="timeline-what">
                <bdi>{arName(a.service_ar, a.service_en, 'موعد')}</bdi> · <bdi>{arName(a.doctor_ar, a.doctor_en)}</bdi> · <bdi>{arName(a.branch_ar, a.branch_en)}</bdi>
              </span>
              <Badge tone={a.status === 'completed' ? 'success' : a.status === 'cancelled' || a.status === 'no_show' ? 'neutral' : 'primary'}>{appointmentStatusLabel[a.status]}</Badge>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** The clinical visits (VISIT-001): the doctor, the diagnosis, what was done; each opens the visit. */
function ClinicalVisitsCard({ clinicId, patientId }: { clinicId: string; patientId: string }) {
  const visits = usePatientVisits(clinicId, patientId, true);
  const fmt = new Intl.DateTimeFormat(LOC, { dateStyle: 'medium', timeStyle: 'short', timeZone: clinicTimeZone() });
  return (
    <Card>
      <h2>الزيارات السريرية</h2>
      {visits.isError ? <ErrorText error={visits.error} onRetry={() => void visits.refetch()} />
        : !visits.data?.length ? <p className="muted small mt-sm">لا توجد زيارات سريرية بعد.</p>
        : (
          <ol className="timeline mt">
            {visits.data.map((v) => (
              <li key={v.id}>
                <span className="timeline-when"><RouteLink route={to.visit(v.id)}>{fmt.format(new Date(v.visit_at))}</RouteLink></span>
                <span className="timeline-what">
                  <bdi>{arName(v.doctor.name_ar, v.doctor.name_en)}</bdi>
                  {v.diagnosis && <> · <bdi>{v.diagnosis}</bdi></>}
                  {v.procedures > 0 && <span className="muted small"> · {fmtNumber(v.procedures)} إجراء</span>}
                </span>
                <Badge tone={v.status === 'final' ? 'neutral' : 'warning'}>{v.status === 'final' ? 'نهائية' : 'مسودة'}</Badge>
              </li>
            ))}
          </ol>
        )}
    </Card>
  );
}

/** Who opened or changed this record (DSH-15). Medical changes show which fields changed, never their values. */
function ActivityCard({ clinicId, patientId, defaultOpen = false }: { clinicId: string; patientId: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const activity = usePatientActivity(clinicId, patientId, open);
  const fmt = new Intl.DateTimeFormat(LOC, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Card>
      <div className="row-between">
        <h2><ShieldIcon size={18} /> سجل الوصول</h2>
        <Button variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? 'إخفاء' : 'عرض'}</Button>
      </div>
      {open && (activity.isError ? <ErrorText error={activity.error} onRetry={() => void activity.refetch()} /> : (
        <ul className="activity mt">
          {(activity.data ?? []).map((e: AuditEntry) => (
            <li key={e.id}>
              <span className="muted small">{fmt.format(new Date(e.created_at))}</span>
              <span><bdi>{e.actor_name ?? '—'}</bdi> · {(auditActionLabel[e.action.replace(/\./g, '_')] ?? e.action)}</span>
              {e.changes && <span className="muted small">{Object.keys(e.changes).map((f) => (patientFieldLabel[f] ?? f)).join('، ')}</span>}
            </li>
          ))}
        </ul>
      ))}
    </Card>
  );
}
