import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { arName } from '@dental/ui/text';
import { api } from '../../api';
import { useLeave, useUnsavedChanges } from '../../hooks';
import { weekdayLabel } from '../../labels';
import { useBranches, useDoctors, useInvalidate, useOne } from '../../queries';
import { to } from '../../router';
import { canAddSlot, dayError, fromRows, nextSlot, toPayload, type ScheduleDay, type Slot, type SlotError } from '../../schedule-model';
import type { Branch, Doctor } from '../../types';
import { Choice } from '../../components/choice';
import { Alert, Card, LinkButton } from '../../ui/components';
import { CloseIcon, PlusIcon } from '../../ui/icons';
import { FormPage, ResourceState } from '../../ui/page';
import { TimeField } from '../../components/time-field';

const ERR_KEY: Record<NonNullable<SlotError>, string> = { order: 'وقت الإغلاق يجب أن يكون بعد الفتح', overlap: 'الفترات متداخلة', branch: 'الطبيب غير مُضاف إلى هذا الفرع.' };

/** `#/doctors/:id/schedule` — when the doctor is at each branch; one save replaces the week. */
export function DoctorSchedule({ clinicId, id }: { clinicId: string; id: string }) {
  const branches = useBranches(clinicId);
  const one = useOne(useDoctors(clinicId), id);
  if (!one.data || !branches.data) {
    return <ResourceState {...one} isLoading={one.isLoading || branches.isLoading} isError={one.isError || branches.isError} error={one.error ?? branches.error}
      refetch={() => { one.refetch(); void branches.refetch(); }} back={to.list('doctors')} backLabel="الأطباء" />;
  }
  const doctor = one.data;
  const mine = branches.data.filter((b) => b.is_active && doctor.branch_ids.includes(b.id));
  return <ScheduleEditor key={id} clinicId={clinicId} doctor={doctor} branches={mine} />;
}

function ScheduleEditor({ clinicId, doctor, branches }: { clinicId: string; doctor: Doctor; branches: Branch[] }) {
  const [days, setDays] = useState<ScheduleDay[]>(() => fromRows(doctor.schedule));
  const [dirty, setDirty] = useState(false);
  const invalidate = useInvalidate(clinicId);
  const leave = useLeave(to.list('doctors'));
  const ids = branches.map((b) => b.id);
  const errors = days.map((d) => dayError(d, ids));
  const hasErrors = errors.some(Boolean);
  useUnsavedChanges(dirty, 'لديك تغييرات غير محفوظة. هل تريد المغادرة بدون حفظ؟');

  const save = useMutation({
    mutationFn: () => api<Doctor>(`/doctors/${doctor.id}/schedule`, { method: 'PUT', body: JSON.stringify(toPayload(days)) }),
    onSuccess: () => invalidate('doctors'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!hasErrors) save.mutate(undefined, { onSuccess: () => leave('تم حفظ جدول المواعيد') }); };
  const update = (i: number, fn: (d: ScheduleDay) => ScheduleDay) => { setDays((ds) => ds.map((d, j) => (j === i ? fn(d) : d))); setDirty(true); };
  const setSlot = (i: number, k: number, patch: Partial<Slot>) => update(i, (d) => ({ ...d, slots: d.slots.map((s, j) => (j === k ? { ...s, ...patch } : s)) }));

  const name = arName(doctor.name_ar, doctor.name_en, '—');
  const crumbs = [{ label: 'نظرة عامة', route: to.list('overview') }, { label: 'الأطباء', route: to.list('doctors') }, { label: name }, { label: 'جدول المواعيد' }];
  return (
    <FormPage title={`${'جدول مواعيد'} ${name}`} sub="متى يكون الطبيب في كل فرع؟ لا يمكن أن يكون في فرعين في نفس الوقت" crumbs={crumbs} back={to.list('doctors')} onSubmit={submit}
      saving={save.isPending} canSave={!hasErrors && dirty && branches.length > 0} error={save.error} notice={hasErrors && <Alert>صحّح الأخطاء المظللة ثم احفظ</Alert>}>
      {branches.length === 0 ? <Alert tone="info">أضف الطبيب إلى فرع أولًا ليمكن جدولة مواعيده</Alert> : (
        <Card>
          <ul className="week">
            {days.map((d, i) => {
              const dayName = weekdayLabel[d.weekday];
              const err = errors[i];
              return (
                <li key={d.weekday} className={`day${d.slots.length ? '' : ' is-closed'}${err ? ' has-error' : ''}`}>
                  <div className="day-name"><strong>{dayName}</strong></div>
                  <div className="shifts">
                    {d.slots.length === 0 && <span className="muted day-closed">إجازة</span>}
                    {d.slots.map((s, k) => (
                      <div className="shift slot" key={s.id}>
                        <Choice value={s.branchId} label={`${dayName} ${'الفرع'} ${k + 1}`} className="h-10 w-full bg-card sm:w-44"
                          onChange={(v) => setSlot(i, k, { branchId: v })}
                          options={[
                            ...branches.map((b) => ({ value: b.id, label: arName(b.name_ar, b.name_en, b.slug) })),
                            ...(ids.includes(s.branchId) ? [] : [{ value: s.branchId, label: 'غير نشط', disabled: true }]),
                          ]} />
                        <span className="shift-times">
                          <TimeField value={s.starts} label={`${dayName} ${'من'} ${k + 1}`} onChange={(starts) => setSlot(i, k, { starts })} />
                          <span className="shift-dash" aria-hidden>–</span>
                          <TimeField value={s.ends} label={`${dayName} ${'إلى'} ${k + 1}`} onChange={(ends) => setSlot(i, k, { ends })} />
                        </span>
                        <button type="button" className="icon-btn sm" aria-label={`${'حذف الفترة'} ${k + 1}`}
                          onClick={() => update(i, (x) => ({ ...x, slots: x.slots.filter((_, j) => j !== k) }))}><CloseIcon size={16} /></button>
                      </div>
                    ))}
                    <div className="shift-actions">
                      {canAddSlot(d) && (
                        <LinkButton onClick={() => update(i, (x) => ({ ...x, slots: [...x.slots, nextSlot(x, branches[0].id)] }))}><PlusIcon size={16} />إضافة فترة</LinkButton>
                      )}
                    </div>
                    {err && <p className="field-error" role="alert">{ERR_KEY[err]}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </FormPage>
  );
}
