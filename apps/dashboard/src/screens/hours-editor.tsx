import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { pickName } from '@dental/ui/text';
import { api } from '../api';
import { t, type Key, type Lang } from '../i18n';
import { canAddShift, copyShifts, dayError, fromRows, nextShift, toPayload, type DayState, type Shift } from '../hours-model';
import { useInvalidate } from '../queries';
import type { Branch } from '../types';
import { Alert, Button, Card, ErrorText, LinkButton, Switch } from '../ui/components';
import { CloseIcon, CopyIcon, PlusIcon } from '../ui/icons';

/** Weekly hours for one branch: days on/off, up to 3 shifts per day, one save replaces the week. */
export function HoursEditor({ lang, clinicId, branch, onDone, id }: { lang: Lang; clinicId: string; branch: Branch; onDone: () => void; id: string }) {
  const [days, setDays] = useState<DayState[]>(() => fromRows(branch.hours));
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []); // the editor opens above the list: take the user to it
  const invalidate = useInvalidate(clinicId);
  const errors = days.map(dayError);
  const hasErrors = errors.some(Boolean);

  const save = useMutation({
    mutationFn: () => api<Branch>(`/branches/${branch.id}/hours`, { method: 'PUT', body: JSON.stringify(toPayload(days)) }),
    onSuccess: async () => { await invalidate('branches'); onDone(); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!hasErrors) save.mutate(); };

  const update = (i: number, fn: (d: DayState) => DayState) => setDays((ds) => ds.map((d, j) => (j === i ? fn(d) : d)));
  const setShift = (i: number, k: number, patch: Partial<Shift>) =>
    update(i, (d) => ({ ...d, shifts: d.shifts.map((s, j) => (j === k ? { ...s, ...patch } : s)) }));
  const copyToAll = (i: number) => setDays((ds) => copyShifts(ds[i], ds));

  return (
    <Card className="hours-card" id={id}>
      <div className="hours-head">
        <div>
          <h2 ref={title} tabIndex={-1}>{t('hoursFor', lang)} <bdi>{pickName(lang, branch.name_ar, branch.name_en, branch.slug)}</bdi></h2>
          <p className="muted small">{t('hoursHint', lang)}</p>
        </div>
        <button type="button" className="icon-btn" onClick={onDone} aria-label={t('cancel', lang)}><CloseIcon /></button>
      </div>

      <form onSubmit={submit}>
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
                      <LinkButton onClick={() => copyToAll(i)} disabled={!!err}><CopyIcon size={16} />{t('copyToAll', lang)}</LinkButton>
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

        {hasErrors && <Alert>{t('fixErrors', lang)}</Alert>}
        <ErrorText error={save.error} />
        <div className="row-end mt">
          <Button variant="ghost" onClick={onDone}>{t('cancel', lang)}</Button>
          <Button type="submit" loading={save.isPending} disabled={hasErrors}>{t('save', lang)}</Button>
        </div>
      </form>
    </Card>
  );
}
