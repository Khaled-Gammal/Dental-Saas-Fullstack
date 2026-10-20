import { NextResponse, type NextRequest } from 'next/server';
import { clientIp } from '../../../lib/client-ip';

/**
 * Same-origin endpoint for the landing page's contact form (LND-04): forwards the request to the API's POST
 * /public/leads with the visitor's address (the API throttles per address and per phone). Only reachable on the
 * platform's own hostname: the middleware sends every clinic hostname to app/sites. The client address follows the
 * same rule as the booking proxy (app/sites/[host]/api/booking): the right-most X-Forwarded-For entry, written by our
 * edge proxy.
 */
const API = process.env.API_INTERNAL_URL;
const MAX_BODY = 8 * 1024;

export async function POST(req: NextRequest) {
  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json({ code: 'validation_failed', title: 'Too large', status: 400 }, { status: 400 });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const ip = clientIp(req.headers);
  if (ip) headers['x-forwarded-for'] = ip;
  const ua = req.headers.get('user-agent');
  if (ua) headers['user-agent'] = ua.slice(0, 300);
  let upstream: Response;
  try {
    upstream = await fetch(`${API}/public/leads`, { method: 'POST', cache: 'no-store', headers, body: text || '{}' });
  } catch {
    return NextResponse.json({ code: 'upstream_unavailable', title: 'Temporarily unavailable', status: 503 }, { status: 503 });
  }
  if (upstream.status === 204) return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
  });
}
