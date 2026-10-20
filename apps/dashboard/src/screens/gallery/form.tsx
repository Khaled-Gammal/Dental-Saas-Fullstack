import { useState, type FormEvent } from 'react';
import { useLeave, useUnsavedChanges } from '../../hooks';
import { galleryBody, galleryProblems, toGalleryForm, type GalleryForm } from '../../gallery-model';
import { errorLabel } from '../../labels';
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
      notFound={false} refetch={() => void one.refetch()} back={to.list('gallery')} backLabel="معرض الصور" />;
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
  useUnsavedChanges(dirty, 'لديك تغييرات غير محفوظة. هل تريد المغادرة بدون حفظ؟');
  const set = <K extends keyof GalleryForm>(k: K) => (v: GalleryForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: 'captionAr' | 'captionEn' | 'altAr' | 'altEn') => (e: { target: { value: string } }) => set(k)(e.target.value);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!dirty || problems.length) return;
    save.mutate(body, { onSuccess: () => leave('تم حفظ الصورة') });
  };

  return (
    <FormPage title="تعديل الصورة" crumbs={[{ label: 'معرض الصور', route: to.list('gallery') }, { label: 'تعديل الصورة' }]}
      back={to.list('gallery')} onSubmit={submit} saving={save.isPending} canSave={dirty} error={save.error}
      notice={touched && problems.length > 0 && <p className="field-error">{problems.map((p) => errorLabel[p]).join(' ')}</p>}>
      <Card>
        <div className="photo-edit">
          <div className="photo-preview"><Thumb img={item.image} alt={form.altAr || form.captionAr || ''} sizes="(max-width: 760px) 100vw, 480px" /></div>
          <div className="stack">
            <Field label="المعرض">
              {(a) => <ScopeSelect id={a.id} branches={branches} value={form.branchId || 'clinic'} onChange={(v) => set('branchId')(v === 'clinic' ? '' : v)} withAll={false} />}
            </Field>
            <div className="switch-row">
              <Switch checked={form.isPublished} onChange={(v) => setForm((f) => ({ ...f, isPublished: v, isFeatured: v ? f.isFeatured : false }))} label="منشورة" />
              <Switch checked={form.isFeatured} onChange={(v) => setForm((f) => ({ ...f, isFeatured: v, isPublished: v ? true : f.isPublished }))} label="مميزة" />
            </div>
            <p className="muted small">صورة مميزة واحدة لكل معرض؛ تظهر أولًا. تمييز صورة يلغي تمييز السابقة.</p>
          </div>
        </div>
      </Card>
      <Card>
        <h2>الوصف</h2>
        <div className="grid-2 mt">
          <Field label="وصف الصورة لقارئ الشاشة" hint="ماذا تُظهر الصورة؟ مثال: غرفة الكشف بكرسي أسنان حديث. مطلوب للنشر." error={touched && problems.includes('alt_required') ? 'أضف وصفًا للصورة (أو تعليقًا) قبل نشرها.' : undefined}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.altAr} onChange={text('altAr')} dir="rtl" maxLength={200} />}
          </Field>
          <Field label="تعليق ظاهر" optional="اختياري" hint="يظهر تحت الصورة على الموقع.">{(a) => <Input id={a.id} describedBy={a.describedBy} value={form.captionAr} onChange={text('captionAr')} dir="rtl" maxLength={300} />}</Field>
        </div>
      </Card>
    </FormPage>
  );
}
