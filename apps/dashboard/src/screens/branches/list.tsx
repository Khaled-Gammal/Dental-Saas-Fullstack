import { pickName } from '@dental/ui/text';
import { navigate, useFlash } from '../../hooks';
import { t, type Lang } from '../../i18n';
import { openDays } from '../../hours-model';
import { useBranches } from '../../queries';
import { to } from '../../router';
import { fmtNumber } from '../../util';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, PageHeader, Skeleton } from '../../ui/components';
import { RouteLink } from '../../ui/page';
import { CalendarIcon, EditIcon, PinIcon, PlusIcon } from '../../ui/icons';

/** `canWrite` only hides links the API would refuse (receptionists can view, not edit). */
export function BranchesList({ lang, clinicId, canWrite }: { lang: Lang; clinicId: string; canWrite: boolean }) {
  const flash = useFlash();
  const branches = useBranches(clinicId);
  const count = branches.data?.length ?? 0;
  const addBtn = canWrite && <Button onClick={() => navigate(to.create('branches'))}><PlusIcon size={18} />{t('addBranch', lang)}</Button>;
  // the clinic calendar: closed days and the website booking rules apply across branches
  const calendarLinks = (
    <span className="row-end">
      <RouteLink route={to.list('holidays')} className="btn btn-secondary">{t('holidaysLink', lang)}</RouteLink>
      <RouteLink route={to.list('booking')} className="btn btn-secondary">{t('bookingLink', lang)}</RouteLink>
      {count > 0 && addBtn}
    </span>
  );

  return (
    <>
      <PageHeader title={t('branches', lang)} sub={t('branchesSub', lang)} action={calendarLinks} />
      {flash && <Alert tone="success">{flash}</Alert>}
      {branches.isError ? (
        <ErrorText error={branches.error} onRetry={() => void branches.refetch()} />
      ) : branches.isLoading ? (
        <div className="cards"><Skeleton h={96} count={3} /></div>
      ) : count === 0 ? (
        <Card><EmptyState icon={<PinIcon size={28} />} title={t('noBranches', lang)} text={t('noBranchesText', lang)} action={addBtn} /></Card>
      ) : (
        <ul className="cards" aria-busy={branches.isFetching || undefined}>
          {branches.data?.map((b) => (
            <Card as="li" key={b.id} className={`branch${b.is_active ? '' : ' is-inactive'}`}>
              <div className="branch-top">
                <span className="branch-icon"><PinIcon /></span>
                <div className="branch-text">
                  <strong><bdi>{pickName(lang, b.name_ar, b.name_en, b.slug)}</bdi></strong>
                  <code dir="ltr">{b.slug}</code>
                </div>
                {b.is_main ? <Badge tone="primary">{t('main', lang)}</Badge> : !b.is_active ? <Badge>{t('inactive', lang)}</Badge> : null}
              </div>
              <div className="branch-hours">
                <CalendarIcon size={16} />
                {b.hours.length
                  ? <span>{t('openDays', lang)}: <strong><bdi>{fmtNumber(openDays(b.hours), lang)}/7</bdi></strong></span>
                  : <span className="warn-text">{t('noHours', lang)}</span>}
              </div>
              {canWrite && (
                <div className="branch-actions">
                  <RouteLink route={to.hours(b.id)} className={`btn btn-${b.hours.length ? 'secondary' : 'primary'}`}>
                    <CalendarIcon size={16} />{t('workingHours', lang)}
                  </RouteLink>
                  <RouteLink route={to.rooms(b.id)}>{t('roomsLink', lang)}</RouteLink>
                  <RouteLink route={to.edit('branches', b.id)}><EditIcon size={16} />{t('edit', lang)}</RouteLink>
                </div>
              )}
            </Card>
          ))}
        </ul>
      )}
    </>
  );
}
