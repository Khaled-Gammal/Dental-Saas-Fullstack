import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { initials, pickName } from '@dental/ui/text';
import { api } from '../../api';
import { ImageField } from '../../components/image-field';
import { useLeave, useUnsavedChanges } from '../../hooks';
import { imageFieldValue } from '../../media-model';
import { t, type Lang } from '../../i18n';
import { useBranches, useDoctors, useInvalidate, useOne } from '../../queries';
import { to } from '../../router';
import type { Branch, Doctor, MediaImage } from '../../types';
import { Badge, Card, Field, Input, Switch, TextArea } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { FormPage, ResourceState } from '../../ui/page';
import { diffText } from '../../util';

const TEXT = ['nameAr', 'nameEn', 'titleAr', 'titleEn', 'bioAr'] as const;
type Form = Record<(typeof TEXT)[number], string> & { specialties: string; branchIds: string[]; showOnWebsite: boolean; acceptsOnlineBooking: boolean; isActive: boolean; photo: MediaImage | null };

const EMPTY: Form = { nameAr: '', nameEn: '', titleAr: '', titleEn: '', bioAr: '', specialties: '', branchIds: [], showOnWebsite: true, acceptsOnlineBooking: true, isActive: true, photo: null };
/** `branchIds` is limited to the branches the form shows (active ones), so an unchecked box is never silently kept. */
const toForm = (d: Doctor, shown: Branch[]): Form => ({
  nameAr: d.name_ar ?? '', nameEn: d.name_en ?? '', titleAr: d.title_ar ?? '', titleEn: d.title_en ?? '', bioAr: d.bio_ar ?? '',
  specialties: d.specialties.join(', '), branchIds: d.branch_ids.filter((id) => shown.some((b) => b.id === id)),
  showOnWebsite: d.show_on_website, acceptsOnlineBooking: d.accepts_online_booking, isActive: d.is_active, photo: d.photo ?? null,
});
/** "تقويم، زراعة" or "ortho, implants" -> ['تقويم', 'زراعة']; Arabic and Latin commas both split. */
export const parseSpecialties = (s: string) => Array.from(new Set(s.split(/[,،]/).map((x) => x.trim()).filter((x) => x.length >= 2))).slice(0, 10);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** The API body: everything for a create (blank text left out), only what changed for an edit (emptied text -> null). */
export function toBody(form: Form, orig: Form | null): Record<string, unknown> {
  const body: Record<string, unknown> = orig ? diffText(orig, form, TEXT) : Object.fromEntries(TEXT.filter((k) => form[k].trim()).map((k) => [k, form[k].trim()]));
  const specialties = parseSpecialties(form.specialties);
  if (!orig || !sameSet(specialties, parseSpecialties(orig.specialties))) body.specialties = specialties;
  if (!orig || !sameSet(form.branchIds, orig.branchIds)) body.branchIds = form.branchIds;
  for (const k of ['showOnWebsite', 'acceptsOnlineBooking'] as const) if (!orig || form[k] !== orig[k]) body[k] = form[k];
  if (orig && form.isActive !== orig.isActive) body.isActive = form.isActive;
  const photo = imageFieldValue(form.photo, orig ? orig.photo : undefined);
  if (photo !== undefined) body.photoFileId = photo;
  return body;
}

/** `#/doctors/new` and `#/doctors/:id/edit`. */
export function DoctorForm({ lang, clinicId, id }: { lang: Lang; clinicId: string; id?: string }) {
  const branches = useBranches(clinicId);
  const one = useOne(useDoctors(clinicId), id);
  const active = branches.data?.filter((b) => b.is_active);
  if (!active) return <ResourceState isLoading={branches.isLoading} isError={branches.isError} error={branches.error} notFound={false} refetch={() => void branches.refetch()} back={to.list('doctors')} backLabel={t('navDoctors', lang)} />;
  if (id && !one.data) return <ResourceState {...one} back={to.list('doctors')} backLabel={t('navDoctors', lang)} />;
  return <DoctorFormBody key={id ?? 'new'} lang={lang} clinicId={clinicId} branches={active} doctor={one.data} />;
}

function DoctorFormBody({ lang, clinicId, branches, doctor }: { lang: Lang; clinicId: string; branches: Branch[]; doctor?: Doctor }) {
  const [orig] = useState(() => (doctor ? toForm(doctor, branches) : null)); // frozen baseline: a background refetch cannot make the form dirty
  const start = orig ?? { ...EMPTY, branchIds: branches.length === 1 ? [branches[0].id] : [] };
  const [form, setForm] = useState<Form>(start);
  const [confirmOff, setConfirmOff] = useState(false);
  const invalidate = useInvalidate(clinicId);
  const leave = useLeave(to.list('doctors'));
  const body = toBody(form, orig);
  const hasName = form.nameAr.trim().length >= 2 || form.nameEn.trim().length >= 2; // DisplayName min(2) on the API
  const dirty = orig ? Object.keys(body).length > 0 : JSON.stringify(form) !== JSON.stringify(start);
  const canSave = hasName && form.branchIds.length > 0 && dirty;
  useUnsavedChanges(dirty, t('leaveUnsaved', lang));

  const save = useMutation({
    mutationFn: () => (doctor
      ? api<Doctor>(`/doctors/${doctor.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      : api<Doctor>('/doctors', { method: 'POST', body: JSON.stringify(body) })),
    onSuccess: () => invalidate('doctors'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (canSave) save.mutate(undefined, { onSuccess: () => leave(t('doctorSaved', lang)) }); };
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: (typeof TEXT)[number] | 'specialties') => (e: { target: { value: string } }) => set(k)(e.target.value);
  const toggleBranch = (bid: string, on: boolean) => set('branchIds')(on ? [...form.branchIds, bid] : form.branchIds.filter((x) => x !== bid));
  const setActive = (on: boolean) => (on ? set('isActive')(true) : setConfirmOff(true));

  const crumbs = [{ label: t('navOverview', lang), route: to.list('overview') }, { label: t('navDoctors', lang), route: to.list('doctors') }, { label: doctor ? pickName(lang, doctor.name_ar, doctor.name_en, '—') : t('addDoctor', lang) }];
  return (
    <FormPage title={t(doctor ? 'editDoctor' : 'addDoctor', lang)} crumbs={crumbs} back={to.list('doctors')} onSubmit={submit}
      saving={save.isPending} canSave={canSave} error={save.error}
      notice={!hasName && dirty && <p className="field-error">{t('needName', lang)}</p>}>
      <Card>
        <h2>{t('secBasics', lang)}</h2>
        <div className="mt">
          <ImageField lang={lang} purpose="photo" shape="circle" value={form.photo} onChange={set('photo')} label={t('doctorPhoto', lang)} hint={t('doctorPhotoHint', lang)}
            placeholder={initials(form.nameAr || form.nameEn) || undefined} />
        </div>
        <div className="grid-2 mt">
          <Field label={t('doctorNameAr', lang)}>{(a) => <Input id={a.id} value={form.nameAr} onChange={text('nameAr')} dir="rtl" maxLength={120} autoFocus={!doctor} />}</Field>
          <Field label={t('doctorNameEn', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={form.nameEn} onChange={text('nameEn')} dir="ltr" maxLength={120} />}</Field>
          <Field label={t('titleAr', lang)} optional={t('optional', lang)} hint={t('titleHint', lang)}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={form.titleAr} onChange={text('titleAr')} dir="rtl" maxLength={120} />}</Field>
          <Field label={t('titleEn', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={form.titleEn} onChange={text('titleEn')} dir="ltr" maxLength={120} />}</Field>
        </div>
        <div className="stack mt">
          <Field label={t('specialties', lang)} optional={t('optional', lang)} hint={t('specialtiesHint', lang)}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} value={form.specialties} onChange={text('specialties')} maxLength={300} />}
          </Field>
          <Field label={t('bioAr', lang)} optional={t('optional', lang)}>{(a) => <TextArea id={a.id} value={form.bioAr} onChange={text('bioAr')} dir="rtl" maxLength={1000} />}</Field>
        </div>
      </Card>

      <Card>
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
      </Card>

      <Card>
        <h2>{t('secVisibility', lang)}</h2>
        <div className="switch-row mt">
          <Switch checked={form.showOnWebsite} onChange={set('showOnWebsite')} label={t('showOnWebsite', lang)} />
          <Switch checked={form.acceptsOnlineBooking} onChange={set('acceptsOnlineBooking')} label={t('acceptsOnline', lang)} />
          {doctor && <Switch checked={form.isActive} onChange={setActive} label={t('isActive', lang)} />}
        </div>
      </Card>

      <ConfirmDialog open={confirmOff} title={t('deactivateDoctor', lang)} confirmLabel={t('deactivate', lang)} danger
        onConfirm={() => { set('isActive')(false); setConfirmOff(false); }} onCancel={() => setConfirmOff(false)}>
        {t('deactivateDoctorText', lang)}
      </ConfirmDialog>
    </FormPage>
  );
}
