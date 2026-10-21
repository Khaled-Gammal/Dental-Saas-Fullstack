import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { arName } from '@dental/ui/text';
import { api } from '../../api';
import { ImageField } from '../../components/image-field';
import { useLeave, useUnsavedChanges } from '../../hooks';
import { useCatalog, useInvalidate, useOne, useServices } from '../../queries';
import { to } from '../../router';
import { fromCatalog, toBody, toForm, validate, type ServiceFieldError, type ServiceForm as Form } from '../../service-model';
import type { CatalogEntry, Service } from '../../types';
import { Card, Field, Input, Switch, TextArea } from '../../ui/components';
import { Choice } from '../../components/choice';
import { useConsentTexts } from '../consents/templates';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { FormPage, ResourceState } from '../../ui/page';
import { currencyLabel } from '../../money';

const ERR_KEY: Record<ServiceFieldError, string> = { name: 'أدخل الاسم بالعربية أو الإنجليزية', price: 'أدخل السعر بالجنيه كرقم صحيح (حتى مليون)', priceMax: 'الحد الأعلى يجب أن يكون أكبر من السعر', duration: 'المدة بين 5 و480 دقيقة' };

/** `#/services/new[?catalog=code]` and `#/services/:id/edit`. */
export function ServiceFormPage({ clinicId, id, catalogCode }: { clinicId: string; id?: string; catalogCode?: string }) {
  const one = useOne(useServices(clinicId), id);
  const catalog = useCatalog(clinicId);
  if (id && !one.data) return <ResourceState {...one} back={to.list('services')} backLabel="الخدمات والأسعار" />;
  if (catalogCode && !catalog.data) return <ResourceState isLoading={catalog.isLoading} isError={catalog.isError} error={catalog.error} notFound={false} refetch={() => void catalog.refetch()} back={to.list('services')} backLabel="الخدمات والأسعار" />;
  const entry = catalogCode ? catalog.data?.find((c) => c.code === catalogCode) : undefined;
  if (catalogCode && !entry) return <ResourceState isLoading={false} isError={false} error={null} notFound refetch={() => undefined} back={to.list('services')} backLabel="الخدمات والأسعار" />;
  return <ServiceFormBody key={id ?? catalogCode ?? 'new'} clinicId={clinicId} service={one.data} catalog={entry} />;
}

function ServiceFormBody({ clinicId, service, catalog }: { clinicId: string; service?: Service; catalog?: CatalogEntry }) {
  const [orig] = useState(() => (service ? toForm(service) : null)); // frozen baseline: a background refetch cannot make the form dirty
  const start = orig ?? fromCatalog(catalog);
  const [form, setForm] = useState<Form>(start);
  const [touched, setTouched] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const invalidate = useInvalidate(clinicId);
  const texts = useConsentTexts(clinicId);
  const leave = useLeave(to.list('services'));
  const errors = validate(form);
  const body = toBody(form, orig, catalog);
  const dirty = orig ? Object.keys(body).length > 0 : JSON.stringify(form) !== JSON.stringify(start);
  const canSave = errors.size === 0 && dirty;
  const show = (k: ServiceFieldError) => (touched || orig) && errors.has(k) ? ERR_KEY[k] : undefined; // no red before the user has typed
  useUnsavedChanges(dirty, 'لديك تغييرات غير محفوظة. هل تريد المغادرة بدون حفظ؟');

  const save = useMutation({
    mutationFn: () => (service
      ? api<Service>(`/services/${service.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      : api<Service>('/services', { method: 'POST', body: JSON.stringify(body) })),
    onSuccess: () => invalidate('services'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setTouched(true); if (canSave) save.mutate(undefined, { onSuccess: () => leave('تم حفظ الخدمة') }); };
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => { setForm((f) => ({ ...f, [k]: v })); setTouched(true); };
  const text = (k: 'nameAr' | 'nameEn' | 'descriptionAr' | 'price' | 'priceMax' | 'duration') => (e: { target: { value: string } }) => set(k)(e.target.value);
  const setActive = (on: boolean) => (on ? set('isActive')(true) : setConfirmOff(true));

  const name = service ? arName(service.name_ar, service.name_en, service.catalog_code ?? '—') : catalog ? arName(catalog.name_ar, catalog.name_en, catalog.code) : 'إضافة خدمة';
  const crumbs = [{ label: 'نظرة عامة', route: to.list('overview') }, { label: 'الخدمات والأسعار', route: to.list('services') }, { label: name }];
  return (
    <FormPage title={service ? 'تعديل الخدمة' : 'إضافة خدمة'} sub={catalog ? `${'من القائمة الجاهزة'}: ${name}` : undefined}
      crumbs={crumbs} back={to.list('services')} onSubmit={submit} saving={save.isPending} canSave={canSave} error={save.error}>
      <Card>
        <h2>البيانات الأساسية</h2>
        <div className="grid-2 mt">
          <Field label="اسم الخدمة" error={show('name')}>{(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.nameAr} onChange={text('nameAr')} dir="auto" maxLength={120} autoFocus={!service && !catalog} />}</Field>
        </div>
        <div className="mt">
          <Field label="وصف قصير بالعربية" optional="اختياري">{(a) => <TextArea id={a.id} value={form.descriptionAr} onChange={text('descriptionAr')} dir="rtl" maxLength={1000} />}</Field>
        </div>
        <div className="mt">
          <ImageField purpose="photo" shape="wide" value={form.image} onChange={set('image')} label="صورة الخدمة" hint="تظهر أعلى بطاقة الخدمة على الموقع. صورة أفقية أفضل." />
        </div>
      </Card>

      <Card>
        <h2>السعر والمدة</h2>
        <div className="grid-3 mt">
          <Field label={`${'السعر'} (${currencyLabel()})`} hint={'بالجنيه. اتركه 0 ليظهر "حسب الكشف"'} error={show('price')}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.price} onChange={text('price')} inputMode="numeric" dir="ltr" placeholder="0" autoFocus={!!catalog} />}
          </Field>
          <Field label="إلى" optional="اختياري" hint="لنطاق سعر، مثل 500–1500" error={show('priceMax')}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.priceMax} onChange={text('priceMax')} inputMode="numeric" dir="ltr" />}
          </Field>
          <Field label={`${'المدة'} (${'دقيقة'})`} error={show('duration')}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.duration} onChange={text('duration')} inputMode="numeric" dir="ltr" />}
          </Field>
        </div>
      </Card>

      <Card>
        <h2>الظهور والحجز</h2>
        <div className="switch-row mt">
          <Switch checked={form.showOnWebsite} onChange={set('showOnWebsite')} label="يظهر على الموقع" />
          <Switch checked={form.bookableOnline} onChange={set('bookableOnline')} label="يمكن حجزها أونلاين" />
          {service && <Switch checked={form.isActive} onChange={setActive} label="نشط" />}
        </div>
      </Card>

      <Card>
        <h2>موافقة المريض</h2>
        <Field label="تحتاج موافقة" hint="عند تسجيل هذا العلاج في زيارة دون موافقة موقّعة يظهر تنبيه للطبيب.">
          {(a) => (
            <Choice id={a.id} value={form.consentKey} onChange={set('consentKey')} noneLabel="لا تحتاج"
              options={(texts.data ?? []).filter((x) => x.is_active).map((x) => ({ value: x.key, label: x.is_draft ? `${x.title_ar} (${'مسودة'})` : x.title_ar }))} />
          )}
        </Field>
      </Card>

      <ConfirmDialog open={confirmOff} title="إيقاف الخدمة؟" confirmLabel="إيقاف" danger
        onConfirm={() => { set('isActive')(false); setConfirmOff(false); }} onCancel={() => setConfirmOff(false)}>
        ستختفي الخدمة من قائمة أسعارك على الموقع فور الحفظ. الفواتير القديمة لا تتأثر.
      </ConfirmDialog>
    </FormPage>
  );
}
