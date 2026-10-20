import { toAsciiDigits } from '@dental/ui/text';
import { imageFieldValue } from './media-model';
import type { CatalogEntry, MediaImage, Service } from './types';

/** Pure price-list logic for the service form (no React): mirrors the API's zod rules. */

export const PIASTRES = 100;
export const MIN_DURATION = 5;
export const MAX_DURATION = 480;
export const MAX_MINOR = 100_000_000; // 1,000,000 EGP, same cap as the API

export interface ServiceForm {
  nameAr: string; nameEn: string; descriptionAr: string; price: string; priceMax: string; duration: string;
  bookableOnline: boolean; showOnWebsite: boolean; isActive: boolean; image: MediaImage | null;
  /** H9: a consent text's key, '' = none needed */
  consentKey: string;
}
export type ServiceFieldError = 'name' | 'price' | 'priceMax' | 'duration';

const pounds = (minor: number | null) => (minor ? String(Math.round(minor / PIASTRES)) : '');
export const toForm = (s: Service): ServiceForm => ({
  nameAr: s.name_ar ?? '', nameEn: s.name_en ?? '', descriptionAr: s.description_ar ?? '', price: pounds(s.price_minor), priceMax: pounds(s.price_max_minor),
  duration: String(s.duration_minutes), bookableOnline: s.bookable_online, showOnWebsite: s.show_on_website, isActive: s.is_active,
  image: s.image ?? null, consentKey: s.consent_key ?? '',
});
export const fromCatalog = (c?: CatalogEntry): ServiceForm => ({
  nameAr: c?.name_ar ?? '', nameEn: c?.name_en ?? '', descriptionAr: '', price: '', priceMax: '', duration: c ? String(c.default_duration_minutes) : '30',
  bookableOnline: true, showOnWebsite: true, isActive: true, image: null, consentKey: '',
});

const digits = (v: string) => toAsciiDigits(v.trim());
/** Blank -> 0 (on consultation); Arabic-Indic digits are accepted; anything else is NaN (invalid). */
export const toMinor = (v: string): number => { const s = digits(v); return s === '' ? 0 : Math.round(Number(s) * PIASTRES); };
const TEXT = ['nameAr', 'nameEn', 'descriptionAr'] as const;

/** Which fields are wrong (the screen turns the keys into words). */
export function validate(f: ServiceForm): Set<ServiceFieldError> {
  const e = new Set<ServiceFieldError>();
  const price = toMinor(f.price);
  const max = f.priceMax.trim() ? toMinor(f.priceMax) : null;
  const duration = Number(digits(f.duration));
  if (f.nameAr.trim().length < 2 && f.nameEn.trim().length < 2) e.add('name');
  if (!/^\d*$/.test(digits(f.price)) || price > MAX_MINOR) e.add('price');
  if (max !== null && (!/^\d+$/.test(digits(f.priceMax)) || max > MAX_MINOR || max <= price)) e.add('priceMax');
  if (!Number.isInteger(duration) || duration < MIN_DURATION || duration > MAX_DURATION) e.add('duration');
  return e;
}

/** The API body: everything for a create, only what changed for an edit (an emptied text is sent as null). */
export function toBody(form: ServiceForm, orig: ServiceForm | null, catalog?: CatalogEntry): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (!orig && catalog) body.catalogCode = catalog.code;
  for (const k of TEXT) {
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
  const duration = Number(digits(form.duration));
  if (!orig ? duration !== (catalog?.default_duration_minutes ?? NaN) : duration !== Number(orig.duration)) body.durationMinutes = duration;
  for (const k of ['bookableOnline', 'showOnWebsite'] as const) if (!orig || form[k] !== orig[k]) body[k] = form[k];
  if (orig && form.isActive !== orig.isActive) body.isActive = form.isActive;
  if (orig ? form.consentKey !== orig.consentKey : !!form.consentKey) body.consentKey = form.consentKey || null;
  const image = imageFieldValue(form.image, orig ? orig.image : undefined);
  if (image !== undefined) body.imageFileId = image;
  return body;
}

/** Whole pounds; 0 = "on consultation" (caller supplies the words); a range as "500–1,500". */
export function priceParts(s: Pick<Service, 'price_minor' | 'price_max_minor'>, fmt: (n: number) => string): string | null {
  if (!s.price_minor && !s.price_max_minor) return null;
  const n = (m: number) => fmt(Math.round(m / PIASTRES));
  return s.price_max_minor && s.price_max_minor > s.price_minor ? `${n(s.price_minor)}–${n(s.price_max_minor)}` : n(s.price_minor);
}
