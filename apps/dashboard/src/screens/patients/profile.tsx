import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { ApiError, can, type Session } from '../../api';
import { useFlash } from '../../hooks';
import { t, tOr, type Key } from '../../i18n';
import { ageOn, hasAlerts } from '../../patient-model';
import { usePatient, usePatientActivity, usePatientVisits, useSavePatient } from '../../queries';
import { to } from '../../router';
import type { AuditEntry, PatientDetail } from '../../types';
import { Alert, Badge, Button, Card, ErrorText, PageHeader } from '../../ui/components';
import { AlertIcon, CalendarIcon, EditIcon, PhoneIcon, ShieldIcon } from '../../ui/icons';
import { Breadcrumbs, ResourceState, RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';
import { ChartCard } from '../clinical/chart';
import { PatientFollowUpsCard } from '../clinical/followups';
import { PlansCard } from '../clinical/plans';
import { PatientBillingCard } from '../billing/list';
import { FilesCard } from './files-card';
import { MedicalHistoryCard } from './medical-history';

const today = () => new Date().toLocaleDateString('en-CA');
const loc = () => ('ar-EG-u-nu-latn');

/** `#/patients/:id/view`: who the patient is, their safety alerts, history and visits. */
export function PatientProfile({ clinicId, id, session }: { clinicId: string; id?: string; session: Session }) {
  const flash = useFlash();
  const one = usePatient(clinicId, id);
  if (!one.data) {
    // a merged record's old link: say where it went (SRS PATIENT-003)
    if (one.error instanceof ApiError && one.error.code === 'patient_merged' && typeof one.error.body.mergedInto === 'string') {
      return <Alert tone="info">{t('patientMergedNotice')} <RouteLink route={to.view('patients', one.error.body.mergedInto)}>{t('openSurvivor')}</RouteLink></Alert>;
    }
    return <ResourceState isLoading={one.isLoading} isError={one.isError} error={one.error} notFound={false} refetch={() => void one.refetch()} back={to.list('patients')} backLabel={t('navPatients')} />;
  }
  const p = one.data;
  const write = can(session, 'patients:write');
  return (
    <>
      <Breadcrumbs items={[{ label: t('navPatients'), route: to.list('patients') }, { label: p.full_name }]} />
      <PageHeader
        title={p.full_name}
        sub={`${t('fileNo')} ${fmtNumber(p.file_no)}`}
        action={
          <div className="row-end">
            {can(session, 'patients:merge') && <RouteLink route={{ page: 'patients', id: p.id, action: 'merge' }} className="btn btn-ghost">{t('mergeAction')}</RouteLink>}
            {write && <RouteLink route={to.edit('patients', p.id)} className="btn btn-secondary"><EditIcon size={16} />{t('edit')}</RouteLink>}
            {can(session, 'appointments:write') && !p.is_blocked && <RouteLink route={to.create('appointments', { patient: p.id })} className="btn btn-primary"><CalendarIcon size={16} />{t('book')}</RouteLink>}
          </div>
        }
      />
      {flash && <Alert tone="success">{flash}</Alert>}
      {hasAlerts(p.medicalHistory) && p.medicalHistory!.allergies.length > 0 && (
        <Alert tone="danger"><AlertIcon size={16} /> <strong>{t('allergies')}:</strong> <bdi>{p.medicalHistory!.allergies.join('، ')}</bdi></Alert>
      )}
      {p.is_blocked && <Alert tone="danger">{t('blockedBanner')}</Alert>}
      {p.needs_review && <ReviewBanner clinicId={clinicId} patient={p} canWrite={write} />}

      <div className="profile-grid">
        <div className="stack">
          <DetailsCard p={p} />
          <MedicalHistoryCard clinicId={clinicId} patientId={p.id} history={p.medicalHistory} canEdit={can(session, 'clinical:write')} />
          {p.medicalHistory && <ChartCard clinicId={clinicId} patientId={p.id} canWrite={can(session, 'clinical:write')} age={ageOn(p.date_of_birth ?? '', today())} />}
          {p.medicalHistory && <FilesCard clinicId={clinicId} patientId={p.id} canWrite={can(session, 'clinical:write')} />}
        </div>
        <div className="stack">
          {p.medicalHistory && <ClinicalVisitsCard clinicId={clinicId} patientId={p.id} />}
          {(can(session, 'invoices:read') || can(session, 'invoices:read:own')) && <PatientBillingCard clinicId={clinicId} patientId={p.id} canWrite={can(session, 'invoices:write')} />}
          <PlansCard clinicId={clinicId} patientId={p.id} canCreate={can(session, 'treatments:write:own')} />
          <PatientFollowUpsCard clinicId={clinicId} patientId={p.id} canWrite={write} canBook={can(session, 'appointments:write') && !p.is_blocked} />
          <VisitsCard p={p} />
          {can(session, 'audit:read') && <ActivityCard clinicId={clinicId} patientId={p.id} />}
        </div>
      </div>
    </>
  );
}

/** Website bookings create records flagged for review (SRS BOOK-11): reception confirms it is a real, new person. */
function ReviewBanner({ clinicId, patient, canWrite }: { clinicId: string; patient: PatientDetail; canWrite: boolean }) {
  const save = useSavePatient(clinicId, patient.id);
  return (
    <Alert tone="info">
      <div className="row-between">
        <span>{t('reviewBanner')}</span>
        {canWrite && <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate({ needsReview: false })}>{t('markReviewed')}</Button>}
      </div>
      <ErrorText error={save.error} />
    </Alert>
  );
}

function DetailsCard({ p }: { p: PatientDetail }) {
  const age = ageOn(p.date_of_birth ?? '', today());
  const rows: [Key, React.ReactNode][] = [
    ['phone', <a href={`tel:${p.phone}`} dir="ltr" className="link-plain"><PhoneIcon size={14} /> {p.phone}</a>],
    ...(p.phone_alt ? [['phoneAlt', <span dir="ltr">{p.phone_alt}</span>] as [Key, React.ReactNode]] : []),
    ...(p.email ? [['email', <span dir="ltr">{p.email}</span>] as [Key, React.ReactNode]] : []),
    ...(p.date_of_birth ? [['dateOfBirth', <span>{new Intl.DateTimeFormat(loc(), { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${p.date_of_birth}T00:00:00Z`))}{age !== null && <> · {fmtNumber(age)} {t('years')}</>}</span>] as [Key, React.ReactNode]] : []),
    ...(p.gender ? [['gender', t(p.gender)] as [Key, React.ReactNode]] : []),
    ...(p.city || p.address ? [['address', <bdi>{[p.address, p.city].filter(Boolean).join('، ')}</bdi>] as [Key, React.ReactNode]] : []),
    ...(p.occupation ? [['occupation', <bdi>{p.occupation}</bdi>] as [Key, React.ReactNode]] : []),
    ...(p.referral_source ? [['referralSource', <bdi>{p.referral_source}</bdi>] as [Key, React.ReactNode]] : []),
  ];
  const guardian = p.guardian_patient_name ?? p.guardian_name;
  return (
    <Card>
      <h2>{t('secContact')}</h2>
      <dl className="detail-list mt">
        {rows.map(([k, v]) => <div key={k}><dt>{t(k)}</dt><dd>{v}</dd></div>)}
        {guardian && (
          <div><dt>{t('secGuardian')}</dt><dd>
            {p.guardian_patient_id ? <RouteLink route={to.view('patients', p.guardian_patient_id)}><bdi>{guardian}</bdi></RouteLink> : <bdi>{guardian}</bdi>}
            {p.guardian_relation && <> · {t(`rel_${p.guardian_relation}`)}</>}
            {p.guardian_phone && <> · <span dir="ltr">{p.guardian_phone}</span></>}
          </dd></div>
        )}
        <div><dt>{t('marketing')}</dt><dd>{p.marketing_opt_in ? <Badge tone="success">{t('optedIn')}</Badge> : <span className="muted">{t('notOptedIn')}</span>}</dd></div>
      </dl>
      {p.tags.filter((x) => x !== 'needs_review').length > 0 && (
        <div className="chips mt">{p.tags.filter((x) => x !== 'needs_review').map((x) => <Badge key={x}><bdi>{x}</bdi></Badge>)}</div>
      )}
      {p.notes && <p className="history-notes mt">{p.notes}</p>}
    </Card>
  );
}

function VisitsCard({ p }: { p: PatientDetail }) {
  const fmt = new Intl.DateTimeFormat(loc(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Cairo' });
  const now = Date.now();
  return (
    <Card>
      <h2>{t('visits')}</h2>
      {p.appointments.length === 0 ? <p className="muted small mt-sm">{t('noVisits')}</p> : (
        <ol className="timeline mt">
          {p.appointments.map((a) => (
            <li key={a.id} className={new Date(a.starts_at).getTime() > now ? 'is-upcoming' : undefined}>
              <span className="timeline-when">{fmt.format(new Date(a.starts_at))}</span>
              <span className="timeline-what">
                <bdi>{arName(a.service_ar, a.service_en, t('appointment'))}</bdi> · <bdi>{arName(a.doctor_ar, a.doctor_en)}</bdi> · <bdi>{arName(a.branch_ar, a.branch_en)}</bdi>
              </span>
              <Badge tone={a.status === 'completed' ? 'success' : a.status === 'cancelled' || a.status === 'no_show' ? 'neutral' : 'primary'}>{t(`status_${a.status}` as Key)}</Badge>
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
  const fmt = new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' });
  return (
    <Card>
      <h2>{t('clinicalVisits')}</h2>
      {visits.isError ? <ErrorText error={visits.error} onRetry={() => void visits.refetch()} />
        : !visits.data?.length ? <p className="muted small mt-sm">{t('noClinicalVisits')}</p>
        : (
          <ol className="timeline mt">
            {visits.data.map((v) => (
              <li key={v.id}>
                <span className="timeline-when"><RouteLink route={to.visit(v.id)}>{fmt.format(new Date(v.visit_at))}</RouteLink></span>
                <span className="timeline-what">
                  <bdi>{arName(v.doctor.name_ar, v.doctor.name_en)}</bdi>
                  {v.diagnosis && <> · <bdi>{v.diagnosis}</bdi></>}
                  {v.procedures > 0 && <span className="muted small"> · {fmtNumber(v.procedures)} {t('proceduresCount')}</span>}
                </span>
                <Badge tone={v.status === 'final' ? 'neutral' : 'warning'}>{t(v.status === 'final' ? 'visitFinal' : 'visitDraft')}</Badge>
              </li>
            ))}
          </ol>
        )}
    </Card>
  );
}

/** Who opened or changed this record (DSH-15). Medical changes show which fields changed, never their values. */
function ActivityCard({ clinicId, patientId }: { clinicId: string; patientId: string }) {
  const [open, setOpen] = useState(false);
  const activity = usePatientActivity(clinicId, patientId, open);
  const fmt = new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Card>
      <div className="row-between">
        <h2><ShieldIcon size={18} /> {t('activity')}</h2>
        <Button variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{t(open ? 'hide' : 'show')}</Button>
      </div>
      {open && (activity.isError ? <ErrorText error={activity.error} onRetry={() => void activity.refetch()} /> : (
        <ul className="activity mt">
          {(activity.data ?? []).map((e: AuditEntry) => (
            <li key={e.id}>
              <span className="muted small">{fmt.format(new Date(e.created_at))}</span>
              <span><bdi>{e.actor_name ?? '—'}</bdi> · {tOr(`audit_${e.action.replace(/\./g, '_')}`, e.action)}</span>
              {e.changes && <span className="muted small">{Object.keys(e.changes).map((f) => tOr(`field_${f}`, f)).join('، ')}</span>}
            </li>
          ))}
        </ul>
      ))}
    </Card>
  );
}
