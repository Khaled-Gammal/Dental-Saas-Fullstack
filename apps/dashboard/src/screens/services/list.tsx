import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { arName } from '@dental/ui/text';
import { api } from '../../api';
import { navigate, useFlash } from '../../hooks';
import { minutesLabel } from '../../labels';
import { useInvalidate, useServices } from '../../queries';
import { to } from '../../router';
import { priceParts } from '../../service-model';
import type { Service } from '../../types';
import { Alert, Badge, Button, ErrorText, PageHeader } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { DataTable, type Column } from '../../ui/data-table';
import { EditIcon, PlusIcon, TagIcon } from '../../ui/icons';
import { fmtNumber } from '../../util';
import { currencyLabel } from '../../money';
import { RowMenu } from '../../ui/row-menu';

export const priceLabel = (s: Pick<Service, 'price_minor' | 'price_max_minor'>) => {
  const p = priceParts(s, (n) => fmtNumber(n));
  return p ? `${p} ${currencyLabel()}` : 'حسب الكشف';
};

const serviceName = (s: Service) => arName(s.name_ar, s.name_en, s.catalog_code ?? '—');

/** The price list's columns: the price shown is the same label the website and the booking page use. */
const SERVICE_COLUMNS: Column<Service>[] = [
  {
    id: 'name', header: 'الخدمة', sortValue: serviceName,
    cell: (s) => <strong className={s.is_active ? undefined : 'muted'}><bdi>{serviceName(s)}</bdi></strong>,
  },
  { id: 'duration', header: 'المدة', numeric: true, hideOnMobile: true, sortValue: (s) => s.duration_minutes, cell: (s) => <>{fmtNumber(s.duration_minutes)} {minutesLabel(s.duration_minutes)}</> },
  {
    id: 'state', header: 'الحالة', hideOnMobile: true, sortValue: (s) => (s.is_active ? (s.show_on_website ? 0 : 1) : 2),
    cell: (s) => (!s.is_active ? <Badge dot>غير نشط</Badge> : !s.show_on_website ? <Badge tone="warning" dot>مخفي من الموقع</Badge> : <Badge tone="success" dot>يظهر على الموقع</Badge>),
  },
  // ltr: "2,500–4,000" keeps its order inside Arabic text
  { id: 'price', header: 'السعر', numeric: true, sortValue: (s) => s.price_minor, cell: (s) => <bdi dir="ltr" className="whitespace-nowrap font-semibold">{priceLabel(s)}</bdi> },
];

/** `#/services` — the clinic's own price list: it types its services and can delete them (owner 2026-10-21). */
export function ServicesList({ clinicId, canWrite }: { clinicId: string; canWrite: boolean }) {
  const flash = useFlash();
  const services = useServices(clinicId);
  const invalidate = useInvalidate(clinicId);
  const [removing, setRemoving] = useState<Service | null>(null);
  // the API deletes a never-used service and hides a used one; either way it leaves the list, the website and booking
  const remove = useMutation({ mutationFn: (id: string) => api(`/services/${id}`, { method: 'DELETE' }), onSuccess: () => void invalidate('services') });
  const count = services.data?.length ?? 0;
  const addBtn = canWrite && <Button onClick={() => navigate(to.create('services'))}><PlusIcon size={18} />إضافة خدمة</Button>;

  return (
    <>
      <PageHeader title="الخدمات والأسعار" sub="قائمة خدماتك وأسعارها كما تظهر على موقعك" action={count > 0 ? addBtn : undefined} />
      {flash && <Alert tone="success">{flash}</Alert>}
      <ErrorText error={remove.error} />

      {/* the clinic's own order (as on the website) until a header is clicked (redesign R4) */}
      <DataTable
        label="الخدمات والأسعار"
        rows={services.data}
        columns={SERVICE_COLUMNS}
        rowKey={(s) => s.id}
        isLoading={services.isLoading}
        isFetching={services.isFetching || remove.isPending}
        error={services.isError ? services.error : undefined}
        onRetry={() => void services.refetch()}
        search={{ placeholder: 'ابحث باسم الخدمة', text: (s) => [s.name_ar, s.name_en].filter(Boolean).join(' ') }}
        pageSize={50}
        actions={canWrite ? (s) => (
          <RowMenu label={serviceName(s)} actions={[
            { label: 'تعديل', icon: <EditIcon size={16} />, route: to.edit('services', s.id) },
            { label: 'حذف', icon: <Trash2 className="size-4" aria-hidden />, destructive: true, onSelect: () => setRemoving(s) },
          ]} />
        ) : undefined}
        onRowClick={canWrite ? (s) => navigate(to.edit('services', s.id)) : undefined}
        empty={{ icon: <TagIcon size={28} />, title: 'لا توجد خدمات بعد', text: 'أضف خدمات عيادتك وأسعارها لتظهر على موقعك ويمكن حجزها', action: addBtn || undefined }}
      />

      <ConfirmDialog open={!!removing} title="حذف الخدمة؟" confirmLabel="حذف" danger
        onConfirm={() => { if (removing) remove.mutate(removing.id); setRemoving(null); }} onCancel={() => setRemoving(null)}>
        {/* one span: the dialog lays out each child on its own line */}
        <span>ستُحذف «<bdi>{removing ? serviceName(removing) : ''}</bdi>» من قائمة أسعارك ومن موقعك ولن يمكن حجزها. المواعيد والزيارات والفواتير السابقة تبقى كما هي.</span>
      </ConfirmDialog>
    </>
  );
}
