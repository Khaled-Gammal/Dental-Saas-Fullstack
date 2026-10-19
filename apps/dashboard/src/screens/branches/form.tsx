import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api';
import { ImageField } from '../../components/image-field';
import { useLeave, useUnsavedChanges } from '../../hooks';
import { imageFieldValue } from '../../media-model';
import { t, type Lang } from '../../i18n';
import { useBranches, useInvalidate, useOne } from '../../queries';
import { to } from '../../router';
import type { Branch, MediaImage } from '../../types';
import { diffText } from '../../util';
import { Card, Field, Input, Switch } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { FormPage, ResourceState } from '../../ui/page';

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/;
const TEXT = ['nameAr', 'nameEn', 'addressAr', 'addressEn', 'city', 'phone', 'whatsapp'] as const;
type Form = Record<(typeof TEXT)[number], string> & { slug: string; isActive: boolean; photo: MediaImage | null };

const EMPTY: Form = { nameAr: '', nameEn: '', addressAr: '', addressEn: '', city: '', phone: '', whatsapp: '', slug: '', isActive: true, photo: null };
const toForm = (b: Branch): Form => ({
  nameAr: b.name_ar ?? '', nameEn: b.name_en ?? '', addressAr: b.address_ar ?? '', addressEn: b.address_en ?? '', city: b.city ?? '',
  phone: b.phone ?? '', whatsapp: b.whatsapp ?? '', slug: b.slug, isActive: b.is_active, photo: b.photo ?? null,
});

/** `#/branches/new` and `#/branches/:id/edit` — the same form; the API decides what each may change. */
export function BranchForm({ lang, clinicId, id }: { lang: Lang; clinicId: string; id?: string }) {
  const list = useBranches(clinicId);
  const one = useOne(list, id);
  if (id && !one.data) return <ResourceState {...one} back={to.list('branches')} backLabel={t('branches', lang)} />;
  return <BranchFormBody key={id ?? 'new'} lang={lang} clinicId={clinicId} branch={one.data} />;
}

function BranchFormBody({ lang, clinicId, branch }: { lang: Lang; clinicId: string; branch?: Branch }) {
  const [orig] = useState(() => (branch ? toForm(branch) : null)); // the baseline never moves under the user (see profile.tsx)
  const [form, setForm] = useState<Form>(orig ?? EMPTY);
  const [confirmOff, setConfirmOff] = useState(false);
  const invalidate = useInvalidate(clinicId);
  const leave = useLeave(to.list('branches'));

  // create: the fields CreateBranch accepts; edit: only what changed (an emptied text is sent as null)
  const createBody = () => {
    const b: Record<string, unknown> = { slug: form.slug };
    for (const k of ['nameAr', 'nameEn', 'city', 'phone'] as const) if (form[k].trim()) b[k] = form[k].trim();
    return b;
  };
  const photo = orig ? imageFieldValue(form.photo, orig.photo) : undefined; // a photo is added once the branch exists
  const body: Record<string, unknown> = orig
    ? { ...diffText(orig, form, TEXT), ...(form.isActive !== orig.isActive && { isActive: form.isActive }), ...(photo !== undefined && { photoFileId: photo }) }
    : createBody();
  const dirty = orig ? Object.keys(body).length > 0 : form.slug !== '' || TEXT.some((k) => form[k].trim() !== '');
  const slugBad = !orig && !SLUG_RE.test(form.slug);
  const hasName = form.nameAr.trim().length >= 2 || form.nameEn.trim().length >= 2;
  const canSave = hasName && !slugBad && dirty;
  useUnsavedChanges(dirty, t('leaveUnsaved', lang));

  const save = useMutation({
    mutationFn: () => (branch
      ? api<Branch>(`/branches/${branch.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      : api<Branch>('/branches', { method: 'POST', body: JSON.stringify(body) })),
    onSuccess: () => invalidate('branches'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (canSave) save.mutate(undefined, { onSuccess: () => leave(t('branchSaved', lang)) }); };
  const text = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setActive = (on: boolean) => (on ? setForm((f) => ({ ...f, isActive: true })) : setConfirmOff(true));

  const crumbs = [{ label: t('navOverview', lang), route: to.list('overview') }, { label: t('branches', lang), route: to.list('branches') }, { label: t(branch ? 'edit' : 'addBranch', lang) }];
  return (
    <FormPage title={branch ? t('editBranch', lang) : t('addBranch', lang)} crumbs={crumbs} back={to.list('branches')} onSubmit={submit}
      saving={save.isPending} canSave={canSave} error={save.error}>
      <Card>
        <h2>{t('secBasics', lang)}</h2>
        <div className="grid-2 mt">
          <Field label={t('nameAr', lang)}>{(a) => <Input id={a.id} value={form.nameAr} onChange={text('nameAr')} dir="auto" maxLength={120} autoFocus={!branch} />}</Field>
          {branch ? (
            <Field label={t('branchSlug', lang)} hint={t('slugLocked', lang)}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={form.slug} readOnly dir="ltr" />}</Field>
          ) : (
            <Field label={t('branchSlug', lang)} hint={t('branchSlugHint', lang)} error={form.slug && slugBad ? t('branchSlugHint', lang) : undefined}>
              {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.slug} dir="ltr" required maxLength={60} placeholder="nasr-city" spellCheck={false}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') }))} />}
            </Field>
          )}
          <Field label={t('city', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={form.city} onChange={text('city')} maxLength={80} />}</Field>
        </div>
      </Card>

      {branch && (
        <Card>
          <ImageField lang={lang} purpose="photo" shape="wide" value={form.photo} onChange={(photo) => setForm((f) => ({ ...f, photo }))}
            label={t('branchPhoto', lang)} hint={t('branchPhotoHint', lang)} />
        </Card>
      )}

      {branch && (
        <Card>
          <h2>{t('secAddress', lang)}</h2>
          <div className="grid-2 mt">
            <Field label={t('addressAr', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={form.addressAr} onChange={text('addressAr')} dir="rtl" maxLength={300} />}</Field>
          </div>
        </Card>
      )}

      <Card>
        <h2>{t('secContact', lang)}</h2>
        <div className="grid-2 mt">
          <Field label={t('branchPhone', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} type="tel" value={form.phone} onChange={text('phone')} dir="ltr" placeholder="01012345678" />}</Field>
          {branch && <Field label={t('whatsapp', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} type="tel" value={form.whatsapp} onChange={text('whatsapp')} dir="ltr" placeholder="01012345678" />}</Field>}
        </div>
        {branch && !branch.is_main && (
          <div className="mt">
            <Switch checked={form.isActive} onChange={setActive} label={t('isActive', lang)} />
            <p className="muted small">{t('branchInactiveHint', lang)}</p>
          </div>
        )}
      </Card>

      <ConfirmDialog open={confirmOff} title={t('deactivateBranch', lang)} confirmLabel={t('deactivate', lang)} danger
        onConfirm={() => { setForm((f) => ({ ...f, isActive: false })); setConfirmOff(false); }} onCancel={() => setConfirmOff(false)}>
        {t('deactivateBranchText', lang)}
      </ConfirmDialog>
    </FormPage>
  );
}
