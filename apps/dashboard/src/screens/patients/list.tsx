import { useState } from 'react';
import { navigate, useDebounced, useFlash } from '../../hooks';
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
  const add = canWrite && <Button onClick={() => navigate(to.create('patients'))}><PlusIcon size={18} />مريض جديد</Button>;

  const columns: Column<PatientRow>[] = [
    {
      id: 'name', header: 'المريض',
      cell: (p) => (
        <RouteLink route={to.view('patients', p.id)} className="patient-main">
          <span className="patient-avatar" aria-hidden>{p.full_name.trim().slice(0, 1)}</span>
          <span className="patient-text">
            <strong><bdi>{p.full_name}</bdi></strong>
            <span className="muted small">ملف رقم <bdi dir="ltr">{fmtNumber(p.file_no)}</bdi></span>
          </span>
        </RouteLink>
      ),
    },
    { id: 'phone', header: 'رقم الموبايل', cell: (p) => <bdi dir="ltr" className="tabular-nums">{p.phone}</bdi> },
    {
      id: 'age', header: 'السن', hideOnMobile: true,
      cell: (p) => { const age = ageOn(p.date_of_birth ?? '', today()); return age === null ? <span className="muted">—</span> : `${fmtNumber(age)} ${'سنة'}`; },
    },
    { id: 'gender', header: 'النوع', hideOnMobile: true, cell: (p) => (p.gender ? p.gender === 'male' ? 'ذكر' : 'أنثى' : <span className="muted">—</span>) },
    {
      id: 'status', header: 'الحالة', hideOnMobile: true,
      cell: (p) => (
        <span className="patient-badges">
          {p.tags.includes('needs_review') && <Badge tone="warning" dot>يحتاج مراجعة</Badge>}
          {p.is_blocked && <Badge tone="danger" dot>محظور</Badge>}
          {p.tags.filter((x) => x !== 'needs_review').slice(0, 2).map((x) => <Badge key={x}><bdi>{x}</bdi></Badge>)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="المرضى" sub="ملفات المرضى: البحث بالاسم أو الموبايل أو رقم الملف" action={add || undefined} />
      {flash && <Alert tone="success">{flash}</Alert>}
      <DataTable
        label="المرضى"
        rows={rows}
        columns={columns}
        rowKey={(p) => p.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.isError ? list.error : undefined}
        onRetry={() => void list.refetch()}
        search={{ placeholder: 'الاسم أو رقم الموبايل أو رقم الملف', value: q, onChange: setQ, autoFocus: true }}
        onRowClick={(p) => navigate(to.view('patients', p.id))}
        actions={(p) => (
          <RowMenu label={p.full_name} actions={[
            { label: 'ملف المريض', icon: <UsersIcon size={16} />, route: to.view('patients', p.id) },
            { label: 'حجز موعد', icon: <CalendarIcon size={16} />, route: to.create('appointments', { patient: p.id }), hidden: !canBook || p.is_blocked },
            { label: 'تعديل', icon: <EditIcon size={16} />, route: to.edit('patients', p.id), hidden: !canWrite },
          ]} />
        )}
        empty={{
          icon: <UsersIcon size={28} />, title: search ? 'لا يوجد مريض مطابق' : 'لا يوجد مرضى بعد', text: search ? 'جرّب جزءًا من الاسم أو آخر أرقام الموبايل.' : 'سجّل أول مريض، أو سيُضاف المرضى تلقائيًا عند الحجز من الموقع.',
          action: search ? undefined : add || undefined,
        }}
        footer={list.hasNextPage && (
          <div className="row-center"><Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>عرض المزيد</Button></div>
        )}
      />
    </>
  );
}
