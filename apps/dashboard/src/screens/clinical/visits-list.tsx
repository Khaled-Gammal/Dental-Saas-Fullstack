import { arName } from '@dental/ui/text';
import { navigate } from '../../hooks';
import { useVisits } from '../../queries';
import { to } from '../../router';
import type { VisitListRow, VisitsView } from '../../types';
import { Badge, Button, PageHeader } from '../../ui/components';
import { DataTable, type Column } from '../../ui/data-table';
import { ReceiptIcon, StethoscopeIcon, UsersIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';
import { RowMenu } from '../../ui/row-menu';
import { fmtNumber } from '../../util';

const VIEWS: VisitsView[] = ['today', 'drafts', 'all'];
const VIEW_LABEL: Record<VisitsView, string> = { today: 'اليوم', drafts: 'مسودات لم تُعتمد', all: 'الكل' };
const EMPTY: Record<VisitsView, { title: string; text: string }> = {
  today: { title: 'لا توجد زيارات اليوم', text: 'تُفتح الزيارة من المواعيد عند حضور المريض.' },
  drafts: { title: 'لا توجد مسودات مفتوحة', text: 'كل الزيارات معتمدة.' },
  all: { title: 'لا توجد زيارات بعد', text: 'تُفتح الزيارة من المواعيد عند حضور المريض.' },
};
const loc = 'ar-EG-u-nu-latn';
const timeFmt = new Intl.DateTimeFormat(loc, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Cairo' });
const dateTimeFmt = new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Cairo' });

/**
 * `#/visits` (redesign R5): the clinic's visits in one place, so a doctor finds today's patients and the drafts they
 * left open without going through each patient. A doctor sees their own visits first (the API decides: `mine=auto`)
 * and can switch to every doctor's. The view and the switch live in the URL (`?view=&mine=`).
 * `canInvoice` = invoices:write: a visit with unbilled procedures offers its invoice.
 */
export function VisitsList({ clinicId, query, canInvoice }: { clinicId: string; query?: Record<string, string>; canInvoice: boolean }) {
  const view: VisitsView = VIEWS.includes(query?.view as VisitsView) ? (query!.view as VisitsView) : 'today';
  const mineParam = query?.mine === '1' || query?.mine === '0' ? query.mine : 'auto';
  const list = useVisits(clinicId, view, mineParam);
  const first = list.data?.pages[0];
  const rows = list.data?.pages.flatMap((p) => p.items);
  const mine = first?.mine ?? false;
  const link = (q: { view?: VisitsView; mine?: '1' | '0' }) => ({ page: 'visits' as const, query: { view: q.view ?? view, ...(q.mine ? { mine: q.mine } : mineParam !== 'auto' && { mine: mineParam }) } });

  const columns: Column<VisitListRow>[] = [
    {
      id: 'when', header: view === 'today' ? 'الوقت' : 'التاريخ', sortValue: (v) => v.visit_at,
      cell: (v) => <span className="whitespace-nowrap tabular-nums">{(view === 'today' ? timeFmt : dateTimeFmt).format(new Date(v.visit_at))}</span>,
    },
    {
      id: 'patient', header: 'المريض', sortValue: (v) => v.patient.full_name,
      cell: (v) => (
        <RouteLink route={to.visit(v.id)} className="patient-main">
          <span className="patient-text">
            <strong><bdi>{v.patient.full_name}</bdi></strong>
            <span className="muted small">ملف رقم <bdi dir="ltr">{fmtNumber(v.patient.file_no)}</bdi>{v.diagnosis && <> · <bdi>{v.diagnosis}</bdi></>}</span>
          </span>
        </RouteLink>
      ),
    },
    ...(!mine ? [{ id: 'doctor', header: 'الطبيب', hideOnMobile: true, sortValue: (v: VisitListRow) => arName(v.doctor.name_ar, v.doctor.name_en), cell: (v: VisitListRow) => <bdi>{arName(v.doctor.name_ar, v.doctor.name_en)}</bdi> }] : []),
    { id: 'branch', header: 'الفرع', hideOnMobile: true, cell: (v) => <bdi className="muted">{arName(v.branch.name_ar, v.branch.name_en)}</bdi> },
    {
      id: 'procedures', header: 'الإجراءات', hideOnMobile: true, sortValue: (v) => v.procedures,
      cell: (v) => (
        <span className="flex flex-wrap items-center gap-2">
          {v.procedures ? fmtNumber(v.procedures) : <span className="muted">—</span>}
          {v.unbilled > 0 && <Badge tone="warning">{fmtNumber(v.unbilled)} لم تُفوتر</Badge>}
        </span>
      ),
    },
    {
      id: 'status', header: 'الحالة', sortValue: (v) => v.status,
      cell: (v) => <Badge tone={v.status === 'final' ? 'neutral' : 'warning'} dot>{v.status === 'final' ? 'معتمدة' : 'مسودة'}</Badge>,
    },
  ];

  return (
    <>
      <PageHeader title="الزيارات" sub={mine ? 'زياراتك: مرضى اليوم والمسودات التي لم تُعتمد بعد.' : 'زيارات العيادة: مرضى اليوم والمسودات التي لم تُعتمد بعد.'}
        count={rows ? <bdi dir="ltr">{fmtNumber(rows.length)}{list.hasNextPage && '+'}</bdi> : undefined} />
      <div className="row-between">
        <div className="seg" role="group" aria-label="الزيارات">
          {VIEWS.map((v) => (
            <RouteLink key={v} route={link({ view: v })} className={`seg-btn${v === view ? ' is-on' : ''}`} aria-current={v === view ? 'page' : undefined}>{VIEW_LABEL[v]}</RouteLink>
          ))}
        </div>
        {first?.isDoctor && (
          <div className="seg" role="group" aria-label="الطبيب">
            <RouteLink route={link({ mine: '1' })} className={`seg-btn${mine ? ' is-on' : ''}`} aria-current={mine ? 'true' : undefined}>زياراتي</RouteLink>
            <RouteLink route={link({ mine: '0' })} className={`seg-btn${!mine ? ' is-on' : ''}`} aria-current={!mine ? 'true' : undefined}>كل الأطباء</RouteLink>
          </div>
        )}
      </div>
      <DataTable
        key={`${view}:${mineParam}`}
        label="الزيارات"
        rows={rows}
        columns={columns}
        rowKey={(v) => v.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.isError ? list.error : undefined}
        onRetry={() => void list.refetch()}
        search={{ placeholder: 'ابحث باسم المريض أو رقم الملف أو التشخيص', text: (v) => `${v.patient.full_name} ${v.patient.file_no} ${v.diagnosis ?? ''} ${arName(v.doctor.name_ar, v.doctor.name_en)}` }}
        pageSize={25}
        onRowClick={(v) => navigate(to.visit(v.id))}
        actions={(v) => (
          <RowMenu label={v.patient.full_name} actions={[
            { label: 'فتح الزيارة', icon: <StethoscopeIcon size={16} />, route: to.visit(v.id) },
            { label: 'ملف المريض', icon: <UsersIcon size={16} />, route: to.view('patients', v.patient.id) },
            { label: 'فاتورة لهذه الزيارة', icon: <ReceiptIcon size={16} />, route: to.create('invoices', { patient: v.patient.id, visit: v.id }), hidden: !canInvoice || v.unbilled === 0 },
          ]} />
        )}
        empty={{ icon: <StethoscopeIcon size={28} />, ...EMPTY[view] }}
        footer={list.hasNextPage && (
          <div className="row-center"><Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>عرض المزيد</Button></div>
        )}
      />
    </>
  );
}
