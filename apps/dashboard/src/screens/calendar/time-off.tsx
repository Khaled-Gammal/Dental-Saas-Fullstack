import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { arName } from '@dental/ui/text';
import { api } from '../../api';
import { DatePicker } from '../../components/date-picker';
import { calendarKeys, keys, useDoctors, useOne, useTimeOff } from '../../queries';
import { to } from '../../router';
import type { CalendarConflict, TimeOff } from '../../types';
import { Button, Card, ErrorText, Field, Input, PageHeader } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { DataTable } from '../../ui/data-table';
import { RowMenu } from '../../ui/row-menu';
import { CalendarIcon } from '../../ui/icons';
import { Breadcrumbs, ResourceState } from '../../ui/page';
import { zonedToUtc } from '../../util';
import { Conflicts } from './conflicts';
import { TimeField } from '../../components/time-field';

const loc = () => ('ar-EG-u-nu-latn');
const TZ = 'Africa/Cairo'; // the clinic's zone (branches default to it); the API stores instants

/** `#/doctors/<id>/timeoff`: a doctor's leave (SRS APPT-005). No times can be booked with them during it. */
export function DoctorTimeOff({ clinicId, id, canWrite }: { clinicId: string; id?: string; canWrite: boolean }) {
  const one = useOne(useDoctors(clinicId), id);
  const list = useTimeOff(clinicId, id);
  const qc = useQueryClient();
  const today = new Date().toLocaleDateString('en-CA');
  const [from, setFrom] = useState({ date: today, time: '00:00' });
  const [until, setUntil] = useState({ date: today, time: '23:59' });
  const [reason, setReason] = useState('');
  const [conflicts, setConflicts] = useState<CalendarConflict[] | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: calendarKeys.timeOff(clinicId, id ?? '') }), qc.invalidateQueries({ queryKey: keys.appointments(clinicId) })]);
  const instant = (v: { date: string; time: string }) => new Date(zonedToUtc(v.date, v.time, TZ)).toISOString();
  const add = useMutation({
    mutationFn: () => api<{ timeOff: TimeOff; conflicts: CalendarConflict[] }>(`/doctors/${id}/time-off`, {
      method: 'POST', body: JSON.stringify({ startsAt: instant(from), endsAt: instant(until), reason: reason.trim() || null }),
    }),
    onSuccess: (r) => { setConflicts(r.conflicts); setReason(''); void refresh(); },
  });
  const remove = useMutation({ mutationFn: (offId: string) => api(`/doctors/${id}/time-off/${offId}`, { method: 'DELETE' }), onSuccess: () => void refresh() });
  const [removing, setRemoving] = useState<TimeOff | null>(null); // U2: removing leave asks first (the doctor becomes bookable again)
  if (!one.data) return <ResourceState {...one} back={to.list('doctors')} backLabel="الأطباء" />;
  const name = arName(one.data.name_ar, one.data.name_en, '—');
  const fmt = (iso: string) => new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }).format(new Date(iso));
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate(); };

  return (
    <>
      <Breadcrumbs items={[{ label: 'نظرة عامة', route: to.list('overview') }, { label: 'الأطباء', route: to.list('doctors') }, { label: name }]} />
      <PageHeader title={<>إجازات الطبيب · <bdi>{name}</bdi></>} sub="لا تظهر مواعيد للحجز مع الطبيب خلالها." />
      {canWrite && (
        <Card>
          <h2>إضافة إجازة</h2>
          <form onSubmit={submit} className="grid-2 mt">
            <Field label="من">{(a) => <DatePicker id={a.id} value={from.date} onChange={(d) => setFrom((f) => ({ ...f, date: d }))} min={today} />}</Field>
            <Field label="الوقت">{(a) => <TimeField id={a.id} value={from.time} onChange={(time) => setFrom((f) => ({ ...f, time }))} />}</Field>
            <Field label="إلى">{(a) => <DatePicker id={a.id} value={until.date} onChange={(d) => setUntil((u) => ({ ...u, date: d }))} min={from.date} />}</Field>
            <Field label="الوقت">{(a) => <TimeField id={a.id} value={until.time} onChange={(time) => setUntil((u) => ({ ...u, time }))} />}</Field>
            <Field label="السبب" optional="اختياري">{(a) => <Input id={a.id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
            <div className="row-end"><Button type="submit" loading={add.isPending}>إضافة إجازة</Button></div>
          </form>
          <ErrorText error={add.error} />
          {conflicts && <Conflicts items={conflicts} />}
        </Card>
      )}
      <DataTable
        label="إجازات الطبيب"
        rows={list.data}
        columns={[
          { id: 'period', header: 'الفترة', sortValue: (o) => o.starts_at, cell: (o) => <bdi dir="ltr" className="whitespace-nowrap font-semibold">{fmt(o.starts_at)} – {fmt(o.ends_at)}</bdi> },
          { id: 'reason', header: 'السبب', cell: (o) => (o.reason ? <bdi>{o.reason}</bdi> : <span className="muted">—</span>) },
        ]}
        rowKey={(o) => o.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching || remove.isPending}
        error={list.isError ? list.error : undefined}
        onRetry={() => void list.refetch()}
        defaultSort={{ id: 'period', dir: 'asc' }}
        actions={canWrite ? (o) => <RowMenu label={fmt(o.starts_at)} actions={[{ label: 'إزالة', destructive: true, onSelect: () => setRemoving(o) }]} /> : undefined}
        empty={{ icon: <CalendarIcon size={28} />, title: 'لا توجد إجازات قادمة.', text: 'لا تظهر مواعيد للحجز مع الطبيب خلالها.' }}
      />
      <ErrorText error={remove.error} />
      <ConfirmDialog open={!!removing} title="حذف الإجازة" confirmLabel="إزالة" danger
        onConfirm={() => { if (removing) remove.mutate(removing.id); setRemoving(null); }} onCancel={() => setRemoving(null)}>
        سيعود الطبيب متاحًا للحجز في هذه الفترة.
      </ConfirmDialog>
    </>
  );
}
