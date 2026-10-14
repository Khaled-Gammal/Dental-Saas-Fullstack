import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { onColor, pickName, readableOnWhite } from '@dental/ui/text';
import { api } from '../api';
import { t, type Lang } from '../i18n';
import { keys, useInvalidate, useOnboarding, useProfile, usePublish } from '../queries';
import type { ClinicProfile } from '../types';
import { Alert, Button, Card, ErrorText, Field, Input, PageHeader, Skeleton, TextArea } from '../ui/components';
import { CheckIcon, GlobeIcon, PhoneIcon, ToothIcon } from '../ui/icons';

/** Dental-friendly presets; any #rrggbb works and the website keeps text readable on it. */
const PRESETS = ['#1d6fd8', '#0e9aa7', '#12b5a0', '#0f2f5c', '#6d4ed6', '#d6457a'];
const DEFAULT_BRAND = PRESETS[0];

type Form = {
  nameAr: string; nameEn: string; aboutAr: string; aboutEn: string;
  primaryPhone: string; whatsapp: string; email: string; brandColor: string;
};
const toForm = (p: ClinicProfile): Form => ({
  nameAr: p.nameAr ?? '', nameEn: p.nameEn ?? '', aboutAr: p.aboutAr ?? '', aboutEn: p.aboutEn ?? '',
  primaryPhone: p.primaryPhone ?? '', whatsapp: p.whatsapp ?? '', email: p.email ?? '',
  brandColor: (p.brandColor ?? DEFAULT_BRAND).toLowerCase(),
});
/** Only the fields that changed are sent; an emptied field is sent as null (cleared). */
function diff(before: Form, after: Form): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of Object.keys(after) as (keyof Form)[]) {
    const a = after[k].trim();
    if (a !== before[k].trim()) out[k] = a === '' ? null : a;
  }
  return out;
}

export function Profile({ lang, clinicId, canEdit }: { lang: Lang; clinicId: string; canEdit: boolean }) {
  const profile = useProfile(clinicId);
  const onboarding = useOnboarding(clinicId).data;
  const publish = usePublish(clinicId);
  const qc = useQueryClient();
  const invalidate = useInvalidate(clinicId);
  // `orig` = what the form started from. Diffing against it (not the live query) means a background
  // refetch can never make someone else's change look like ours and get reverted on save.
  const [orig, setOrig] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  useEffect(() => {
    if (profile.data && !orig) { const f = toForm(profile.data); setOrig(f); setForm(f); }
  }, [profile.data, orig]);

  const changes = form && orig ? diff(orig, form) : {};
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: (body: Record<string, string | null>) => api<ClinicProfile>('/clinic/profile', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (p, sent) => {
      qc.setQueryData(keys.profile(clinicId), p);
      const saved = toForm(p);
      setOrig(saved);
      // keep anything typed while the request was in flight; only the fields we sent take the server's value
      setForm((f) => (f ? { ...f, ...Object.fromEntries(Object.keys(sent).map((k) => [k, saved[k as keyof Form]])) } : saved));
      void invalidate();
    },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (dirty && canEdit) save.mutate(changes); };
  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    const v = e.target.value;
    setForm((f) => (f ? { ...f, [k]: v } : f));
    if (save.isSuccess || save.isError) save.reset();
  };

  if (profile.isError) return <ErrorText error={profile.error} onRetry={() => void profile.refetch()} />;
  if (!form) return <><PageHeader title={t('navProfile', lang)} sub={t('profileSub', lang)} /><Skeleton h={120} count={3} /></>;

  return (
    <>
      <PageHeader title={t('navProfile', lang)} sub={t('profileSub', lang)} />
      {canEdit && onboarding?.pendingChanges && !dirty && (
        <div className="publish-banner" role="status">
          <GlobeIcon />
          <div className="publish-text"><strong>{t('publishBanner', lang)}</strong><span className="muted small">{t('publishHint', lang)}</span></div>
          <Button onClick={() => publish.mutate()} loading={publish.isPending}>{t('publish', lang)}</Button>
        </div>
      )}
      {publish.isSuccess && !onboarding?.pendingChanges && <Alert tone="success">{t('published', lang)}</Alert>}
      <ErrorText error={publish.error} />
      <form onSubmit={submit} className="profile-grid">
        <fieldset disabled={!canEdit} className="contents">
        <div className="stack">
          <Card>
            <h2>{t('secNames', lang)}</h2>
            <div className="grid-2 mt">
              <Field label={t('clinicNameAr', lang)}>{(a) => <Input id={a.id} value={form.nameAr} onChange={set('nameAr')} dir="rtl" maxLength={120} />}</Field>
              <Field label={t('clinicNameEn', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={form.nameEn} onChange={set('nameEn')} dir="ltr" maxLength={120} />}</Field>
            </div>
          </Card>

          <Card>
            <h2>{t('secAbout', lang)}</h2>
            <p className="muted small">{t('aboutHint', lang)}</p>
            <div className="stack mt">
              <Field label={t('aboutAr', lang)}>{(a) => <TextArea id={a.id} value={form.aboutAr} onChange={set('aboutAr')} dir="rtl" maxLength={1000} />}</Field>
              <Field label={t('aboutEn', lang)} optional={t('optional', lang)}>{(a) => <TextArea id={a.id} value={form.aboutEn} onChange={set('aboutEn')} dir="ltr" maxLength={1000} />}</Field>
            </div>
          </Card>

          <Card>
            <h2>{t('secContact', lang)}</h2>
            <div className="grid-2 mt">
              <Field label={t('primaryPhone', lang)}>{(a) => <Input id={a.id} type="tel" value={form.primaryPhone} onChange={set('primaryPhone')} dir="ltr" placeholder="01012345678" />}</Field>
              <Field label={t('whatsapp', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} type="tel" value={form.whatsapp} onChange={set('whatsapp')} dir="ltr" placeholder="01012345678" />}</Field>
              <Field label={t('clinicEmail', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} type="email" value={form.email} onChange={set('email')} dir="ltr" />}</Field>
            </div>
          </Card>
        </div>

        <aside className="stack profile-side">
          <Card>
            <h2>{t('secBrand', lang)}</h2>
            <p className="muted small">{t('brandHint', lang)}</p>
            <div className="swatches mt" role="group" aria-label={t('secBrand', lang)}>
              {PRESETS.map((c) => (
                <button key={c} type="button" aria-pressed={form.brandColor === c} aria-label={c} className="swatch"
                  style={{ background: c }} onClick={() => set('brandColor')({ target: { value: c } })}>
                  {form.brandColor === c && <CheckIcon size={16} color={onColor(c)} />}
                </button>
              ))}
              <label className="swatch swatch-custom" title={t('customColor', lang)}>
                <input type="color" value={form.brandColor} onChange={set('brandColor')} aria-label={t('customColor', lang)} />
              </label>
            </div>
            <BrandPreview lang={lang} form={form} />
          </Card>

          {canEdit && (
            <div className="save-bar">
              {save.isSuccess && !dirty && <Alert tone="success">{t('saved', lang)}</Alert>}
              <ErrorText error={save.error} />
              <Button type="submit" block loading={save.isPending} disabled={!dirty}>{dirty ? t('save', lang) : t('saved', lang)}</Button>
              {dirty && <p className="muted small center">{t('unsaved', lang)}</p>}
            </div>
          )}
        </aside>
        </fieldset>
      </form>
    </>
  );
}

/** Live preview of the website hero in the chosen colour, using the same contrast rules as the site. */
function BrandPreview({ lang, form }: { lang: Lang; form: Form }) {
  const brand = form.brandColor;
  const style = { '--brand': brand, '--on-brand': onColor(brand), '--brand-text': readableOnWhite(brand) } as CSSProperties;
  const name = pickName(lang, form.nameAr, form.nameEn, '—');
  const light = onColor(brand) !== '#ffffff';
  return (
    <div className="mt">
      <span className="eyebrow-label">{t('preview', lang)}</span>
      <div className="brand-preview" style={style} aria-hidden>
        <div className="bp-nav"><span className="bp-mark"><ToothIcon size={14} /></span><bdi>{name}</bdi></div>
        <div className="bp-body">
          <strong><bdi>{name}</bdi></strong>
          <p>{(lang === 'ar' ? form.aboutAr || form.aboutEn : form.aboutEn || form.aboutAr).slice(0, 90) || '…'}</p>
          <span className="bp-btn"><PhoneIcon size={14} />{t('previewBook', lang)}</span>
        </div>
      </div>
      {light && <p className="muted small mt-sm">{t('lightColorNote', lang)}</p>}
    </div>
  );
}
