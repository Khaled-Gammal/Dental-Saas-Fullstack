import { arName } from '@dental/ui/text';
import { navigate, useFlash } from '../../hooks';
import { t } from '../../i18n';
import { openDays } from '../../hours-model';
import { useBranches } from '../../queries';
import { to } from '../../router';
import { fmtNumber } from '../../util';
import type { Branch } from '../../types';
import { Alert, Badge, Button, PageHeader } from '../../ui/components';
import { DataTable, type Column } from '../../ui/data-table';
import { RouteLink } from '../../ui/page';
import { RowMenu } from '../../ui/row-menu';
import { CalendarIcon, EditIcon, PinIcon, PlusIcon } from '../../ui/icons';

/** `canWrite` only hides links the API would refuse (receptionists can view, not edit). */
export function BranchesList({ clinicId, canWrite }: { clinicId: string; canWrite: boolean }) {
  const flash = useFlash();
  const branches = useBranches(clinicId);
  const count = branches.data?.length ?? 0;
  const addBtn = canWrite && <Button onClick={() => navigate(to.create('branches'))}><PlusIcon size={18} />{t('addBranch')}</Button>;
  // the clinic calendar: closed days and the website booking rules apply across branches
  const calendarLinks = (
    <span className="row-end">
      <RouteLink route={to.list('holidays')} className="btn btn-secondary">{t('holidaysLink')}</RouteLink>
      <RouteLink route={to.list('booking')} className="btn btn-secondary">{t('bookingLink')}</RouteLink>
      {count > 0 && addBtn}
    </span>
  );

  return (
    <>
      <PageHeader title={t('branches')} sub={t('branchesSub')} action={calendarLinks} />
      {flash && <Alert tone="success">{flash}</Alert>}
      {/* a table with a «⋯» menu per row (UI refinement U2); the row opens the branch for those who edit it */}
      <DataTable
        label={t('branches')}
        rows={branches.data}
        columns={BRANCH_COLUMNS}
        rowKey={(b) => b.id}
        isLoading={branches.isLoading}
        isFetching={branches.isFetching}
        error={branches.isError ? branches.error : undefined}
        onRetry={() => void branches.refetch()}
        actions={canWrite ? (b) => (
          <RowMenu label={arName(b.name_ar, b.name_en, b.slug)} actions={[
            { label: t('workingHours'), icon: <CalendarIcon size={16} />, route: to.hours(b.id) },
            { label: t('roomsLink'), icon: <PinIcon size={16} />, route: to.rooms(b.id) },
            { label: t('edit'), icon: <EditIcon size={16} />, route: to.edit('branches', b.id) },
          ]} />
        ) : undefined}
        onRowClick={canWrite ? (b) => navigate(to.edit('branches', b.id)) : undefined}
        empty={{ icon: <PinIcon size={28} />, title: t('noBranches'), text: t('noBranchesText'), action: addBtn || undefined }}
      />
    </>
  );
}

const BRANCH_COLUMNS: Column<Branch>[] = [
  {
    id: 'branch', header: t('branch'), sortValue: (b) => arName(b.name_ar, b.name_en, b.slug),
    cell: (b) => (
      <span className="patient-main">
        <span className="patient-avatar" aria-hidden><PinIcon size={18} /></span>
        <span className="patient-text"><strong><bdi>{arName(b.name_ar, b.name_en, b.slug)}</bdi></strong><code dir="ltr" className="muted small">{b.slug}</code></span>
      </span>
    ),
  },
  {
    id: 'state', header: t('status'),
    cell: (b) => (b.is_main ? <Badge tone="primary">{t('main')}</Badge> : !b.is_active ? <Badge dot>{t('inactive')}</Badge> : <Badge tone="success" dot>{t('active')}</Badge>),
  },
  {
    id: 'hours', header: t('openDays'), sortValue: (b) => openDays(b.hours),
    cell: (b) => (b.hours.length ? <bdi className="tabular-nums">{fmtNumber(openDays(b.hours))}/7</bdi> : <span className="warn-text">{t('noHours')}</span>),
  },
];
