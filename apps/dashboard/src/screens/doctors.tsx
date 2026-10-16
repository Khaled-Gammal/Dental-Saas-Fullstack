import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { pickName } from '@dental/ui/text';
import { api } from '../api';
import { t, type Key, type Lang } from '../i18n';
import { useBranches, useDoctors, useInvalidate } from '../queries';
import { fmtNumber } from '../util';
import { canAddSlot, dayError, fromRows, nextSlot, scheduledDays, toPayload, type ScheduleDay, type Slot } from '../schedule-model';
import type { Branch, Doctor } from '../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, LinkButton, PageHeader, Skeleton, Switch, TextArea, initials } from '../ui/components';
import { CalendarIcon, CloseIcon, EditIcon, PinIcon, PlusIcon, StethoscopeIcon } from '../ui/icons';

const FORM_ID = 'doctor-form';
const SCHEDULE_ID = 'doctor-schedule';

type Panel = { kind: 'add' } | { kind: 'edit'; id: string } | { kind: 'schedule'; id: string } | null;

/** `canWrite` only hides what the API would refuse (settings:write). */
export function Doctors({ lang, clinicId, canWrite }: { lang: Lang; clinicId: string; canWrite: boolean }) {
  const doctors = useDoctors(clinicId);
  const branches = useBranches(clinicId);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<Key | null>(null);
  const activeBranches = branches.data?.filter((b) => b.is_active) ?? [];
  const count = doctors.data?.length ?? 0;
  const open = (p: Panel) => { setNotice(null); setPanel(p); };
  const done = (msg: Key) => { setNotice(msg); setPanel(null); };
  const editing = panel && panel.kind !== 'add' ? doctors.data?.find((d) => d.id === panel.id) : undefined;

  const addBtn = canWrite && panel?.kind !== 'add' && (
    <Button onClick={() => open({ kind: 'add' })} disabled={branches.isSuccess && activeBranches.length === 0}><PlusIcon size={18} />{t('addDoctor', lang)}</Button>
  );

  return (
    <>
      <PageHeader title={t('navDoctors', lang)} sub={t('doctorsSub', lang)} action={count > 0 ? addBtn : undefined} />
      {notice && !panel && <Alert tone="success">{t(notice, lang)}</Alert>}
      {canWrite && branches.isSuccess && activeBranches.length === 0 && <Alert tone="info">{t('noBranchesYet', lang)}</Alert>}

      {panel?.kind === 'add' && (
        <DoctorForm key="add" id={FORM_ID} lang={lang} clinicId={clinicId} branches={activeBranches} onDone={() => done('doctorAdded')} onCancel={() => setPanel(null)} />
      )}
      {panel?.kind === 'edit' && editing && (
        <DoctorForm key={editing.id} id={FORM_ID} lang={lang} clinicId={clinicId} branches={activeBranches} doctor={editing} onDone={() => done('doctorSaved')} onCancel={() => setPanel(null)} />
      )}
      {panel?.kind === 'schedule' && editing && (
        <ScheduleEditor key={editing.id} id={SCHEDULE_ID} lang={lang} clinicId={clinicId} doctor={editing} branches={activeBranches} onDone={() => done('scheduleSaved')} onCancel={() => setPanel(null)} />
      )}

      {doctors.isError ? (
        <ErrorText error={doctors.error} onRetry={() => void doctors.refetch()} />
      ) : doctors.isLoading ? (
        <div className="cards"><Skeleton h={120} count={3} /></div>
      ) : count === 0 && panel?.kind !== 'add' ? (
        <Card><EmptyState icon={<StethoscopeIcon size={28} />} title={t('noDoctors', lang)} text={t('noDoctorsText', lang)} action={addBtn} /></Card>
      ) : (
        <ul className="cards" aria-busy={doctors.isFetching || undefined}>
          {doctors.data?.map((d) => (
            <DoctorCard key={d.id} lang={lang} doctor={d} branches={activeBranches} canWrite={canWrite}
              expanded={panel && panel.kind !== 'add' && panel.id === d.id ? panel.kind : null}
              onEdit={() => open({ kind: 'edit', id: d.id })} onSchedule={() => open({ kind: 'schedule', id: d.id })} />
          ))}
        </ul>
      )}
    </>
  );
}

function DoctorCard({ lang, doctor: d, branches, canWrite, expanded, onEdit, onSchedule }: {
  lang: Lang; doctor: Doctor; branches: Branch[]; canWrite: boolean; expanded: 'edit' | 'schedule' | null; onEdit: () => void; onSchedule: () => void;
}) {
  const name = pickName(lang, d.name_ar, d.name_en, '—');
  const title = lang === 'ar' ? d.title_ar || d.title_en : d.title_en || d.title_ar;
  const where = branches.filter((b) => d.branch_ids.includes(b.id)).map((b) => pickName(lang, b.name_ar, b.name_en, b.slug));
  const days = scheduledDays(d.schedule);
  return (
    <Card as="li" className={`doctor${d.is_active ? '' : ' is-inactive'}`}>
      <div className="branch-top">
        <span className="avatar avatar-lg">{initials(name)}</span>
        <div className="branch-text">
          <strong><bdi>{name}</bdi></strong>
          {title && <span className="muted small"><bdi>{title}</bdi></span>}
        </div>
        {!d.is_active ? <Badge>{t('inactive', lang)}</Badge> : !d.show_on_website ? <Badge tone="warning">{t('hidden', lang)}</Badge> : null}
      </div>
      {d.specialties.length > 0 && <div className="chips">{d.specialties.map((s) => <span key={s} className="chip"><bdi>{s}</bdi></span>)}</div>}
      <div className="branch-hours">
        <PinIcon size={16} />
        {where.length ? <span><bdi>{where.join(lang === 'ar' ? '، ' : ', ')}</bdi></span> : <span className="warn-text">{t('needBranch', lang)}</span>}
      </div>
      <div className="branch-hours no-line">
        <CalendarIcon size={16} />
        {days ? <span>{t('schedule', lang)}: <strong><bdi>{fmtNumber(days, lang)}/7</bdi></strong> {t('scheduleDays', lang)}</span> : <span className="warn-text">{t('noSchedule', lang)}</span>}
      </div>
      {canWrite && (
        <div className="branch-actions">
          <Button variant={days ? 'secondary' : 'primary'} onClick={onSchedule} disabled={where.length === 0}
            aria-expanded={expanded === 'schedule'} aria-controls={expanded === 'schedule' ? SCHEDULE_ID : undefined}>
            <CalendarIcon size={16} />{t('schedule', lang)}
          </Button>
          <LinkButton onClick={onEdit} aria-expanded={expanded === 'edit'} aria-controls={expanded === 'edit' ? FORM_ID : undefined}>
            <EditIcon size={16} />{t('edit', lang)}
          </LinkButton>
        </div>
      )}
    </Card>
  );
}

/* ---------- add / edit form ---------- */

type Form = {
  nameAr: string; nameEn: string; titleAr: string; titleEn: string; bioAr: string; specialties: string;
  branchIds: string[]; showOnWebsite: boolean; acceptsOnlineBooking: boolean; isActive: boolean;
};
const EMPTY: Form = { nameAr: '', nameEn: '', titleAr: '', titleEn: '', bioAr: '', specialties: '', branchIds: [], showOnWebsite: true, acceptsOnlineBooking: true, isActive: true };
/** `branchIds` is limited to the branches the form shows (active ones), so an unchecked box is never silently kept. */
const toForm = (d: Doctor, shown: Branch[]): Form => ({
  nameAr: d.name_ar ?? '', nameEn: d.name_en ?? '', titleAr: d.title_ar ?? '', titleEn: d.title_en ?? '', bioAr: d.bio_ar ?? '',
  specialties: d.specialties.join(', '), branchIds: d.branch_ids.filter((id) => shown.some((b) => b.id === id)), showOnWebsite: d.show_on_website, acceptsOnlineBooking: d.accepts_online_booking, isActive: d.is_active,
});
/** "تقويم، زراعة" or "ortho, implants" -> ['تقويم', 'زراعة']; Arabic and Latin commas both split. */
const parseSpecialties = (s: string) => Array.from(new Set(s.split(/[,،]/).map((x) => x.trim()).filter((x) => x.length >= 2))).slice(0, 10);
const TEXT_KEYS = ['nameAr', 'nameEn', 'titleAr', 'titleEn', 'bioAr'] as const;
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** The API body. For a create everything is sent; for an edit only what changed (an emptied text is sent as null). */
function toBody(form: Form, orig: Form | null): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const k of TEXT_KEYS) {
    const v = form[k].trim();
    if (!orig) { if (v) body[k] = v; } else if (v !== orig[k].trim()) body[k] = v || null;
  }
  const specialties = parseSpecialties(form.specialties);
  if (!orig || !sameSet(specialties, parseSpecialties(orig.specialties))) body.specialties = specialties;
  if (!orig || !sameSet(form.branchIds, orig.branchIds)) body.branchIds = form.branchIds;
  for (const k of ['showOnWebsite', 'acceptsOnlineBooking'] as const) if (!orig || form[k] !== orig[k]) body[k] = form[k];
  if (orig && form.isActive !== orig.isActive) body.isActive = form.isActive;
  return body;
}

function DoctorForm({ id, lang, clinicId, branches, doctor, onDone, onCancel }: {
  id: string; lang: Lang; clinicId: string; branches: Branch[]; doctor?: Doctor; onDone: () => void; onCancel: () => void;
}) {
  const orig = doctor ? toForm(doctor, branches) : null;
  const [form, setForm] = useState<Form>(orig ?? { ...EMPTY, branchIds: branches.length === 1 ? [branches[0].id] : [] });
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const invalidate = useInvalidate(clinicId);
  const body = toBody(form, orig);
  const hasName = form.nameAr.trim().length >= 2 || form.nameEn.trim().length >= 2; // DisplayName min(2) on the API
  const dirty = Object.keys(body).length > 0;
  const canSave = hasName && form.branchIds.length > 0 && (!orig || dirty);

  const save = useMutation({
    mutationFn: () => (doctor
      ? api<Doctor>(`/doctors/${doctor.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      : api<Doctor>('/doctors', { method: 'POST', body: JSON.stringify(body) })),
    onSuccess: async () => { await invalidate('doctors'); onDone(); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (canSave) save.mutate(); };
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: (typeof TEXT_KEYS)[number] | 'specialties') => (e: { target: { value: string } }) => set(k)(e.target.value);
  const toggleBranch = (bid: string, on: boolean) => set('branchIds')(on ? [...form.branchIds, bid] : form.branchIds.filter((x) => x !== bid));

  return (
    <Card className="form-card" id={id}>
      <div className="hours-head">
        <h2 ref={title} tabIndex={-1}>{t(doctor ? 'editDoctor' : 'addDoctor', lang)}</h2>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label={t('cancel', lang)}><CloseIcon /></button>
      </div>
      <form onSubmit={submit} className="stack">
        <div className="grid-2">
          <Field label={t('doctorNameAr', lang)}>{(a) => <Input id={a.id} value={form.nameAr} onChange={text('nameAr')} dir="rtl" maxLength={120} />}</Field>
          <Field label={t('doctorNameEn', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={form.nameEn} onChange={text('nameEn')} dir="ltr" maxLength={120} />}</Field>
          <Field label={t('titleAr', lang)} optional={t('optional', lang)} hint={t('titleHint', lang)}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={form.titleAr} onChange={text('titleAr')} dir="rtl" maxLength={120} />}</Field>
          <Field label={t('titleEn', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={form.titleEn} onChange={text('titleEn')} dir="ltr" maxLength={120} />}</Field>
        </div>
        <Field label={t('specialties', lang)} optional={t('optional', lang)} hint={t('specialtiesHint', lang)}>
          {(a) => <Input id={a.id} describedBy={a.describedBy} value={form.specialties} onChange={text('specialties')} maxLength={300} />}
        </Field>
        <Field label={t('bioAr', lang)} optional={t('optional', lang)}>{(a) => <TextArea id={a.id} value={form.bioAr} onChange={text('bioAr')} dir="rtl" maxLength={1000} />}</Field>

        <fieldset className="check-group">
          <legend>{t('worksAt', lang)}</legend>
          <p className="muted small">{t('worksAtHint', lang)}</p>
          <div className="branch-checks">
            {branches.map((b) => (
              <label key={b.id} className="check">
                <input type="checkbox" checked={form.branchIds.includes(b.id)} onChange={(e) => toggleBranch(b.id, e.target.checked)} />
                <bdi>{pickName(lang, b.name_ar, b.name_en, b.slug)}</bdi>{b.is_main && <Badge tone="primary">{t('main', lang)}</Badge>}
              </label>
            ))}
          </div>
          {form.branchIds.length === 0 && <p className="field-error">{t('needBranch', lang)}</p>}
        </fieldset>

        <div className="switch-row">
          <Switch checked={form.showOnWebsite} onChange={set('showOnWebsite')} label={t('showOnWebsite', lang)} />
          <Switch checked={form.acceptsOnlineBooking} onChange={set('acceptsOnlineBooking')} label={t('acceptsOnline', lang)} />
          {doctor && <Switch checked={form.isActive} onChange={set('isActive')} label={t('isActive', lang)} />}
        </div>

        {!hasName && dirty && <p className="field-error">{t('needName', lang)}</p>}
        <ErrorText error={save.error} />
        <div className="row-end">
          <Button variant="ghost" onClick={onCancel}>{t('cancel', lang)}</Button>
          <Button type="submit" loading={save.isPending} disabled={!canSave}>{t('save', lang)}</Button>
        </div>
      </form>
    </Card>
  );
}

/* ---------- weekly schedule across branches ---------- */

function ScheduleEditor({ id, lang, clinicId, doctor, branches, onDone, onCancel }: {
  id: string; lang: Lang; clinicId: string; doctor: Doctor; branches: Branch[]; onDone: () => void; onCancel: () => void;
}) {
  const mine = branches.filter((b) => doctor.branch_ids.includes(b.id));
  const [days, setDays] = useState<ScheduleDay[]>(() => fromRows(doctor.schedule));
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const invalidate = useInvalidate(clinicId);
  const ids = mine.map((b) => b.id);
  const errors = days.map((d) => dayError(d, ids));
  const hasErrors = errors.some(Boolean);

  const save = useMutation({
    mutationFn: () => api<Doctor>(`/doctors/${doctor.id}/schedule`, { method: 'PUT', body: JSON.stringify(toPayload(days)) }),
    onSuccess: async () => { await invalidate('doctors'); onDone(); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!hasErrors) save.mutate(); };
  const update = (i: number, fn: (d: ScheduleDay) => ScheduleDay) => setDays((ds) => ds.map((d, j) => (j === i ? fn(d) : d)));
  const setSlot = (i: number, k: number, patch: Partial<Slot>) => update(i, (d) => ({ ...d, slots: d.slots.map((s, j) => (j === k ? { ...s, ...patch } : s)) }));
  const name = pickName(lang, doctor.name_ar, doctor.name_en, '—');
  const errKey: Record<NonNullable<(typeof errors)[number]>, Key> = { order: 'errOrder', overlap: 'errOverlap', branch: 'err_branch_not_assigned' };

  return (
    <Card className="hours-card" id={id}>
      <div className="hours-head">
        <div>
          <h2 ref={title} tabIndex={-1}>{t('scheduleFor', lang)} <bdi>{name}</bdi></h2>
          <p className="muted small">{t('scheduleHint', lang)}</p>
        </div>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label={t('cancel', lang)}><CloseIcon /></button>
      </div>
      {mine.length === 0 ? <Alert tone="info">{t('noBranchesForDoctor', lang)}</Alert> : (
        <form onSubmit={submit}>
          <ul className="week">
            {days.map((d, i) => {
              const dayName = t(`day${d.weekday}` as Key, lang);
              const err = errors[i];
              return (
                <li key={d.weekday} className={`day${d.slots.length ? '' : ' is-closed'}${err ? ' has-error' : ''}`}>
                  <div className="day-name"><strong>{dayName}</strong></div>
                  <div className="shifts">
                    {d.slots.length === 0 && <span className="muted day-closed">{t('dayOff', lang)}</span>}
                    {d.slots.map((s, k) => (
                      <div className="shift slot" key={s.id}>
                        <select className="input slot-branch" value={s.branchId} aria-label={`${dayName} ${t('branch', lang)} ${k + 1}`}
                          onChange={(e) => setSlot(i, k, { branchId: e.target.value })}>
                          {mine.map((b) => <option key={b.id} value={b.id}>{pickName(lang, b.name_ar, b.name_en, b.slug)}</option>)}
                          {!ids.includes(s.branchId) && <option value={s.branchId} disabled>{t('inactive', lang)}</option>}
                        </select>
                        <span className="shift-times" dir="ltr">
                          <input className="input time" type="time" step={300} value={s.starts} required
                            aria-label={`${dayName} ${t('opensAt', lang)} ${k + 1}`} onChange={(e) => setSlot(i, k, { starts: e.target.value })} />
                          <span className="shift-dash" aria-hidden>–</span>
                          <input className="input time" type="time" step={300} value={s.ends} required
                            aria-label={`${dayName} ${t('closesAt', lang)} ${k + 1}`} onChange={(e) => setSlot(i, k, { ends: e.target.value })} />
                        </span>
                        <button type="button" className="icon-btn sm" aria-label={`${t('removeSlot', lang)} ${k + 1}`}
                          onClick={() => update(i, (x) => ({ ...x, slots: x.slots.filter((_, j) => j !== k) }))}><CloseIcon size={16} /></button>
                      </div>
                    ))}
                    <div className="shift-actions">
                      {canAddSlot(d) && (
                        <LinkButton onClick={() => update(i, (x) => ({ ...x, slots: [...x.slots, nextSlot(x, mine[0].id)] }))}><PlusIcon size={16} />{t('addSlot', lang)}</LinkButton>
                      )}
                    </div>
                    {err && <p className="field-error" role="alert">{t(errKey[err], lang)}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          {hasErrors && <Alert>{t('fixErrors', lang)}</Alert>}
          <ErrorText error={save.error} />
          <div className="row-end mt">
            <Button variant="ghost" onClick={onCancel}>{t('cancel', lang)}</Button>
            <Button type="submit" loading={save.isPending} disabled={hasErrors}>{t('save', lang)}</Button>
          </div>
        </form>
      )}
    </Card>
  );
}
