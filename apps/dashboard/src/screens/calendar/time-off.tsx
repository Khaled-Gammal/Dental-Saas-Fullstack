import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pickName } from '@dental/ui/text';
import { api } from '../../api';
import { DatePicker } from '../../components/date-picker';
import { t, type Lang } from '../../i18n';
import { calendarKeys, keys, useDoctors, useOne, useTimeOff } from '../../queries';
import { to } from '../../router';
import type { CalendarConflict, TimeOff } from '../../types';
import { Button, Card, EmptyState, ErrorText, Field, Input, LinkButton, Skeleton } from '../../ui/components';
import { CalendarIcon } from '../../ui/icons';
import { Breadcrumbs, ResourceState } from '../../ui/page';
import { zonedToUtc } from '../../util';
import { Conflicts } from './conflicts';

const loc = (lang: Lang) => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');
const TZ = 'Africa/Cairo'; // the clinic's zone (branches default to it); the API stores instants

/** `#/doctors/<id>/timeoff`: a doctor's leave (SRS APPT-005). No times can be booked with them during it. */
export function DoctorTimeOff({ lang, clinicId, id, canWrite }: { lang: Lang; clinicId: string; id?: string; canWrite: boolean }) {
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
  if (!one.data) return <ResourceState {...one} back={to.list('doctors')} backLabel={t('navDoctors', lang)} />;
  const name = pickName(lang, one.data.name_ar, one.data.name_en, '—');
  const fmt = (iso: string) => new Intl.DateTimeFormat(loc(lang), { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }).format(new Date(iso));
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate(); };

  return (
    <>
      <Breadcrumbs items={[{ label: t('navOverview', lang), route: to.list('overview') }, { label: t('navDoctors', lang), route: to.list('doctors') }, { label: name }]} />
      <div className="page-head"><div><h1>{t('timeOffTitle', lang)} · <bdi>{name}</bdi></h1><p>{t('timeOffSub', lang)}</p></div></div>
      {canWrite && (
        <Card>
          <h2>{t('addTimeOff', lang)}</h2>
          <form onSubmit={submit} className="grid-2 mt">
            <Field label={t('fromLabel', lang)}>{(a) => <DatePicker id={a.id} lang={lang} value={from.date} onChange={(d) => setFrom((f) => ({ ...f, date: d }))} min={today} />}</Field>
            <Field label={t('time', lang)}>{(a) => <Input id={a.id} type="time" dir="ltr" value={from.time} onChange={(e) => setFrom((f) => ({ ...f, time: e.target.value }))} />}</Field>
            <Field label={t('toLabel', lang)}>{(a) => <DatePicker id={a.id} lang={lang} value={until.date} onChange={(d) => setUntil((u) => ({ ...u, date: d }))} min={from.date} />}</Field>
            <Field label={t('time', lang)}>{(a) => <Input id={a.id} type="time" dir="ltr" value={until.time} onChange={(e) => setUntil((u) => ({ ...u, time: e.target.value }))} />}</Field>
            <Field label={t('reasonLabel', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
            <div className="row-end"><Button type="submit" loading={add.isPending}>{t('addTimeOff', lang)}</Button></div>
          </form>
          <ErrorText error={add.error} />
          {conflicts && <Conflicts lang={lang} items={conflicts} />}
        </Card>
      )}
      {list.isError ? <ErrorText error={list.error} onRetry={() => void list.refetch()} />
        : list.isLoading ? <Skeleton h={56} count={2} />
        : !list.data?.length ? <Card><EmptyState icon={<CalendarIcon size={28} />} title={t('noTimeOff', lang)} text={t('timeOffSub', lang)} /></Card>
        : (
          <ul className="patient-rows mt">
            {list.data.map((o) => (
              <Card as="li" key={o.id} className="patient-row">
                <span className="patient-main">
                  <span className="patient-avatar" aria-hidden><CalendarIcon size={18} /></span>
                  <span className="patient-text"><strong><bdi dir="ltr">{fmt(o.starts_at)} – {fmt(o.ends_at)}</bdi></strong>{o.reason && <span className="muted small"><bdi>{o.reason}</bdi></span>}</span>
                </span>
                {canWrite && <LinkButton onClick={() => remove.mutate(o.id)} disabled={remove.isPending}>{t('remove', lang)}</LinkButton>}
              </Card>
            ))}
          </ul>
        )}
      <ErrorText error={remove.error} />
    </>
  );
}
