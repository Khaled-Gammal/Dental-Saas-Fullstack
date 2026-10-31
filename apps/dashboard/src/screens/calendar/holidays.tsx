import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { arName } from '@dental/ui/text';
import { api } from '../../api';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { calendarKeys, keys, useBranches, useHolidays } from '../../queries';
import type { CalendarConflict, Holiday } from '../../types';
import { Badge, Button, Card, ErrorText, Field, Input, PageHeader } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { DataTable } from '../../ui/data-table';
import { RowMenu } from '../../ui/row-menu';
import { CalendarIcon } from '../../ui/icons';
import { Conflicts } from './conflicts';
import { clinicToday, LOC } from '../../util';

const ALL = '';

/** `#/holidays`: closed days for the whole clinic or one branch (SRS APPT-005). Reception can see them; the owner edits. */
export function Holidays({ clinicId, canWrite }: { clinicId: string; canWrite: boolean }) {
  const holidays = useHolidays(clinicId);
  const branches = useBranches(clinicId).data ?? [];
  const qc = useQueryClient();
  const [date, setDate] = useState('');
  const [branchId, setBranchId] = useState(ALL);
  const [name, setName] = useState('');
  const [conflicts, setConflicts] = useState<CalendarConflict[] | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: calendarKeys.holidays(clinicId) }), qc.invalidateQueries({ queryKey: keys.appointments(clinicId) })]);
  const add = useMutation({
    mutationFn: () => api<{ holiday: Holiday; conflicts: CalendarConflict[] }>('/holidays', { method: 'POST', body: JSON.stringify({ branchId: branchId || null, date, name: name.trim() }) }),
    onSuccess: (r) => { setConflicts(r.conflicts); setName(''); void refresh(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/holidays/${id}`, { method: 'DELETE' }), onSuccess: () => void refresh() });
  const [removing, setRemoving] = useState<Holiday | null>(null); // U2: removing a closed day asks first (it reopens the day for booking)
  const submit = (e: FormEvent) => { e.preventDefault(); if (date && name.trim()) add.mutate(); };
  const branchName = (id: string | null) => (id ? arName(branches.find((b) => b.id === id)?.name_ar ?? null, branches.find((b) => b.id === id)?.name_en ?? null, '—') : 'كل الفروع');
  const fmtDate = (d: string) => new Intl.DateTimeFormat(LOC, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

  return (
    <>
      <PageHeader title="الإجازات والعطلات" sub="أيام تُغلق فيها العيادة كلها أو فرع واحد. لا تظهر فيها مواعيد للحجز." />
      {canWrite && (
        <Card>
          <h2>إضافة يوم إجازة</h2>
          <form onSubmit={submit} className="grid-2 mt">
            <Field label="التاريخ">{(a) => <DatePicker id={a.id} value={date} onChange={setDate} min={clinicToday()} />}</Field>
            <Field label="الفرع">
              {(a) => <Choice id={a.id} value={branchId} onChange={setBranchId} noneLabel="كل الفروع"
                options={branches.filter((b) => b.is_active).map((b) => ({ value: b.id, label: arName(b.name_ar, b.name_en, b.slug) }))} />}
            </Field>
            <Field label="المناسبة">{(a) => <Input id={a.id} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />}</Field>
            <div className="row-end"><Button type="submit" loading={add.isPending} disabled={!date || !name.trim()}>إضافة يوم إجازة</Button></div>
          </form>
          <ErrorText error={add.error} />
          {conflicts && <Conflicts items={conflicts} />}
        </Card>
      )}
      <h2 className="section-title mt">الإجازات</h2>
      <DataTable
        label="الإجازات والعطلات"
        rows={holidays.data}
        columns={[
          { id: 'name', header: 'المناسبة', sortValue: (h) => h.name, cell: (h) => <strong><bdi>{h.name}</bdi></strong> },
          { id: 'date', header: 'التاريخ', sortValue: (h) => h.date, cell: (h) => <span className="whitespace-nowrap">{fmtDate(h.date)}</span> },
          { id: 'branch', header: 'الفرع', sortValue: (h) => branchName(h.branch_id), cell: (h) => <Badge>{branchName(h.branch_id)}</Badge> },
        ]}
        rowKey={(h) => h.id}
        isLoading={holidays.isLoading}
        isFetching={holidays.isFetching || remove.isPending}
        error={holidays.isError ? holidays.error : undefined}
        onRetry={() => void holidays.refetch()}
        defaultSort={{ id: 'date', dir: 'asc' }}
        actions={canWrite ? (h) => <RowMenu label={h.name} actions={[{ label: 'إزالة', destructive: true, onSelect: () => setRemoving(h) }]} /> : undefined}
        empty={{ icon: <CalendarIcon size={28} />, title: 'لا توجد إجازات قادمة.', text: 'أيام تُغلق فيها العيادة كلها أو فرع واحد. لا تظهر فيها مواعيد للحجز.' }}
      />
      <ErrorText error={remove.error} />
      <ConfirmDialog open={!!removing} title="حذف يوم الإجازة" confirmLabel="إزالة" danger
        onConfirm={() => { if (removing) remove.mutate(removing.id); setRemoving(null); }} onCancel={() => setRemoving(null)}>
        سيعود هذا اليوم متاحًا للحجز.
      </ConfirmDialog>
    </>
  );
}
