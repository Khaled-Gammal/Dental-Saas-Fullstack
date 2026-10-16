import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { pickName } from '@dental/ui/text';
import { api } from '../api';
import { categoryLabel, minutesLabel, t, type Key, type Lang } from '../i18n';
import { useCatalog, useInvalidate, useServices } from '../queries';
import type { CatalogEntry, Service } from '../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, LinkButton, PageHeader, Skeleton, Switch, TextArea } from '../ui/components';
import { CheckIcon, CloseIcon, EditIcon, PlusIcon, TagIcon } from '../ui/icons';
import { fmtNumber, toAsciiDigits } from '../util';

const FORM_ID = 'service-form';
const PIASTRES = 100;
const MIN_DURATION = 5;
const MAX_DURATION = 480;
const MAX_MINOR = 100_000_000; // 1,000,000 EGP, same cap as the API

type Panel = { kind: 'add'; catalog?: CatalogEntry } | { kind: 'edit'; id: string } | null;

/** Price in whole pounds; 0 = "on consultation". A range shows as 500–1500. */
function priceLabel(s: Pick<Service, 'price_minor' | 'price_max_minor'>, lang: Lang): string {
  if (!s.price_minor && !s.price_max_minor) return t('onConsultation', lang);
  const n = (m: number) => fmtNumber(Math.round(m / PIASTRES), lang);
  const range = s.price_max_minor && s.price_max_minor > s.price_minor ? `${n(s.price_minor)}–${n(s.price_max_minor)}` : n(s.price_minor);
  return `${range} ${t('egp', lang)}`;
}

/** `canWrite` only hides what the API would refuse (settings:write). */
export function Services({ lang, clinicId, canWrite }: { lang: Lang; clinicId: string; canWrite: boolean }) {
  const services = useServices(clinicId);
  const catalog = useCatalog(clinicId);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<Key | null>(null);
  const count = services.data?.length ?? 0;
  const open = (p: Panel) => { setNotice(null); setPanel(p); };
  const done = (msg: Key) => { setNotice(msg); setPanel(null); };
  const editing = panel?.kind === 'edit' ? services.data?.find((s) => s.id === panel.id) : undefined;
  const usedCodes = new Set(services.data?.map((s) => s.catalog_code).filter(Boolean));

  const addBtn = canWrite && panel?.kind !== 'add' && <Button onClick={() => open({ kind: 'add' })}><PlusIcon size={18} />{t('addService', lang)}</Button>;

  return (
    <>
      <PageHeader title={t('navServices', lang)} sub={t('servicesSub', lang)} action={count > 0 ? addBtn : undefined} />
      {notice && !panel && <Alert tone="success">{t(notice, lang)}</Alert>}

      {panel?.kind === 'add' && (
        <ServiceForm key={panel.catalog?.code ?? 'custom'} id={FORM_ID} lang={lang} clinicId={clinicId} catalog={panel.catalog}
          onDone={() => done('serviceAdded')} onCancel={() => setPanel(null)} />
      )}
      {panel?.kind === 'edit' && editing && (
        <ServiceForm key={editing.id} id={FORM_ID} lang={lang} clinicId={clinicId} service={editing} onDone={() => done('serviceSaved')} onCancel={() => setPanel(null)} />
      )}

      {canWrite && catalog.isError && <ErrorText error={catalog.error} onRetry={() => void catalog.refetch()} />}
      {/* the catalogue: one click adds a common dental service with its usual duration */}
      {canWrite && panel?.kind !== 'edit' && catalog.data && catalog.data.length > 0 && (
        <Card className="catalog">
          <h2>{t('fromCatalog', lang)}</h2>
          <p className="muted small">{t('pickService', lang)}</p>
          <ul className="catalog-list">
            {catalog.data.map((c) => {
              const added = usedCodes.has(c.code);
              const picked = panel?.kind === 'add' && panel.catalog?.code === c.code;
              return (
                <li key={c.code}>
                  <button type="button" className={`catalog-item${picked ? ' picked' : ''}`} disabled={added} aria-pressed={picked}
                    onClick={() => open({ kind: 'add', catalog: c })} aria-controls={picked ? FORM_ID : undefined}>
                    <span className="catalog-name"><bdi>{pickName(lang, c.name_ar, c.name_en, c.code)}</bdi></span>
                    <span className="muted small">{categoryLabel(c.category, lang)} · {fmtNumber(c.default_duration_minutes, lang)} {minutesLabel(c.default_duration_minutes, lang)}</span>
                    {added && <span className="catalog-added"><CheckIcon size={14} />{t('alreadyAdded', lang)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {services.isError ? (
        <ErrorText error={services.error} onRetry={() => void services.refetch()} />
      ) : services.isLoading ? (
        <div className="cards"><Skeleton h={96} count={3} /></div>
      ) : count === 0 && panel?.kind !== 'add' ? (
        <Card><EmptyState icon={<TagIcon size={28} />} title={t('noServices', lang)} text={t('noServicesText', lang)} action={addBtn} /></Card>
      ) : (
        <ul className="service-list" aria-busy={services.isFetching || undefined}>
          {services.data?.map((s) => (
            <Card as="li" key={s.id} className={`service${s.is_active ? '' : ' is-inactive'}`}>
              <div className="service-main">
                <strong><bdi>{pickName(lang, s.name_ar, s.name_en, s.catalog_code ?? '—')}</bdi></strong>
                <span className="muted small">
                  {fmtNumber(s.duration_minutes, lang)} {minutesLabel(s.duration_minutes, lang)}
                  {!s.is_active ? <> · <Badge>{t('inactive', lang)}</Badge></> : !s.show_on_website ? <> · <Badge tone="warning">{t('hidden', lang)}</Badge></> : null}
                </span>
              </div>
              <span className="service-price"><bdi dir="ltr">{priceLabel(s, lang)}</bdi></span>{/* ltr: "2,500–4,000" keeps its order inside Arabic text */}
              {canWrite && (
                <LinkButton onClick={() => open({ kind: 'edit', id: s.id })} aria-expanded={panel?.kind === 'edit' && panel.id === s.id}
                  aria-controls={panel?.kind === 'edit' && panel.id === s.id ? FORM_ID : undefined}>
                  <EditIcon size={16} />{t('edit', lang)}
                </LinkButton>
              )}
            </Card>
          ))}
        </ul>
      )}
    </>
  );
}

/* ---------- add / edit form ---------- */

type Form = {
  nameAr: string; nameEn: string; descriptionAr: string; price: string; priceMax: string; duration: string;
  bookableOnline: boolean; showOnWebsite: boolean; isActive: boolean;
};
const pounds = (minor: number | null) => (minor ? String(Math.round(minor / PIASTRES)) : '');
const toForm = (s: Service): Form => ({
  nameAr: s.name_ar ?? '', nameEn: s.name_en ?? '', descriptionAr: s.description_ar ?? '', price: pounds(s.price_minor), priceMax: pounds(s.price_max_minor),
  duration: String(s.duration_minutes), bookableOnline: s.bookable_online, showOnWebsite: s.show_on_website, isActive: s.is_active,
});
const fromCatalog = (c?: CatalogEntry): Form => ({
  nameAr: c?.name_ar ?? '', nameEn: c?.name_en ?? '', descriptionAr: '', price: '', priceMax: '', duration: c ? String(c.default_duration_minutes) : '30',
  bookableOnline: true, showOnWebsite: true, isActive: true,
});
/** Blank -> 0 (on consultation); Arabic-Indic digits are accepted; anything else is NaN (invalid). */
const toMinor = (v: string): number => { const s = toAsciiDigits(v.trim()); return s === '' ? 0 : Math.round(Number(s) * PIASTRES); };
const TEXT_KEYS = ['nameAr', 'nameEn', 'descriptionAr'] as const;

function validate(f: Form, lang: Lang): Partial<Record<'price' | 'priceMax' | 'duration' | 'name', string>> {
  const e: Partial<Record<'price' | 'priceMax' | 'duration' | 'name', string>> = {};
  const price = toMinor(f.price);
  const max = f.priceMax.trim() ? toMinor(f.priceMax) : null;
  const duration = Number(toAsciiDigits(f.duration.trim()));
  if (f.nameAr.trim().length < 2 && f.nameEn.trim().length < 2) e.name = t('needName', lang);
  if (!/^\d*$/.test(toAsciiDigits(f.price.trim())) || price > MAX_MINOR) e.price = t('errPrice', lang);
  if (max !== null && (!/^\d+$/.test(toAsciiDigits(f.priceMax.trim())) || max > MAX_MINOR || max <= price)) e.priceMax = t('errPriceMax', lang);
  if (!Number.isInteger(duration) || duration < MIN_DURATION || duration > MAX_DURATION) e.duration = t('errDuration', lang);
  return e;
}

/** The API body: everything for a create, only what changed for an edit (an emptied text is sent as null). */
function toBody(form: Form, orig: Form | null, catalog?: CatalogEntry): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (!orig && catalog) body.catalogCode = catalog.code;
  for (const k of TEXT_KEYS) {
    const v = form[k].trim();
    if (orig) { if (v !== orig[k].trim()) body[k] = v || null; continue; }
    // create: a blank field is simply left out (the catalogue's name then applies); a catalogue name that was kept is not repeated
    const preset = catalog && k !== 'descriptionAr' ? catalog[k === 'nameAr' ? 'name_ar' : 'name_en'] : '';
    if (v && v !== preset) body[k] = v;
  }
  const price = toMinor(form.price);
  const max = form.priceMax.trim() ? toMinor(form.priceMax) : null;
  if (!orig || price !== toMinor(orig.price)) body.priceMinor = price;
  if (!orig ? max !== null : max !== (orig.priceMax.trim() ? toMinor(orig.priceMax) : null)) body.priceMaxMinor = max;
  const duration = Number(toAsciiDigits(form.duration.trim()));
  if (!orig ? duration !== (catalog?.default_duration_minutes ?? NaN) : duration !== Number(orig.duration)) body.durationMinutes = duration;
  for (const k of ['bookableOnline', 'showOnWebsite'] as const) if (!orig || form[k] !== orig[k]) body[k] = form[k];
  if (orig && form.isActive !== orig.isActive) body.isActive = form.isActive;
  return body;
}

function ServiceForm({ id, lang, clinicId, service, catalog, onDone, onCancel }: {
  id: string; lang: Lang; clinicId: string; service?: Service; catalog?: CatalogEntry; onDone: () => void; onCancel: () => void;
}) {
  const orig = service ? toForm(service) : null;
  const [form, setForm] = useState<Form>(orig ?? fromCatalog(catalog));
  const [touched, setTouched] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const invalidate = useInvalidate(clinicId);
  const errors = validate(form, lang);
  const body = toBody(form, orig, catalog);
  const dirty = Object.keys(body).length > 0;
  const valid = Object.keys(errors).length === 0;
  const canSave = valid && (!orig || dirty);
  const show = (k: keyof typeof errors) => (touched || orig ? errors[k] : undefined); // no red before the user has typed

  const save = useMutation({
    mutationFn: () => (service
      ? api<Service>(`/services/${service.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      : api<Service>('/services', { method: 'POST', body: JSON.stringify(body) })),
    onSuccess: async () => { await invalidate('services'); onDone(); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setTouched(true); if (canSave) save.mutate(); };
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => { setForm((f) => ({ ...f, [k]: v })); setTouched(true); };
  const text = (k: 'nameAr' | 'nameEn' | 'descriptionAr' | 'price' | 'priceMax' | 'duration') => (e: { target: { value: string } }) => set(k)(e.target.value);

  return (
    <Card className="form-card" id={id}>
      <div className="hours-head">
        <div>
          <h2 ref={title} tabIndex={-1}>{t(service ? 'editService' : 'addService', lang)}</h2>
          {catalog && <p className="muted small">{t('fromCatalog', lang)}: <bdi>{pickName(lang, catalog.name_ar, catalog.name_en, catalog.code)}</bdi></p>}
        </div>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label={t('cancel', lang)}><CloseIcon /></button>
      </div>
      <form onSubmit={submit} className="stack">
        <div className="grid-2">
          <Field label={t('serviceNameAr', lang)} error={show('name')}>{(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.nameAr} onChange={text('nameAr')} dir="rtl" maxLength={120} />}</Field>
          <Field label={t('serviceNameEn', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={form.nameEn} onChange={text('nameEn')} dir="ltr" maxLength={120} />}</Field>
        </div>
        <Field label={t('descriptionAr', lang)} optional={t('optional', lang)}>{(a) => <TextArea id={a.id} value={form.descriptionAr} onChange={text('descriptionAr')} dir="rtl" maxLength={1000} />}</Field>
        <div className="grid-3">
          <Field label={`${t('price', lang)} (${t('egp', lang)})`} hint={t('priceHint', lang)} error={show('price')}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.price} onChange={text('price')} inputMode="numeric" dir="ltr" placeholder="0" />}
          </Field>
          <Field label={t('priceMax', lang)} optional={t('optional', lang)} hint={t('priceRangeHint', lang)} error={show('priceMax')}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.priceMax} onChange={text('priceMax')} inputMode="numeric" dir="ltr" />}
          </Field>
          <Field label={`${t('duration', lang)} (${t('minutes', lang)})`} error={show('duration')}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.duration} onChange={text('duration')} inputMode="numeric" dir="ltr" />}
          </Field>
        </div>
        <div className="switch-row">
          <Switch checked={form.showOnWebsite} onChange={set('showOnWebsite')} label={t('showOnWebsite', lang)} />
          <Switch checked={form.bookableOnline} onChange={set('bookableOnline')} label={t('bookableOnline', lang)} />
          {service && <Switch checked={form.isActive} onChange={set('isActive')} label={t('isActive', lang)} />}
        </div>
        <ErrorText error={save.error} />
        <div className="row-end">
          <Button variant="ghost" onClick={onCancel}>{t('cancel', lang)}</Button>
          <Button type="submit" loading={save.isPending} disabled={!canSave}>{t('save', lang)}</Button>
        </div>
      </form>
    </Card>
  );
}
