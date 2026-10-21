import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { arName } from '@dental/ui/text';
import { api } from '../../api';
import { calendarKeys, useBranches, useOne, useRooms } from '../../queries';
import { to } from '../../router';
import type { Room } from '../../types';
import { Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, Skeleton, Switch } from '../../ui/components';
import { ListIcon } from '../../ui/icons';
import { Breadcrumbs, ResourceState } from '../../ui/page';

/** `#/branches/<id>/rooms`: chairs and rooms of a branch (SRS APPT-006). Deactivated, never deleted (bookings point at them). */
export function BranchRooms({ clinicId, id, canWrite }: { clinicId: string; id?: string; canWrite: boolean }) {
  const one = useOne(useBranches(clinicId), id);
  const rooms = useRooms(clinicId, id);
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: calendarKeys.rooms(clinicId, id ?? '') });
  const add = useMutation({
    mutationFn: () => api<Room>(`/branches/${id}/rooms`, { method: 'POST', body: JSON.stringify({ name: name.trim() }) }),
    onSuccess: () => { setName(''); void refresh(); },
  });
  const toggle = useMutation({
    mutationFn: (r: Room) => api<Room>(`/rooms/${r.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !r.is_active }) }),
    onSuccess: () => void refresh(),
  });
  if (!one.data) return <ResourceState {...one} back={to.list('branches')} backLabel="الفروع" />;
  const branchName = arName(one.data.name_ar, one.data.name_en, one.data.slug);
  const submit = (e: FormEvent) => { e.preventDefault(); if (name.trim()) add.mutate(); };

  return (
    <>
      <Breadcrumbs items={[{ label: 'نظرة عامة', route: to.list('overview') }, { label: 'الفروع', route: to.list('branches') }, { label: branchName }]} />
      <PageHeader title={<>الكراسي والغرف · <bdi>{branchName}</bdi></>} sub="تُحدَّد للمواعيد، ولا يُحجز الكرسي لموعدين في نفس الوقت." />
      {canWrite && (
        <Card>
          <form onSubmit={submit} className="row-between">
            <Field label="اسم الكرسي أو الغرفة">{(a) => <Input id={a.id} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />}</Field>
            <Button type="submit" loading={add.isPending} disabled={!name.trim()}>إضافة</Button>
          </form>
          <ErrorText error={add.error} />
        </Card>
      )}
      {rooms.isError ? <ErrorText error={rooms.error} onRetry={() => void rooms.refetch()} />
        : rooms.isLoading ? <Skeleton h={56} count={2} />
        : !rooms.data?.length ? <Card><EmptyState icon={<ListIcon size={28} />} title="لا توجد كراسي بعد." text="تُحدَّد للمواعيد، ولا يُحجز الكرسي لموعدين في نفس الوقت." /></Card>
        : (
          <ul className="patient-rows mt">
            {rooms.data.map((r) => (
              <Card as="li" key={r.id} className={`patient-row${r.is_active ? '' : ' is-inactive'}`}>
                <span className="patient-main"><span className="patient-text"><strong><bdi>{r.name}</bdi></strong></span></span>
                {canWrite ? <Switch checked={r.is_active} onChange={() => toggle.mutate(r)} label="متاح للحجز" />
                  : !r.is_active && <span className="muted">غير نشط</span>}
              </Card>
            ))}
          </ul>
        )}
      <ErrorText error={toggle.error} />
    </>
  );
}
