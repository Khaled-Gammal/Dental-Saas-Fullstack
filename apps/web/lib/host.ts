import { headers } from 'next/headers';

/** A DNS name: labels of a-z, 0-9 and '-', at most 253 characters (same rule as middleware.ts). */
const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** The platform's own hostnames (landing page), as the middleware decides them. */
export function isPlatformHost(host: string): boolean {
  const root = process.env.ROOT_DOMAIN ?? 'lvh.me';
  return host === root || host === `www.${root}` || host === 'localhost' || host === '127.0.0.1';
}

/**
 * The hostname of the current request, lower-cased and without a port, for routes the middleware does not rewrite
 * (robots.txt, sitemap.xml). Null for a malformed Host header.
 */
export async function requestHost(): Promise<string | null> {
  const host = ((await headers()).get('host') ?? '').toLowerCase().split(':')[0];
  return HOST_RE.test(host) ? host : null;
}
