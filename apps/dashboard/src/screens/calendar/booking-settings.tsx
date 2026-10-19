import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { bookingPatch, MAX_REMINDERS, REMINDER_CHOICES, toggleReminder } from '../../calendar-model';
import { Choice } from '../../components/choice';
import { useFlash, useUnsavedChanges } from '../../hooks';
import { t, type Key } from '../../i18n';
import { calendarKeys, useBookingSettings } from '../../queries';
import type { BookingSettings } from '../../types';
import { Alert, Button, Card, ErrorText, Field, Input, PageHeader, Skeleton, Switch } from '../../ui/components';

const STEPS = [5, 10, 15, 20, 30, 60];

/** One reminder offset as words: the fixed choices have exact Arabic wording, anything else falls back to minutes. */
export function reminderLabel(minutes: number): string {
  const key = `rem_${minutes}`;
  if ((REMINDER_CHOICES as readonly number[]).includes(minutes)) return t(key as Key);
  return t('remMinutes').replace('{n}', String(minutes));
}

/** `#/booking`: the website booking rules and email reminders (SRS APPT-009). Read by every member; edited by the owner. */
export function BookingRules({ clinicId, canWrite }: { clinicId: string; canWrite: boolean }) {
  const settings = useBookingSettings(clinicId);
  if (settings.isError) return <ErrorText error={settings.error} onRetry={() => void settings.refetch()} />;
  if (!settings.data) return <Skeleton h={120} count={3} />;
  return <RulesForm key={JSON.stringify(settings.data)} clinicId={clinicId} orig={settings.data} canWrite={canWrite} />;
}

function RulesForm({ clinicId, orig, canWrite }: { clinicId: string; orig: BookingSettings; canWrite: boolean }) {
  const [form, setForm] = useState(orig);
  const [saved, setSaved] = useState(false);
  const flash = useFlash();
  const qc = useQueryClient();
  const patch = bookingPatch(orig, form);
  const dirty = Object.keys(patch).length > 0;
  useUnsavedChanges(dirty, t('leaveUnsaved'));
  const set = <K extends keyof BookingSettings>(k: K) => (v: BookingSettings[K]) => { setSaved(false); setForm((f) => ({ ...f, [k]: v })); };
  const save = useMutation({
    mutationFn: () => api<BookingSettings>('/clinic/booking-settings', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: (s) => { qc.setQueryData(calendarKeys.booking(clinicId), s); setSaved(true); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (dirty) save.mutate(); };
  const hours = Math.round(form.minNoticeMinutes / 60);
  // a stored offset that is not one of the choices still shows (and can be removed)
  const choices = [...new Set([...REMINDER_CHOICES, ...form.reminderOffsetsMinutes])].sort((a, b) => b - a);

  return (
    <form onSubmit={submit}>
      <PageHeader title={t('bookingTitle')} sub={t('bookingSub')}
        action={canWrite ? <Button type="submit" loading={save.isPending} disabled={!dirty}>{t('save')}</Button> : undefined} />
      {(saved || flash) && <Alert tone="success">{saved ? t('bookingSaved') : flash}</Alert>}
      <ErrorText error={save.error} />
      <fieldset disabled={!canWrite} className="stack">
        <Card>
          <div className="switch-row">
            <Switch checked={form.autoConfirm} onChange={set('autoConfirm')} label={t('autoConfirmLabel')} />
            <Switch checked={form.otpRequired} onChange={set('otpRequired')} label={t('otpLabel')} />
          </div>
        </Card>
        <Card>
          <div className="grid-2">
            <Field label={t('minNoticeLabel')}>
              {(a) => <Input id={a.id} type="number" dir="ltr" min={0} max={168} value={hours} onChange={(e) => set('minNoticeMinutes')(Math.max(0, Math.min(168, Number(e.target.value) || 0)) * 60)} />}
            </Field>
            <Field label={t('maxDaysLabel')}>
              {(a) => <Input id={a.id} type="number" dir="ltr" min={1} max={365} value={form.maxDaysAhead} onChange={(e) => set('maxDaysAhead')(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} />}
            </Field>
            <Field label={t('slotStepLabel')}>
              {(a) => <Choice id={a.id} value={String(form.slotStepMinutes)} onChange={(v) => set('slotStepMinutes')(Number(v))}
                options={STEPS.map((s) => ({ value: String(s), label: `${s} ${t('minutes')}` }))} />}
            </Field>
          </div>
        </Card>
        <Card>
          <fieldset className="check-group">
            <legend>{t('remindersLabel')}</legend>
            <p className="muted small">{t('remindersHint')}</p>
            <div className="branch-checks">
              {choices.map((m) => {
                const on = form.reminderOffsetsMinutes.includes(m);
                return (
                  <label key={m} className="check">
                    <input type="checkbox" checked={on} disabled={!on && form.reminderOffsetsMinutes.length >= MAX_REMINDERS}
                      onChange={() => set('reminderOffsetsMinutes')(toggleReminder(form.reminderOffsetsMinutes, m))} />
                    {reminderLabel(m)}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </Card>
      </fieldset>
    </form>
  );
}
