import { useState } from 'react';
import { navigate, useDebounced, useFlash } from '../../hooks';
import { t } from '../../i18n';
import { ageOn } from '../../patient-model';
import { usePatients } from '../../queries';
import { to } from '../../router';
import type { PatientRow } from '../../types';
import { Alert, Badge, Button, PageHeader } from '../../ui/components';
import { DataTable, type Column } from '../../ui/data-table';
import { CalendarIcon, EditIcon, PlusIcon, UsersIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';
import { RowMenu } from '../../ui/row-menu';

const today = () => new Date().toLocaleDateString('en-CA');

/**
 * `#/patients`: one search box for name, mobile or file number (the API searches every record and decides which),
 * newest first otherwise, with "load more" on the API's keyset cursor (redesign R3: on the shared DataTable; the
 * table does not sort or page itself here — the API does). `canWrite` = patients:write, `canBook` = appointments:write.
 */
export function PatientsList({ clinicId, canWrite, canBook }: { clinicId: string; canWrite: boolean; canBook: boolean }) {
  const flash = useFlash();
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim(), 250);
  const list = usePatients(clinicId, search);
  const rows = list.data?.pages.flatMap((p) => p.items);
  const add = canWrite && <Button onClick={() => navigate(to.create('patients'))}><PlusIcon size={18} />{t('addPatient')}</Button>;

  const columns: Column<PatientRow>[] = [
    {
      id: 'name', header: t('patientColName'),
      cell: (p) => (
        <RouteLink route={to.view('patients', p.id)} className="patient-main">
          <span className="patient-avatar" aria-hidden>{p.full_name.trim().slice(0, 1)}</span>
          <span className="patient-text">
            <strong><bdi>{p.full_name}</bdi></strong>
            <span className="muted small">{t('fileNo')} <bdi dir="ltr">{fmtNumber(p.file_no)}</bdi></span>
          </span>
        </RouteLink>
      ),
    },
    { id: 'phone', header: t('phone'), cell: (p) => <bdi dir="ltr" className="tabular-nums">{p.phone}</bdi> },
    {
      id: 'age', header: t('patientColAge'), hideOnMobile: true,
      cell: (p) => { const age = ageOn(p.date_of_birth ?? '', today()); return age === null ? <span className="muted">—</span> : `${fmtNumber(age)} ${t('years')}`; },
    },
    { id: 'gender', header: t('gender'), hideOnMobile: true, cell: (p) => (p.gender ? t(p.gender === 'male' ? 'male' : 'female') : <span className="muted">—</span>) },
    {
      id: 'status', header: t('status'), hideOnMobile: true,
      cell: (p) => (
        <span className="patient-badges">
          {p.tags.includes('needs_review') && <Badge tone="warning" dot>{t('needsReview')}</Badge>}
          {p.is_blocked && <Badge tone="danger" dot>{t('blocked')}</Badge>}
          {p.tags.filter((x) => x !== 'needs_review').slice(0, 2).map((x) => <Badge key={x}><bdi>{x}</bdi></Badge>)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('navPatients')} sub={t('patientsSub')} action={add || undefined} />
      {flash && <Alert tone="success">{flash}</Alert>}
      <DataTable
        label={t('navPatients')}
        rows={rows}
        columns={columns}
        rowKey={(p) => p.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.isError ? list.error : undefined}
        onRetry={() => void list.refetch()}
        search={{ placeholder: t('patientSearchHint'), value: q, onChange: setQ, autoFocus: true }}
        onRowClick={(p) => navigate(to.view('patients', p.id))}
        actions={(p) => (
          <RowMenu label={p.full_name} actions={[
            { label: t('rowOpenFile'), icon: <UsersIcon size={16} />, route: to.view('patients', p.id) },
            { label: t('book'), icon: <CalendarIcon size={16} />, route: to.create('appointments', { patient: p.id }), hidden: !canBook || p.is_blocked },
            { label: t('edit'), icon: <EditIcon size={16} />, route: to.edit('patients', p.id), hidden: !canWrite },
          ]} />
        )}
        empty={{
          icon: <UsersIcon size={28} />, title: t(search ? 'noPatientMatch' : 'noPatients'), text: t(search ? 'noPatientMatchText' : 'noPatientsText'),
          action: search ? undefined : add || undefined,
        }}
        footer={list.hasNextPage && (
          <div className="row-center"><Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t('loadMore')}</Button></div>
        )}
      />
    </>
  );
}
