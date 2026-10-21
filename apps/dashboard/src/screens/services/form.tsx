import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { arName } from '@dental/ui/text';
import { api } from '../../api';
import { ImageField } from '../../components/image-field';
import { useLeave, useUnsavedChanges } from '../../hooks';
import { useDoctors, useInvalidate, useOne, useServices } from '../../queries';
import { to } from '../../router';
import { emptyForm, toBody, toForm, validate, type ServiceFieldError, type ServiceForm as Form } from '../../service-model';
import type { Doctor, Service } from '../../types';
import { Badge, Card, Field, Input, Switch, TextArea } from '../../ui/components';
import { Checkbox } from '../../components/ui/checkbox';
import { Choice } from '../../components/choice';
import { useConsentTexts } from '../consents/templates';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { FormPage, ResourceState } from '../../ui/page';
import { currencyLabel } from '../../money';

const ERR_KEY: Record<ServiceFieldError, string> = { name: 'أدخل الاسم بالعربية أو الإنجليزية', price: 'أدخل السعر بالجنيه كرقم صحيح (حتى مليون)', priceMax: 'الحد الأعلى يجب أن يكون أكبر من السعر', duration: 'المدة بين 5 و480 دقيقة' };

/** `#/services/new` and `#/services/:id/edit`. The clinic types its own services (owner 2026-10-21: no ready-made list). */
export function ServiceFormPage({ clinicId, id }: { clinicId: string; id?: string }) {
  const one = useOne(useServices(clinicId), id);
  const doctors = useDoctors(clinicId);
  if (id && !one.data) return <ResourceState {...one} back={to.list('services')} backLabel="الخدمات والأسعار" />;
  // the doctors come first: a new service starts with every active doctor ticked
  if (!doctors.data) return <ResourceState isLoading={doctors.isLoading} isError={doctors.isError} error={doctors.error} notFound={false} refetch={() => void doctors.refetch()} back={to.list('services')} backLabel="الخدمات والأسعار" />;
  return <ServiceFormBody key={id ?? 'new'} clinicId={clinicId} service={one.data} doctors={doctors.data} />;
}

function ServiceFormBody({ clinicId, service, doctors }: { clinicId: string; service?: Service; doctors: Doctor[] }) {
  const [orig] = useState(() => (service ? toForm(service) : null)); // frozen baseline: a background refetch cannot make the form dirty
  const [start] = useState(() => orig ?? emptyForm(doctors.filter((d) => d.is_active).map((d) => d.id)));
  const [form, setForm] = useState<Form>(start);
  const [touched, setTouched] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const invalidate = useInvalidate(clinicId);
  const texts = useConsentTexts(clinicId);
  const leave = useLeave(to.list('services'));
  const errors = validate(form);
  const body = toBody(form, orig);
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
  const toggleDoctor = (doctorId: string, on: boolean) =>
    set('doctorIds')((on ? [...form.doctorIds, doctorId] : form.doctorIds.filter((d) => d !== doctorId)).sort());
  // active doctors, and an inactive one only while it is still ticked (so it can be unticked)
  const shownDoctors = doctors.filter((d) => d.is_active || form.doctorIds.includes(d.id));

  const name = service ? arName(service.name_ar, service.name_en, service.catalog_code ?? '—') : 'إضافة خدمة';
  const crumbs = [{ label: 'نظرة عامة', route: to.list('overview') }, { label: 'الخدمات والأسعار', route: to.list('services') }, { label: name }];
  return (
    <FormPage title={service ? 'تعديل الخدمة' : 'إضافة خدمة'}
      crumbs={crumbs} back={to.list('services')} onSubmit={submit} saving={save.isPending} canSave={canSave} error={save.error}>
      <Card>
        <h2>البيانات الأساسية</h2>
        <div className="grid-2 mt">
          <Field label="اسم الخدمة" error={show('name')}>{(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.nameAr} onChange={text('nameAr')} dir="auto" maxLength={120} autoFocus={!service} />}</Field>
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
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.price} onChange={text('price')} inputMode="numeric" dir="ltr" placeholder="0" />}
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
        <fieldset className="check-group">
          <legend>الأطباء الذين يقدمونها</legend>
          <p className="muted small">عند حجز هذه الخدمة، من العيادة أو من الموقع، يظهر هؤلاء الأطباء فقط.</p>
          {shownDoctors.length > 0 ? (
            <div className="branch-checks">
              {shownDoctors.map((d) => (
                <label key={d.id} className="check">
                  <Checkbox checked={form.doctorIds.includes(d.id)} onCheckedChange={(v) => toggleDoctor(d.id, v === true)} />
                  <bdi>{arName(d.name_ar, d.name_en, '—')}</bdi>{!d.is_active && <Badge>غير نشط</Badge>}
                </label>
              ))}
            </div>
          ) : <p className="muted small">لا يوجد أطباء بعد. أضفهم من صفحة الأطباء؛ كل طبيب جديد يقدّم كل الخدمات حتى تغيّر ذلك هنا.</p>}
          {shownDoctors.length > 0 && form.doctorIds.length === 0 && <p className="field-error">لن يمكن حجز هذه الخدمة حتى تختار طبيبًا واحدًا على الأقل.</p>}
        </fieldset>
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
