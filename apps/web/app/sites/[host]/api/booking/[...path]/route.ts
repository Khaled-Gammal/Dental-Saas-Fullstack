import { NextResponse, type NextRequest } from 'next/server';
import { clientIp } from '../../../../../../lib/client-ip';

/**
 * Same-origin proxy for the booking wizard: the browser talks to the clinic's own hostname, this forwards to the
 * API's public booking endpoints and stamps the hostname on every call. No CORS, no API hostname in the browser,
 * and only the booking paths can be reached.
 *
 * Client address (the API's per-IP throttles depend on it): the browser's own X-Forwarded-For is never passed on.
 * Only the right-most entry is used — the one our edge proxy (Caddy in production) wrote — and it is sent as a
 * single value. Caddy replaces any client-supplied X-Forwarded-For unless `trusted_proxies` is configured, so the
 * value cannot be forged from outside. Without an edge proxy (local development) there is no trustworthy client
 * address, and every visitor shares one throttle bucket.
 */
const API = process.env.API_INTERNAL_URL;
const ALLOWED = /^(slots|holds|holds\/[0-9a-f-]{36}\/(details|confirm|release))$/; // options are rendered on the server, not fetched by the browser

async function proxy(req: NextRequest, ctx: { params: Promise<{ host: string; path: string[] }> }) {
  const { host, path } = await ctx.params;
  const p = path.join('/');
  if (!ALLOWED.test(p)) return NextResponse.json({ code: 'not_found', title: 'Not found', status: 404 }, { status: 404 });
  const hostname = decodeURIComponent(host);
  const headers: Record<string, string> = {};
  const ip = clientIp(req.headers);
  if (ip) headers['x-forwarded-for'] = ip;
  for (const h of ['user-agent', 'accept-language']) {
    const v = req.headers.get(h);
    if (v) headers[h] = v.slice(0, 300);
  }
  let upstream: Response;
  try {
    if (req.method === 'GET') {
      const url = new URL(`${API}/public/booking/${p}`);
      req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));
      url.searchParams.set('host', hostname);
      upstream = await fetch(url, { headers, cache: 'no-store' });
    } else {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      upstream = await fetch(`${API}/public/booking/${p}`, {
        method: 'POST', cache: 'no-store',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, host: hostname }),
      });
    }
  } catch {
    return NextResponse.json({ code: 'upstream_unavailable', title: 'Booking is temporarily unavailable', status: 503 }, { status: 503 });
  }
  // a 204 (hold released) must not carry a body, not even an empty one
  if (upstream.status === 204) return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  return new NextResponse(await upstream.text(), { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
}

export { proxy as GET, proxy as POST };
