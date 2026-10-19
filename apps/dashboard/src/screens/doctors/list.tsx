import { arName, specialtyLabel } from '@dental/ui/text';
import { navigate, useFlash } from '../../hooks';
import { t } from '../../i18n';
import { useBranches, useDoctors } from '../../queries';
import { to } from '../../router';
import { scheduledDays } from '../../schedule-model';
import type { Branch, Doctor } from '../../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, PageHeader, Skeleton, initials } from '../../ui/components';
import { CalendarIcon, EditIcon, PinIcon, PlusIcon, StethoscopeIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';

/** `#/doctors` — the team; `canWrite` only hides links the API would refuse (settings:write). */
export function DoctorsList({ clinicId, canWrite }: { clinicId: string; canWrite: boolean }) {
  const flash = useFlash();
  const doctors = useDoctors(clinicId);
  const branches = useBranches(clinicId);
  const activeBranches = branches.data?.filter((b) => b.is_active) ?? [];
  const noBranches = branches.isSuccess && activeBranches.length === 0;
  const count = doctors.data?.length ?? 0;
  const addBtn = canWrite && <Button onClick={() => navigate(to.create('doctors'))} disabled={noBranches}><PlusIcon size={18} />{t('addDoctor')}</Button>;

  return (
    <>
      <PageHeader title={t('navDoctors')} sub={t('doctorsSub')} action={count > 0 ? addBtn : undefined} />
      {flash && <Alert tone="success">{flash}</Alert>}
      {canWrite && noBranches && <Alert tone="info">{t('noBranchesYet')}</Alert>}
      {doctors.isError ? (
        <ErrorText error={doctors.error} onRetry={() => void doctors.refetch()} />
      ) : doctors.isLoading ? (
        <div className="cards"><Skeleton h={120} count={3} /></div>
      ) : count === 0 ? (
        <Card><EmptyState icon={<StethoscopeIcon size={28} />} title={t('noDoctors')} text={t('noDoctorsText')} action={addBtn} /></Card>
      ) : (
        <ul className="cards" aria-busy={doctors.isFetching || undefined}>
          {doctors.data?.map((d) => <DoctorCard key={d.id} doctor={d} branches={activeBranches} canWrite={canWrite} />)}
        </ul>
      )}
    </>
  );
}

function DoctorCard({ doctor: d, branches, canWrite }: { doctor: Doctor; branches: Branch[]; canWrite: boolean }) {
  const name = arName(d.name_ar, d.name_en, '—');
  const title = arName(d.title_ar, d.title_en);
  const where = branches.filter((b) => d.branch_ids.includes(b.id)).map((b) => arName(b.name_ar, b.name_en, b.slug));
  const days = scheduledDays(d.schedule);
  return (
    <Card as="li" className={`doctor${d.is_active ? '' : ' is-inactive'}`}>
      <div className="branch-top">
        {d.photo ? <img className="avatar avatar-lg avatar-photo" src={d.photo.thumbUrl} alt="" width={44} height={44} loading="lazy" /> : <span className="avatar avatar-lg">{initials(name)}</span>}
        <div className="branch-text">
          <strong><bdi>{name}</bdi></strong>
          {title && <span className="muted small"><bdi>{title}</bdi></span>}
        </div>
        {!d.is_active ? <Badge>{t('inactive')}</Badge> : !d.show_on_website ? <Badge tone="warning">{t('hidden')}</Badge> : null}
      </div>
      {d.specialties.length > 0 && <div className="chips">{d.specialties.map((s) => <span key={s} className="chip"><bdi>{specialtyLabel(s)}</bdi></span>)}</div>}
      <div className="branch-hours">
        <PinIcon size={16} />
        {where.length ? <span><bdi>{where.join('، ')}</bdi></span> : <span className="warn-text">{t('needBranch')}</span>}
      </div>
      <div className="branch-hours no-line">
        <CalendarIcon size={16} />
        {days ? <span>{t('schedule')}: <strong><bdi>{fmtNumber(days)}/7</bdi></strong> {t('scheduleDays')}</span> : <span className="warn-text">{t('noSchedule')}</span>}
      </div>
      {canWrite && (
        <div className="branch-actions">
          {where.length > 0 && (
            <RouteLink route={to.schedule(d.id)} className={`btn btn-${days ? 'secondary' : 'primary'}`}><CalendarIcon size={16} />{t('schedule')}</RouteLink>
          )}
          <RouteLink route={to.timeOff(d.id)}>{t('timeOffLink')}</RouteLink>
          <RouteLink route={to.edit('doctors', d.id)}><EditIcon size={16} />{t('edit')}</RouteLink>
        </div>
      )}
    </Card>
  );
}
