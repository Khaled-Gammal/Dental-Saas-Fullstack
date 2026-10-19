import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { arName } from '@dental/ui/text';
import { api } from '../../api';
import { ImageField } from '../../components/image-field';
import { useLeave, useUnsavedChanges } from '../../hooks';
import { t, type Key } from '../../i18n';
import { useCatalog, useInvalidate, useOne, useServices } from '../../queries';
import { to } from '../../router';
import { fromCatalog, toBody, toForm, validate, type ServiceFieldError, type ServiceForm as Form } from '../../service-model';
import type { CatalogEntry, Service } from '../../types';
import { Card, Field, Input, Switch, TextArea } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { FormPage, ResourceState } from '../../ui/page';
import { currencyLabel } from '../../money';

const ERR_KEY: Record<ServiceFieldError, Key> = { name: 'needName', price: 'errPrice', priceMax: 'errPriceMax', duration: 'errDuration' };

/** `#/services/new[?catalog=code]` and `#/services/:id/edit`. */
export function ServiceFormPage({ clinicId, id, catalogCode }: { clinicId: string; id?: string; catalogCode?: string }) {
  const one = useOne(useServices(clinicId), id);
  const catalog = useCatalog(clinicId);
  if (id && !one.data) return <ResourceState {...one} back={to.list('services')} backLabel={t('navServices')} />;
  if (catalogCode && !catalog.data) return <ResourceState isLoading={catalog.isLoading} isError={catalog.isError} error={catalog.error} notFound={false} refetch={() => void catalog.refetch()} back={to.list('services')} backLabel={t('navServices')} />;
  const entry = catalogCode ? catalog.data?.find((c) => c.code === catalogCode) : undefined;
  if (catalogCode && !entry) return <ResourceState isLoading={false} isError={false} error={null} notFound refetch={() => undefined} back={to.list('services')} backLabel={t('navServices')} />;
  return <ServiceFormBody key={id ?? catalogCode ?? 'new'} clinicId={clinicId} service={one.data} catalog={entry} />;
}

function ServiceFormBody({ clinicId, service, catalog }: { clinicId: string; service?: Service; catalog?: CatalogEntry }) {
  const [orig] = useState(() => (service ? toForm(service) : null)); // frozen baseline: a background refetch cannot make the form dirty
  const start = orig ?? fromCatalog(catalog);
  const [form, setForm] = useState<Form>(start);
  const [touched, setTouched] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const invalidate = useInvalidate(clinicId);
  const leave = useLeave(to.list('services'));
  const errors = validate(form);
  const body = toBody(form, orig, catalog);
  const dirty = orig ? Object.keys(body).length > 0 : JSON.stringify(form) !== JSON.stringify(start);
  const canSave = errors.size === 0 && dirty;
  const show = (k: ServiceFieldError) => (touched || orig) && errors.has(k) ? t(ERR_KEY[k]) : undefined; // no red before the user has typed
  useUnsavedChanges(dirty, t('leaveUnsaved'));

  const save = useMutation({
    mutationFn: () => (service
      ? api<Service>(`/services/${service.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      : api<Service>('/services', { method: 'POST', body: JSON.stringify(body) })),
    onSuccess: () => invalidate('services'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setTouched(true); if (canSave) save.mutate(undefined, { onSuccess: () => leave(t('serviceSaved')) }); };
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => { setForm((f) => ({ ...f, [k]: v })); setTouched(true); };
  const text = (k: 'nameAr' | 'nameEn' | 'descriptionAr' | 'price' | 'priceMax' | 'duration') => (e: { target: { value: string } }) => set(k)(e.target.value);
  const setActive = (on: boolean) => (on ? set('isActive')(true) : setConfirmOff(true));

  const name = service ? arName(service.name_ar, service.name_en, service.catalog_code ?? '—') : catalog ? arName(catalog.name_ar, catalog.name_en, catalog.code) : t('addService');
  const crumbs = [{ label: t('navOverview'), route: to.list('overview') }, { label: t('navServices'), route: to.list('services') }, { label: name }];
  return (
    <FormPage title={t(service ? 'editService' : 'addService')} sub={catalog ? `${t('fromCatalog')}: ${name}` : undefined}
      crumbs={crumbs} back={to.list('services')} onSubmit={submit} saving={save.isPending} canSave={canSave} error={save.error}>
      <Card>
        <h2>{t('secBasics')}</h2>
        <div className="grid-2 mt">
          <Field label={t('serviceNameAr')} error={show('name')}>{(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.nameAr} onChange={text('nameAr')} dir="auto" maxLength={120} autoFocus={!service && !catalog} />}</Field>
        </div>
        <div className="mt">
          <Field label={t('descriptionAr')} optional={t('optional')}>{(a) => <TextArea id={a.id} value={form.descriptionAr} onChange={text('descriptionAr')} dir="rtl" maxLength={1000} />}</Field>
        </div>
        <div className="mt">
          <ImageField purpose="photo" shape="wide" value={form.image} onChange={set('image')} label={t('serviceImage')} hint={t('serviceImageHint')} />
        </div>
      </Card>

      <Card>
        <h2>{t('secPricing')}</h2>
        <div className="grid-3 mt">
          <Field label={`${t('price')} (${currencyLabel()})`} hint={t('priceHint')} error={show('price')}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.price} onChange={text('price')} inputMode="numeric" dir="ltr" placeholder="0" autoFocus={!!catalog} />}
          </Field>
          <Field label={t('priceMax')} optional={t('optional')} hint={t('priceRangeHint')} error={show('priceMax')}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.priceMax} onChange={text('priceMax')} inputMode="numeric" dir="ltr" />}
          </Field>
          <Field label={`${t('duration')} (${t('minutes')})`} error={show('duration')}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.duration} onChange={text('duration')} inputMode="numeric" dir="ltr" />}
          </Field>
        </div>
      </Card>

      <Card>
        <h2>{t('secVisibility')}</h2>
        <div className="switch-row mt">
          <Switch checked={form.showOnWebsite} onChange={set('showOnWebsite')} label={t('showOnWebsite')} />
          <Switch checked={form.bookableOnline} onChange={set('bookableOnline')} label={t('bookableOnline')} />
          {service && <Switch checked={form.isActive} onChange={setActive} label={t('isActive')} />}
        </div>
      </Card>

      <ConfirmDialog open={confirmOff} title={t('deactivateService')} confirmLabel={t('deactivate')} danger
        onConfirm={() => { set('isActive')(false); setConfirmOff(false); }} onCancel={() => setConfirmOff(false)}>
        {t('deactivateServiceText')}
      </ConfirmDialog>
    </FormPage>
  );
}
