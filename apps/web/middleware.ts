import { NextResponse, type NextRequest } from 'next/server';

/** A DNS name: labels of a-z, 0-9 and '-', at most 253 characters. */
const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * One Next.js app serves the landing page and every clinic website.
 *   lvh.me:3000            -> landing (app/page.tsx)
 *   clinic-a.lvh.me:3000   -> app/sites/[host] with host = clinic-a.lvh.me
 *   www.drclinic.com       -> same, once the clinic's custom domain is verified
 */
export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').toLowerCase().split(':')[0];
  // reject junk Host headers before they become an API call and a cache entry
  if (!HOST_RE.test(host)) return new NextResponse('Bad host', { status: 400 });
  const root = process.env.ROOT_DOMAIN ?? 'lvh.me';
  const isPlatform = host === root || host === `www.${root}` || host === 'localhost' || host === '127.0.0.1';
  const url = req.nextUrl.clone();

  if (isPlatform) {
    if (url.pathname.startsWith('/sites')) return NextResponse.rewrite(new URL('/404', req.url)); // not reachable directly
    return NextResponse.next();
  }
  url.pathname = `/sites/${host}${url.pathname === '/' ? '' : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico|robots.txt|sitemap.xml).*)'],
};
