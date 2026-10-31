import { describe, expect, it } from 'vitest';
import { breadcrumbData, clip, homeDescription, homeTitle, jsonLd, serviceDescription, serviceStructuredData, shareImagePath } from '../seo';
import type { SiteData, SiteService } from '../site';

const site = (over: Partial<SiteData> = {}): SiteData => ({
  clinic: { slug: 'smile', name_ar: 'عيادة الابتسامة', name_en: null, about_ar: null, about_en: null, primary_phone: null, whatsapp: null, specialties: [],
    default_locale: 'ar', timezone: 'Africa/Cairo', currency: 'EGP' },
  theme: {}, showPoweredBy: true, onlineBooking: false, branches: [], holidays: [], services: [], doctors: [], sections: [], faqs: [], photos: [], cases: [],
  seo: { title: null, description: null, shareVersion: null }, ...over,
});
const svc = (over: Partial<SiteService> = {}): SiteService => ({
  id: 's1', name_ar: 'تبييض الأسنان', name_en: null, description_ar: null, description_en: null, category: null, price_minor: 150000, price_max_minor: null,
  duration_minutes: 60, ...over,
});

describe('search and sharing (Phase 2C-3)', () => {
  it('the clinic\'s own title and description first, else the defaults', () => {
    expect(homeTitle(site())).toBe('عيادة الابتسامة | عيادة أسنان');
    expect(homeTitle(site({ seo: { title: 'أفضل عيادة أسنان في نصر', description: null, shareVersion: null } }))).toBe('أفضل عيادة أسنان في نصر');
    expect(homeDescription(site())).toContain('احجز موعدك في عيادة الابتسامة');
    expect(homeDescription(site({ seo: { title: null, description: '  تبييض وتقويم  ', shareVersion: null } }))).toBe('تبييض وتقويم');
  });
  it('cuts a long description at a word, with an ellipsis', () => {
    const c = clip('كلمة '.repeat(60));
    expect(c.length).toBeLessThanOrEqual(160);
    expect(c.endsWith('…')).toBe(true);
    expect(c.endsWith(' …')).toBe(false);
  });
  it('a service page describes the service from its own text, or its price and length', () => {
    expect(serviceDescription(svc({ description_ar: 'جلسة تبييض بالليزر' }), site())).toBe('جلسة تبييض بالليزر');
    const d = serviceDescription(svc(), site());
    expect(d).toContain('تبييض الأسنان في عيادة الابتسامة');
    expect(d).toContain('1,500 ج.م');
  });
  it('the share image is versioned', () => {
    expect(shareImagePath(site())).toBe('/share-image.jpg');
    expect(shareImagePath(site({ seo: { title: null, description: null, shareVersion: 'ab12' } }))).toBe('/share-image.jpg?v=ab12');
  });
  it('schema.org: a priced service with its offer, a range as min/max, none when on consultation', () => {
    expect(serviceStructuredData(svc(), site(), 'https://smile.example')).toMatchObject({
      '@type': 'Service', url: 'https://smile.example/services/s1', offers: { price: 1500, priceCurrency: 'EGP' }, provider: { '@type': 'Dentist' },
    });
    expect(serviceStructuredData(svc({ price_max_minor: 300000 }), site(), 'https://x').offers).toMatchObject({ priceSpecification: { minPrice: 1500, maxPrice: 3000 } });
    expect(serviceStructuredData(svc({ price_minor: 0 }), site(), 'https://x').offers).toBeUndefined();
    expect(breadcrumbData([{ name: 'الرئيسية', url: 'https://x/' }]).itemListElement[0]).toMatchObject({ position: 1, name: 'الرئيسية' });
  });
  it('JSON-LD cannot close its script tag', () => {
    expect(jsonLd({ a: '</script><script>alert(1)</script>' })).not.toContain('<');
  });
});
