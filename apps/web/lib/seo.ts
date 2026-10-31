import { ar, arNoun, NOUNS, priceText, type SiteData, type SiteService } from './site';

/**
 * Phase 2C-3: what a clinic's pages say to search engines and when shared — titles, descriptions, the share image's
 * address, and schema.org data built from published facts only (no medical claims). Pure, unit-tested.
 */
export const clinicName = (site: SiteData) => ar(site.clinic.name_ar, site.clinic.name_en) ?? site.clinic.slug;

/** A description cut at a word boundary to what search results show (about 160 characters). */
export function clip(text: string, max = 160): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).trim()}…`;
}

export function homeTitle(site: SiteData): string {
  return site.seo?.title?.trim() || `${clinicName(site)} | عيادة أسنان`;
}

/** The clinic's own description as written (up to 200 characters); the fallbacks cut to what results show. */
export function homeDescription(site: SiteData): string {
  const own = site.seo?.description?.trim();
  if (own) return own;
  return clip(ar(site.clinic.about_ar, site.clinic.about_en) ?? `احجز موعدك في ${clinicName(site)}: خدمات أسنان بأسعار واضحة، أطباء متخصصون ومواعيد عمل محدّثة.`);
}

/** The share image (1200×630 JPEG made by the API), versioned so a new image or logo refreshes shared links. */
export const shareImagePath = (site: SiteData) => `/share-image.jpg${site.seo?.shareVersion ? `?v=${encodeURIComponent(site.seo.shareVersion)}` : ''}`;

export function serviceTitle(service: SiteService, site: SiteData): string {
  return `${ar(service.name_ar, service.name_en) ?? 'خدمة'} | ${clinicName(site)}`;
}

export function serviceDescription(service: SiteService, site: SiteData): string {
  const name = ar(service.name_ar, service.name_en) ?? 'الخدمة';
  const own = ar(service.description_ar, service.description_en);
  if (own) return clip(own);
  const city = site.branches[0]?.city;
  return clip(`${name} في ${clinicName(site)}${city ? ` – ${city}` : ''}. السعر: ${priceText(service.price_minor, service.price_max_minor, site.clinic.currency)}، `
    + `المدة حوالي ${service.duration_minutes} ${arNoun(service.duration_minutes, NOUNS.minute)}. احجز موعدك الآن.`);
}

/** schema.org: the service as offered by the clinic, with its price when it has one. */
export function serviceStructuredData(service: SiteService, site: SiteData, origin: string) {
  const name = ar(service.name_ar, service.name_en) ?? '';
  const priced = service.price_minor > 0;
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name,
    description: ar(service.description_ar, service.description_en) ?? undefined,
    url: `${origin}/services/${service.id}`,
    provider: { '@type': 'Dentist', name: clinicName(site), url: `${origin}/` },
    offers: priced ? {
      '@type': 'Offer', priceCurrency: site.clinic.currency ?? 'EGP',
      ...(service.price_max_minor && service.price_max_minor > service.price_minor
        ? { priceSpecification: { '@type': 'PriceSpecification', minPrice: service.price_minor / 100, maxPrice: service.price_max_minor / 100, priceCurrency: site.clinic.currency ?? 'EGP' } }
        : { price: service.price_minor / 100 }),
    } : undefined,
  };
}

export function breadcrumbData(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

/** JSON for a <script type="application/ld+json">: `<` escaped so no text can close the tag. */
export const jsonLd = (o: object) => JSON.stringify(o).replace(/</g, '\\u003c');
