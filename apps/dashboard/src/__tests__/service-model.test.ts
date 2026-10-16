import { describe, expect, it } from 'vitest';
import { fromCatalog, priceParts, toBody, toForm, toMinor, validate } from '../service-model';
import type { CatalogEntry, Service } from '../types';

const rct: CatalogEntry = { code: 'rct', category: 'endodontic', name_en: 'Root canal treatment', name_ar: 'علاج عصب', default_duration_minutes: 90 };
const saved: Service = {
  id: 's1', catalog_code: 'rct', name_ar: 'علاج عصب', name_en: 'Root canal treatment', description_ar: null, description_en: null,
  price_minor: 250000, price_max_minor: null, duration_minutes: 90, bookable_online: true, show_on_website: true, is_active: true, sort_order: 0, image: null,
};

describe('service model', () => {
  it('reads Arabic-Indic digits and whole pounds', () => {
    expect(toMinor('٥٠٠')).toBe(50000);
    expect(toMinor('')).toBe(0);
    expect(validate({ ...fromCatalog(rct), price: '12.5' }).has('price')).toBe(true);
    expect(validate({ ...fromCatalog(rct), price: '500', priceMax: '400' }).has('priceMax')).toBe(true);
    expect(validate({ ...fromCatalog(rct), duration: '3' }).has('duration')).toBe(true);
    expect(validate({ ...fromCatalog(rct), nameAr: 'x', nameEn: '' }).has('name')).toBe(true);
    expect(validate({ ...fromCatalog(rct), price: '500', priceMax: '1500' }).size).toBe(0);
  });

  it('create from the catalogue sends the code and only what differs from the preset', () => {
    expect(toBody({ ...fromCatalog(rct), price: '500' }, null, rct)).toEqual({ catalogCode: 'rct', priceMinor: 50000, bookableOnline: true, showOnWebsite: true });
    expect(toBody({ ...fromCatalog(rct), nameEn: 'RCT', duration: '60', priceMax: '900' }, null, rct)).toMatchObject({ nameEn: 'RCT', durationMinutes: 60, priceMaxMinor: 90000 });
  });

  it('edit sends only changes; an emptied text is null; a cleared range is null', () => {
    const orig = toForm(saved);
    expect(toBody(orig, orig)).toEqual({});
    expect(toBody({ ...orig, nameEn: '', priceMax: '3000' }, orig)).toEqual({ nameEn: null, priceMaxMinor: 300000 });
    expect(toBody({ ...toForm({ ...saved, price_max_minor: 300000 }), priceMax: '' }, toForm({ ...saved, price_max_minor: 300000 }))).toEqual({ priceMaxMinor: null });
    expect(toBody({ ...orig, isActive: false }, orig)).toEqual({ isActive: false });
  });

  it('formats prices as pounds, ranges and "on consultation"', () => {
    const fmt = (n: number) => n.toLocaleString('en-EG');
    expect(priceParts(saved, fmt)).toBe('2,500');
    expect(priceParts({ price_minor: 250000, price_max_minor: 400000 }, fmt)).toBe('2,500–4,000');
    expect(priceParts({ price_minor: 0, price_max_minor: null }, fmt)).toBeNull();
  });
});
