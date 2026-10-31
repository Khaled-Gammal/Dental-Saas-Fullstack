import type { MetadataRoute } from 'next';
import { isPlatformHost, requestHost } from '../lib/host';
import { visibleSections } from '../lib/sections';
import { getSite, originOf } from '../lib/site';

/**
 * sitemap.xml per hostname (SRS WEB-06): the home page and, for a clinic, each service's own page (Phase 2C-3); the
 * booking page is deliberately left out (it is `noindex`). Unknown hostnames get an empty sitemap.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = await requestHost();
  if (!host) return [];
  const home = { url: `${originOf(host)}/`, changeFrequency: 'weekly' as const, priority: 1 };
  if (isPlatformHost(host)) return [home];
  const site = await getSite(host);
  if (!site) return [];
  // service pages exist while the clinic shows its services section
  if (!visibleSections(site.sections).includes('services')) return [home];
  return [home, ...site.services.map((s) => ({ url: `${originOf(host)}/services/${s.id}`, changeFrequency: 'monthly' as const, priority: 0.8 }))];
}
