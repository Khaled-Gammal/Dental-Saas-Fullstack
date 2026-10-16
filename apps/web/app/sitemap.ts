import type { MetadataRoute } from 'next';
import { isPlatformHost, requestHost } from '../lib/host';
import { getSite, originOf } from '../lib/site';

/**
 * sitemap.xml per hostname (SRS WEB-06). A clinic site is one page today (sections, not sub-pages); the booking page
 * is deliberately left out (it is `noindex`). Unknown hostnames get an empty sitemap.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = await requestHost();
  if (!host) return [];
  if (!isPlatformHost(host) && !(await getSite(host))) return [];
  return [{ url: `${originOf(host)}/`, changeFrequency: 'weekly', priority: 1 }];
}
