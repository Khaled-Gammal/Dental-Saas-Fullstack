import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pickName } from '@dental/ui/text';
import { api } from '../../api';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { t, type Lang } from '../../i18n';
import { calendarKeys, keys, useBranches, useHolidays } from '../../queries';
import type { CalendarConflict, Holiday } from '../../types';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, LinkButton, PageHeader, Skeleton } from '../../ui/components';
import { CalendarIcon } from '../../ui/icons';
import { Conflicts } from './conflicts';

const loc = (lang: Lang) => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');
const ALL = '';

/** `#/holidays`: closed days for the whole clinic or one branch (SRS APPT-005). Reception can see them; the owner edits. */
export function Holidays({ lang, clinicId, canWrite }: { lang: Lang; clinicId: string; canWrite: boolean }) {
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
  const submit = (e: FormEvent) => { e.preventDefault(); if (date && name.trim()) add.mutate(); };
  const branchName = (id: string | null) => (id ? pickName(lang, branches.find((b) => b.id === id)?.name_ar ?? null, branches.find((b) => b.id === id)?.name_en ?? null, '—') : t('wholeClinic', lang));
  const fmtDate = (d: string) => new Intl.DateTimeFormat(loc(lang), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

  return (
    <>
      <PageHeader title={t('holidaysTitle', lang)} sub={t('holidaysSub', lang)} />
      {canWrite && (
        <Card>
          <h2>{t('addHoliday', lang)}</h2>
          <form onSubmit={submit} className="grid-2 mt">
            <Field label={t('date', lang)}>{(a) => <DatePicker id={a.id} lang={lang} value={date} onChange={setDate} min={new Date().toLocaleDateString('en-CA')} />}</Field>
            <Field label={t('branch', lang)}>
              {(a) => <Choice id={a.id} lang={lang} value={branchId} onChange={setBranchId} noneLabel={t('wholeClinic', lang)}
                options={branches.filter((b) => b.is_active).map((b) => ({ value: b.id, label: pickName(lang, b.name_ar, b.name_en, b.slug) }))} />}
            </Field>
            <Field label={t('holidayName', lang)}>{(a) => <Input id={a.id} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />}</Field>
            <div className="row-end"><Button type="submit" loading={add.isPending} disabled={!date || !name.trim()}>{t('addHoliday', lang)}</Button></div>
          </form>
          <ErrorText error={add.error} />
          {conflicts && <Conflicts lang={lang} items={conflicts} />}
        </Card>
      )}
      <h2 className="section-title mt">{t('holidaysLink', lang)}</h2>
      {holidays.isError ? <ErrorText error={holidays.error} onRetry={() => void holidays.refetch()} />
        : holidays.isLoading ? <Skeleton h={56} count={3} />
        : !holidays.data?.length ? <Card><EmptyState icon={<CalendarIcon size={28} />} title={t('noHolidays', lang)} text={t('holidaysSub', lang)} /></Card>
        : (
          <ul className="patient-rows">
            {holidays.data.map((h) => (
              <Card as="li" key={h.id} className="patient-row">
                <span className="patient-main">
                  <span className="patient-avatar" aria-hidden><CalendarIcon size={18} /></span>
                  <span className="patient-text"><strong><bdi>{h.name}</bdi></strong><span className="muted small">{fmtDate(h.date)}</span></span>
                </span>
                <span className="patient-badges"><Badge>{branchName(h.branch_id)}</Badge></span>
                {canWrite && <LinkButton onClick={() => remove.mutate(h.id)} disabled={remove.isPending}>{t('remove', lang)}</LinkButton>}
              </Card>
            ))}
          </ul>
        )}
      <ErrorText error={remove.error} />
    </>
  );
}
