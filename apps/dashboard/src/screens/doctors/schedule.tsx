import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { arName } from '@dental/ui/text';
import { api } from '../../api';
import { useLeave, useUnsavedChanges } from '../../hooks';
import { t, type Key } from '../../i18n';
import { useBranches, useDoctors, useInvalidate, useOne } from '../../queries';
import { to } from '../../router';
import { canAddSlot, dayError, fromRows, nextSlot, toPayload, type ScheduleDay, type Slot, type SlotError } from '../../schedule-model';
import type { Branch, Doctor } from '../../types';
import { Alert, Card, LinkButton } from '../../ui/components';
import { CloseIcon, PlusIcon } from '../../ui/icons';
import { FormPage, ResourceState } from '../../ui/page';

const ERR_KEY: Record<NonNullable<SlotError>, Key> = { order: 'errOrder', overlap: 'errOverlap', branch: 'err_branch_not_assigned' };

/** `#/doctors/:id/schedule` — when the doctor is at each branch; one save replaces the week. */
export function DoctorSchedule({ clinicId, id }: { clinicId: string; id: string }) {
  const branches = useBranches(clinicId);
  const one = useOne(useDoctors(clinicId), id);
  if (!one.data || !branches.data) {
    return <ResourceState {...one} isLoading={one.isLoading || branches.isLoading} isError={one.isError || branches.isError} error={one.error ?? branches.error}
      refetch={() => { one.refetch(); void branches.refetch(); }} back={to.list('doctors')} backLabel={t('navDoctors')} />;
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
  useUnsavedChanges(dirty, t('leaveUnsaved'));

  const save = useMutation({
    mutationFn: () => api<Doctor>(`/doctors/${doctor.id}/schedule`, { method: 'PUT', body: JSON.stringify(toPayload(days)) }),
    onSuccess: () => invalidate('doctors'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!hasErrors) save.mutate(undefined, { onSuccess: () => leave(t('scheduleSaved')) }); };
  const update = (i: number, fn: (d: ScheduleDay) => ScheduleDay) => { setDays((ds) => ds.map((d, j) => (j === i ? fn(d) : d))); setDirty(true); };
  const setSlot = (i: number, k: number, patch: Partial<Slot>) => update(i, (d) => ({ ...d, slots: d.slots.map((s, j) => (j === k ? { ...s, ...patch } : s)) }));

  const name = arName(doctor.name_ar, doctor.name_en, '—');
  const crumbs = [{ label: t('navOverview'), route: to.list('overview') }, { label: t('navDoctors'), route: to.list('doctors') }, { label: name }, { label: t('schedule') }];
  return (
    <FormPage title={`${t('scheduleFor')} ${name}`} sub={t('scheduleHint')} crumbs={crumbs} back={to.list('doctors')} onSubmit={submit}
      saving={save.isPending} canSave={!hasErrors && dirty && branches.length > 0} error={save.error} notice={hasErrors && <Alert>{t('fixErrors')}</Alert>}>
      {branches.length === 0 ? <Alert tone="info">{t('noBranchesForDoctor')}</Alert> : (
        <Card>
          <ul className="week">
            {days.map((d, i) => {
              const dayName = t(`day${d.weekday}` as Key);
              const err = errors[i];
              return (
                <li key={d.weekday} className={`day${d.slots.length ? '' : ' is-closed'}${err ? ' has-error' : ''}`}>
                  <div className="day-name"><strong>{dayName}</strong></div>
                  <div className="shifts">
                    {d.slots.length === 0 && <span className="muted day-closed">{t('dayOff')}</span>}
                    {d.slots.map((s, k) => (
                      <div className="shift slot" key={s.id}>
                        <select className="input slot-branch" value={s.branchId} aria-label={`${dayName} ${t('branch')} ${k + 1}`}
                          onChange={(e) => setSlot(i, k, { branchId: e.target.value })}>
                          {branches.map((b) => <option key={b.id} value={b.id}>{arName(b.name_ar, b.name_en, b.slug)}</option>)}
                          {!ids.includes(s.branchId) && <option value={s.branchId} disabled>{t('inactive')}</option>}
                        </select>
                        <span className="shift-times" dir="ltr">
                          <input className="input time" type="time" step={300} value={s.starts} required
                            aria-label={`${dayName} ${t('opensAt')} ${k + 1}`} onChange={(e) => setSlot(i, k, { starts: e.target.value })} />
                          <span className="shift-dash" aria-hidden>–</span>
                          <input className="input time" type="time" step={300} value={s.ends} required
                            aria-label={`${dayName} ${t('closesAt')} ${k + 1}`} onChange={(e) => setSlot(i, k, { ends: e.target.value })} />
                        </span>
                        <button type="button" className="icon-btn sm" aria-label={`${t('removeSlot')} ${k + 1}`}
                          onClick={() => update(i, (x) => ({ ...x, slots: x.slots.filter((_, j) => j !== k) }))}><CloseIcon size={16} /></button>
                      </div>
                    ))}
                    <div className="shift-actions">
                      {canAddSlot(d) && (
                        <LinkButton onClick={() => update(i, (x) => ({ ...x, slots: [...x.slots, nextSlot(x, branches[0].id)] }))}><PlusIcon size={16} />{t('addSlot')}</LinkButton>
                      )}
                    </div>
                    {err && <p className="field-error" role="alert">{t(ERR_KEY[err])}</p>}
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
