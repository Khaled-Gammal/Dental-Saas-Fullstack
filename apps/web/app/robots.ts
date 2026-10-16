import type { MetadataRoute } from 'next';
import { isPlatformHost, requestHost } from '../lib/host';
import { getSite, originOf } from '../lib/site';

/**
 * robots.txt per hostname (SRS WEB-06): a clinic site (or the landing page) may be crawled and points at its own
 * sitemap; a hostname that belongs to no live clinic asks crawlers to stay away. The booking wizard is excluded,
 * like the internal booking proxy.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = await requestHost();
  const live = !!host && (isPlatformHost(host) || !!(await getSite(host)));
  if (!host || !live) return { rules: { userAgent: '*', disallow: '/' } };
  const origin = originOf(host);
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/book'] },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
