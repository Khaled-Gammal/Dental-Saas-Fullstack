import { arName, specialtyLabel } from '@dental/ui/text';
import { navigate, useFlash } from '../../hooks';
import { useBranches, useDoctors } from '../../queries';
import { to } from '../../router';
import { scheduledDays } from '../../schedule-model';
import type { Branch, Doctor } from '../../types';
import { Alert, Badge, Button, PageHeader, initials } from '../../ui/components';
import { DataTable, type Column } from '../../ui/data-table';
import { RowMenu } from '../../ui/row-menu';
import { CalendarIcon, EditIcon, PlusIcon, StethoscopeIcon } from '../../ui/icons';
import { fmtNumber } from '../../util';

/** `#/doctors` — the team; `canWrite` only hides links the API would refuse (settings:write). */
export function DoctorsList({ clinicId, canWrite }: { clinicId: string; canWrite: boolean }) {
  const flash = useFlash();
  const doctors = useDoctors(clinicId);
  const branches = useBranches(clinicId);
  const activeBranches = branches.data?.filter((b) => b.is_active) ?? [];
  const noBranches = branches.isSuccess && activeBranches.length === 0;
  const count = doctors.data?.length ?? 0;
  const addBtn = canWrite && <Button onClick={() => navigate(to.create('doctors'))} disabled={noBranches}><PlusIcon size={18} />إضافة طبيب</Button>;

  return (
    <>
      <PageHeader title="الأطباء" sub="فريقك الطبي كما يظهر للمرضى، ومواعيد كل طبيب في كل فرع" action={count > 0 ? addBtn : undefined} />
      {flash && <Alert tone="success">{flash}</Alert>}
      {canWrite && noBranches && <Alert tone="info">أضف فرعًا أولًا من صفحة الفروع</Alert>}
      {/* a table with a «⋯» menu per row (UI refinement U2); the row opens the doctor for those who edit doctors */}
      <DataTable
        label="الأطباء"
        rows={doctors.data}
        columns={doctorColumns(activeBranches)}
        rowKey={(d) => d.id}
        isLoading={doctors.isLoading}
        isFetching={doctors.isFetching}
        error={doctors.isError ? doctors.error : undefined}
        onRetry={() => void doctors.refetch()}
        search={{ placeholder: 'ابحث باسم الطبيب أو تخصصه', text: (d) => [d.name_ar, d.name_en, d.title_ar, d.title_en, ...d.specialties.map((s) => specialtyLabel(s))].filter(Boolean).join(' ') }}
        actions={canWrite ? (d) => (
          <RowMenu label={arName(d.name_ar, d.name_en, '—')} actions={[
            // as before: the schedule needs a branch the doctor works at
            { label: 'جدول المواعيد', icon: <CalendarIcon size={16} />, route: to.schedule(d.id), hidden: !activeBranches.some((b) => d.branch_ids.includes(b.id)) },
            { label: 'الإجازات', icon: <CalendarIcon size={16} />, route: to.timeOff(d.id) },
            { label: 'تعديل', icon: <EditIcon size={16} />, route: to.edit('doctors', d.id) },
          ]} />
        ) : undefined}
        onRowClick={canWrite ? (d) => navigate(to.edit('doctors', d.id)) : undefined}
        empty={{ icon: <StethoscopeIcon size={28} />, title: 'لا يوجد أطباء بعد', text: 'أضف الأطباء ليظهروا على موقعك ويمكن حجز مواعيد معهم', action: addBtn || undefined }}
      />
    </>
  );
}

/** The doctors table: who, what they do, where and when they work, and whether patients see them on the website. */
function doctorColumns(branches: Branch[]): Column<Doctor>[] {
  const where = (d: Doctor) => branches.filter((b) => d.branch_ids.includes(b.id)).map((b) => arName(b.name_ar, b.name_en, b.slug));
  return [
    {
      id: 'doctor', header: 'الطبيب', sortValue: (d) => arName(d.name_ar, d.name_en, '—'),
      cell: (d) => {
        const name = arName(d.name_ar, d.name_en, '—');
        const title = arName(d.title_ar, d.title_en);
        return (
          <span className="patient-main">
            {d.photo ? <img className="avatar avatar-photo" src={d.photo.thumbUrl} alt="" width={36} height={36} loading="lazy" /> : <span className="avatar">{initials(name)}</span>}
            <span className="patient-text"><strong><bdi>{name}</bdi></strong>{title && <span className="muted small"><bdi>{title}</bdi></span>}</span>
          </span>
        );
      },
    },
    {
      id: 'specialties', header: 'التخصصات', hideOnMobile: true,
      cell: (d) => (d.specialties.length ? <span className="chips">{d.specialties.map((s) => <span key={s} className="chip"><bdi>{specialtyLabel(s)}</bdi></span>)}</span> : <span className="muted">—</span>),
    },
    {
      id: 'branches', header: 'الفروع', hideOnMobile: true,
      cell: (d) => { const w = where(d); return w.length ? <bdi>{w.join('، ')}</bdi> : <span className="warn-text">اختر فرعًا واحدًا على الأقل</span>; },
    },
    {
      id: 'schedule', header: 'جدول المواعيد', sortValue: (d) => scheduledDays(d.schedule),
      cell: (d) => { const days = scheduledDays(d.schedule); return days ? <bdi className="tabular-nums">{fmtNumber(days)}/7</bdi> : <span className="warn-text">لم يُحدَّد الجدول بعد</span>; },
    },
    {
      id: 'state', header: 'الحالة', hideOnMobile: true,
      cell: (d) => (!d.is_active ? <Badge dot>غير نشط</Badge> : !d.show_on_website ? <Badge tone="warning" dot>مخفي من الموقع</Badge> : <Badge tone="success" dot>يظهر على الموقع</Badge>),
    },
  ];
}
