import { describe, expect, it } from 'vitest';
import { emptyForm, priceParts, toBody, toForm, toMinor, validate } from '../service-model';
import type { Service } from '../types';

const named = { ...emptyForm(), nameAr: 'علاج عصب' };
const saved: Service = {
  id: 's1', catalog_code: 'rct', name_ar: 'علاج عصب', name_en: 'Root canal treatment', description_ar: null, description_en: null,
  price_minor: 250000, price_max_minor: null, duration_minutes: 90, bookable_online: true, show_on_website: true, is_active: true, sort_order: 0, image: null,
  doctor_ids: ['d2', 'd1'],
};

describe('service model', () => {
  it('reads Arabic-Indic digits and whole pounds', () => {
    expect(toMinor('٥٠٠')).toBe(50000);
    expect(toMinor('')).toBe(0);
    expect(validate({ ...named, price: '12.5' }).has('price')).toBe(true);
    expect(validate({ ...named, price: '500', priceMax: '400' }).has('priceMax')).toBe(true);
    expect(validate({ ...named, duration: '3' }).has('duration')).toBe(true);
    expect(validate({ ...named, nameAr: 'x', nameEn: '' }).has('name')).toBe(true);
    expect(validate({ ...named, price: '500', priceMax: '1500' }).size).toBe(0);
  });

  it('a new service is typed by the clinic and starts with the given doctors', () => {
    expect(emptyForm(['d2', 'd1']).doctorIds).toEqual(['d1', 'd2']);
    expect(validate(emptyForm()).has('name')).toBe(true); // nothing is filled in for the clinic
    expect(toBody({ ...emptyForm(['d1']), nameAr: 'كشف', price: '500' }, null)).toEqual({
      nameAr: 'كشف', priceMinor: 50000, durationMinutes: 30, bookableOnline: true, showOnWebsite: true, doctorIds: ['d1'],
    });
    expect(toBody({ ...named, nameEn: 'RCT', duration: '60', priceMax: '900' }, null)).toMatchObject({ nameEn: 'RCT', durationMinutes: 60, priceMaxMinor: 90000, doctorIds: [] });
  });

  it('edit sends only changes; an emptied text is null; a cleared range is null', () => {
    const orig = toForm(saved);
    expect(toBody(orig, orig)).toEqual({});
    expect(toBody({ ...orig, nameEn: '', priceMax: '3000' }, orig)).toEqual({ nameEn: null, priceMaxMinor: 300000 });
    expect(toBody({ ...toForm({ ...saved, price_max_minor: 300000 }), priceMax: '' }, toForm({ ...saved, price_max_minor: 300000 }))).toEqual({ priceMaxMinor: null });
    expect(toBody({ ...orig, isActive: false }, orig)).toEqual({ isActive: false });
  });

  it('doctors are sent on edit only when the set changes, whatever the order', () => {
    const orig = toForm(saved);
    expect(orig.doctorIds).toEqual(['d1', 'd2']);
    expect(toBody({ ...orig, doctorIds: ['d1', 'd2'] }, orig)).toEqual({});
    expect(toBody({ ...orig, doctorIds: ['d1'] }, orig)).toEqual({ doctorIds: ['d1'] });
    expect(toBody({ ...orig, doctorIds: [] }, orig)).toEqual({ doctorIds: [] });
  });

  it('formats prices as pounds, ranges and "on consultation"', () => {
    const fmt = (n: number) => n.toLocaleString('en-EG');
    expect(priceParts(saved, fmt)).toBe('2,500');
    expect(priceParts({ price_minor: 250000, price_max_minor: 400000 }, fmt)).toBe('2,500–4,000');
    expect(priceParts({ price_minor: 0, price_max_minor: null }, fmt)).toBeNull();
  });
});
