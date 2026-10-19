import { useState, type FormEvent } from 'react';
import { useLeave, useUnsavedChanges } from '../../hooks';
import { galleryBody, galleryProblems, toGalleryForm, type GalleryForm } from '../../gallery-model';
import { t } from '../../i18n';
import { galleryApi, useBranches, useGalleryItem, useGalleryMutation } from '../../queries';
import { to } from '../../router';
import type { Branch, GalleryItem } from '../../types';
import { Card, Field, Input, Switch } from '../../ui/components';
import { FormPage, ResourceState } from '../../ui/page';
import { ScopeSelect, Thumb } from './shared';

/** `#/gallery/:id/edit`: where the photo belongs, its caption and alt text, published and featured. */
export function GalleryForm({ clinicId, id }: { clinicId: string; id?: string }) {
  const one = useGalleryItem(clinicId, id);
  const branches = useBranches(clinicId);
  if (!one.data || !branches.data) {
    return <ResourceState isLoading={one.isLoading || branches.isLoading} isError={one.isError || branches.isError} error={one.error ?? branches.error}
      notFound={false} refetch={() => void one.refetch()} back={to.list('gallery')} backLabel={t('navGallery')} />;
  }
  return <GalleryFormBody key={one.data.id} clinicId={clinicId} item={one.data} branches={branches.data} />;
}

function GalleryFormBody({ clinicId, item, branches }: { clinicId: string; item: GalleryItem; branches: Branch[] }) {
  const [orig] = useState(() => toGalleryForm(item));
  const [form, setForm] = useState<GalleryForm>(orig);
  const [touched, setTouched] = useState(false);
  const save = useGalleryMutation(clinicId, (body: Record<string, unknown>) => galleryApi.update(item.id, body));
  const leave = useLeave(to.list('gallery'));
  const body = galleryBody(form, orig);
  const problems = galleryProblems(form);
  const dirty = Object.keys(body).length > 0;
  useUnsavedChanges(dirty, t('leaveUnsaved'));
  const set = <K extends keyof GalleryForm>(k: K) => (v: GalleryForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: 'captionAr' | 'captionEn' | 'altAr' | 'altEn') => (e: { target: { value: string } }) => set(k)(e.target.value);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!dirty || problems.length) return;
    save.mutate(body, { onSuccess: () => leave(t('photoSaved')) });
  };

  return (
    <FormPage title={t('editPhoto')} crumbs={[{ label: t('navGallery'), route: to.list('gallery') }, { label: t('editPhoto') }]}
      back={to.list('gallery')} onSubmit={submit} saving={save.isPending} canSave={dirty} error={save.error}
      notice={touched && problems.length > 0 && <p className="field-error">{problems.map((p) => t(`err_${p}`)).join(' ')}</p>}>
      <Card>
        <div className="photo-edit">
          <div className="photo-preview"><Thumb img={item.image} alt={form.altAr || form.captionAr || ''} sizes="(max-width: 760px) 100vw, 480px" /></div>
          <div className="stack">
            <Field label={t('uploadInto')}>
              {(a) => <ScopeSelect id={a.id} branches={branches} value={form.branchId || 'clinic'} onChange={(v) => set('branchId')(v === 'clinic' ? '' : v)} withAll={false} />}
            </Field>
            <div className="switch-row">
              <Switch checked={form.isPublished} onChange={(v) => setForm((f) => ({ ...f, isPublished: v, isFeatured: v ? f.isFeatured : false }))} label={t('publishedState')} />
              <Switch checked={form.isFeatured} onChange={(v) => setForm((f) => ({ ...f, isFeatured: v, isPublished: v ? true : f.isPublished }))} label={t('featured')} />
            </div>
            <p className="muted small">{t('featuredHint')}</p>
          </div>
        </div>
      </Card>
      <Card>
        <h2>{t('photoText')}</h2>
        <div className="grid-2 mt">
          <Field label={t('altAr')} hint={t('altHint')} error={touched && problems.includes('alt_required') ? t('err_alt_required') : undefined}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.altAr} onChange={text('altAr')} dir="rtl" maxLength={200} />}
          </Field>
          <Field label={t('captionAr')} optional={t('optional')} hint={t('captionHint')}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={form.captionAr} onChange={text('captionAr')} dir="rtl" maxLength={300} />}</Field>
        </div>
      </Card>
    </FormPage>
  );
}
