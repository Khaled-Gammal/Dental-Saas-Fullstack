import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { arName } from '@dental/ui/text';
import { api } from '../../api';
import { useLeave, useUnsavedChanges } from '../../hooks';
import { weekdayLabel } from '../../labels';
import { canAddShift, copyShifts, dayError, fromRows, nextShift, toPayload, type DayState, type Shift } from '../../hours-model';
import { useBranches, useInvalidate, useOne } from '../../queries';
import { to } from '../../router';
import type { Branch } from '../../types';
import { Alert, Card, LinkButton, Switch } from '../../ui/components';
import { CloseIcon, CopyIcon, PlusIcon } from '../../ui/icons';
import { FormPage, ResourceState } from '../../ui/page';
import { TimeField } from '../../components/time-field';

/** `#/branches/:id/hours` — days on/off, up to 3 shifts per day, one save replaces the week. */
export function BranchHours({ clinicId, id }: { clinicId: string; id: string }) {
  const one = useOne(useBranches(clinicId), id);
  if (!one.data) return <ResourceState {...one} back={to.list('branches')} backLabel="الفروع" />;
  return <HoursEditor key={id} clinicId={clinicId} branch={one.data} />;
}

function HoursEditor({ clinicId, branch }: { clinicId: string; branch: Branch }) {
  const [days, setDays] = useState<DayState[]>(() => fromRows(branch.hours));
  const [dirty, setDirty] = useState(false);
  const invalidate = useInvalidate(clinicId);
  const leave = useLeave(to.list('branches'));
  const errors = days.map(dayError);
  const hasErrors = errors.some(Boolean);
  useUnsavedChanges(dirty, 'لديك تغييرات غير محفوظة. هل تريد المغادرة بدون حفظ؟');

  const save = useMutation({
    mutationFn: () => api<Branch>(`/branches/${branch.id}/hours`, { method: 'PUT', body: JSON.stringify(toPayload(days)) }),
    onSuccess: () => invalidate('branches'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!hasErrors) save.mutate(undefined, { onSuccess: () => leave('تم حفظ مواعيد العمل') }); };
  const edit = (fn: (ds: DayState[]) => DayState[]) => { setDays(fn); setDirty(true); };
  const update = (i: number, fn: (d: DayState) => DayState) => edit((ds) => ds.map((d, j) => (j === i ? fn(d) : d)));
  const setShift = (i: number, k: number, patch: Partial<Shift>) =>
    update(i, (d) => ({ ...d, shifts: d.shifts.map((s, j) => (j === k ? { ...s, ...patch } : s)) }));

  const name = arName(branch.name_ar, branch.name_en, branch.slug);
  const crumbs = [{ label: 'نظرة عامة', route: to.list('overview') }, { label: 'الفروع', route: to.list('branches') }, { label: name }, { label: 'مواعيد العمل' }];
  return (
    <FormPage title={`${'مواعيد عمل'} ${name}`} sub="فعّل أيام العمل وأضف حتى 3 فترات في اليوم (مثل 10–2 و5–10)" crumbs={crumbs} back={to.list('branches')} onSubmit={submit}
      saving={save.isPending} canSave={!hasErrors && dirty} error={save.error} notice={hasErrors && <Alert>صحّح الأخطاء المظللة ثم احفظ</Alert>}>
      <Card>
        <ul className="week">
          {days.map((d, i) => {
            const dayName = weekdayLabel[d.weekday];
            const err = errors[i];
            return (
              <li key={d.weekday} className={`day${d.open ? '' : ' is-closed'}${err ? ' has-error' : ''}`}>
                <div className="day-name">
                  <Switch checked={d.open} onChange={(open) => update(i, (x) => ({ ...x, open }))} label={dayName} />
                </div>
                {d.open ? (
                  <div className="shifts">
                    {d.shifts.map((s, k) => (
                      <div className="shift" key={s.id}>
                        <TimeField value={s.opens} label={`${dayName} ${'من'} ${k + 1}`} onChange={(opens) => setShift(i, k, { opens })} />
                        <span className="shift-dash" aria-hidden>–</span>
                        <TimeField value={s.closes} label={`${dayName} ${'إلى'} ${k + 1}`} onChange={(closes) => setShift(i, k, { closes })} />
                        {d.shifts.length > 1 && (
                          <button type="button" className="icon-btn sm" aria-label={`${'حذف الفترة'} ${k + 1}`}
                            onClick={() => update(i, (x) => ({ ...x, shifts: x.shifts.filter((_, j) => j !== k) }))}><CloseIcon size={16} /></button>
                        )}
                      </div>
                    ))}
                    <div className="shift-actions">
                      {canAddShift(d) && (
                        <LinkButton onClick={() => update(i, (x) => ({ ...x, shifts: [...x.shifts, nextShift(x)] }))}><PlusIcon size={16} />إضافة فترة</LinkButton>
                      )}
                      <LinkButton onClick={() => edit((ds) => copyShifts(ds[i], ds))} disabled={!!err}><CopyIcon size={16} />نسخ لكل الأيام المفتوحة</LinkButton>
                    </div>
                    {err && <p className="field-error" role="alert">{err === 'overlap' ? 'الفترات متداخلة' : 'وقت الإغلاق يجب أن يكون بعد الفتح'}</p>}
                  </div>
                ) : (
                  <span className="muted day-closed">مغلق</span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </FormPage>
  );
}
