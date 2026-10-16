import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { pickName } from '@dental/ui/text';
import { api } from '../../api';
import { useLeave, useUnsavedChanges } from '../../hooks';
import { t, type Key, type Lang } from '../../i18n';
import { canAddShift, copyShifts, dayError, fromRows, nextShift, toPayload, type DayState, type Shift } from '../../hours-model';
import { useBranches, useInvalidate, useOne } from '../../queries';
import { to } from '../../router';
import type { Branch } from '../../types';
import { Alert, Card, LinkButton, Switch } from '../../ui/components';
import { CloseIcon, CopyIcon, PlusIcon } from '../../ui/icons';
import { FormPage, ResourceState } from '../../ui/page';

/** `#/branches/:id/hours` — days on/off, up to 3 shifts per day, one save replaces the week. */
export function BranchHours({ lang, clinicId, id }: { lang: Lang; clinicId: string; id: string }) {
  const one = useOne(useBranches(clinicId), id);
  if (!one.data) return <ResourceState {...one} back={to.list('branches')} backLabel={t('branches', lang)} />;
  return <HoursEditor key={id} lang={lang} clinicId={clinicId} branch={one.data} />;
}

function HoursEditor({ lang, clinicId, branch }: { lang: Lang; clinicId: string; branch: Branch }) {
  const [days, setDays] = useState<DayState[]>(() => fromRows(branch.hours));
  const [dirty, setDirty] = useState(false);
  const invalidate = useInvalidate(clinicId);
  const leave = useLeave(to.list('branches'));
  const errors = days.map(dayError);
  const hasErrors = errors.some(Boolean);
  useUnsavedChanges(dirty, t('leaveUnsaved', lang));

  const save = useMutation({
    mutationFn: () => api<Branch>(`/branches/${branch.id}/hours`, { method: 'PUT', body: JSON.stringify(toPayload(days)) }),
    onSuccess: () => invalidate('branches'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!hasErrors) save.mutate(undefined, { onSuccess: () => leave(t('hoursSaved', lang)) }); };
  const edit = (fn: (ds: DayState[]) => DayState[]) => { setDays(fn); setDirty(true); };
  const update = (i: number, fn: (d: DayState) => DayState) => edit((ds) => ds.map((d, j) => (j === i ? fn(d) : d)));
  const setShift = (i: number, k: number, patch: Partial<Shift>) =>
    update(i, (d) => ({ ...d, shifts: d.shifts.map((s, j) => (j === k ? { ...s, ...patch } : s)) }));

  const name = pickName(lang, branch.name_ar, branch.name_en, branch.slug);
  const crumbs = [{ label: t('navOverview', lang), route: to.list('overview') }, { label: t('branches', lang), route: to.list('branches') }, { label: name }, { label: t('workingHours', lang) }];
  return (
    <FormPage title={`${t('hoursFor', lang)} ${name}`} sub={t('hoursHint', lang)} crumbs={crumbs} back={to.list('branches')} onSubmit={submit}
      saving={save.isPending} canSave={!hasErrors && dirty} error={save.error} notice={hasErrors && <Alert>{t('fixErrors', lang)}</Alert>}>
      <Card>
        <ul className="week">
          {days.map((d, i) => {
            const dayName = t(`day${d.weekday}` as Key, lang);
            const err = errors[i];
            return (
              <li key={d.weekday} className={`day${d.open ? '' : ' is-closed'}${err ? ' has-error' : ''}`}>
                <div className="day-name">
                  <Switch checked={d.open} onChange={(open) => update(i, (x) => ({ ...x, open }))} label={dayName} />
                </div>
                {d.open ? (
                  <div className="shifts">
                    {d.shifts.map((s, k) => (
                      <div className="shift" key={s.id} dir="ltr">
                        <input className="input time" type="time" step={300} value={s.opens} required
                          aria-label={`${dayName} ${t('opensAt', lang)} ${k + 1}`} onChange={(e) => setShift(i, k, { opens: e.target.value })} />
                        <span className="shift-dash" aria-hidden>–</span>
                        <input className="input time" type="time" step={300} value={s.closes} required
                          aria-label={`${dayName} ${t('closesAt', lang)} ${k + 1}`} onChange={(e) => setShift(i, k, { closes: e.target.value })} />
                        {d.shifts.length > 1 && (
                          <button type="button" className="icon-btn sm" aria-label={`${t('removeShift', lang)} ${k + 1}`}
                            onClick={() => update(i, (x) => ({ ...x, shifts: x.shifts.filter((_, j) => j !== k) }))}><CloseIcon size={16} /></button>
                        )}
                      </div>
                    ))}
                    <div className="shift-actions">
                      {canAddShift(d) && (
                        <LinkButton onClick={() => update(i, (x) => ({ ...x, shifts: [...x.shifts, nextShift(x)] }))}><PlusIcon size={16} />{t('addShift', lang)}</LinkButton>
                      )}
                      <LinkButton onClick={() => edit((ds) => copyShifts(ds[i], ds))} disabled={!!err}><CopyIcon size={16} />{t('copyToAll', lang)}</LinkButton>
                    </div>
                    {err && <p className="field-error" role="alert">{t(err === 'overlap' ? 'errOverlap' : 'errOrder', lang)}</p>}
                  </div>
                ) : (
                  <span className="muted day-closed">{t('closed', lang)}</span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </FormPage>
  );
}
