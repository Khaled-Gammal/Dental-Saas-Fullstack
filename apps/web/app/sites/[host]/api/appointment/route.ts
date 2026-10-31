import { NextResponse, type NextRequest } from 'next/server';
import { clientIp } from '../../../../../lib/client-ip';

/**
 * Phase 2E: same-origin endpoint for the patient's own booking page. Forwards `{ action, token, … }` to the API's
 * POST /public/appointment/<action> with the clinic's hostname (from the path the middleware rewrote) and the visitor's
 * address for the API's per-IP limits (same rule as the booking proxy). Never cached.
 */
const ACTIONS = new Set(['view', 'slots', 'cancel', 'reschedule']);
const MAX_BODY = 2 * 1024;
const NO_STORE = { 'cache-control': 'no-store' };

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ host: string }> }) {
  const host = decodeURIComponent((await params).host);
  const text = await req.text();
  let body: Record<string, unknown>;
  try {
    body = text.length <= MAX_BODY ? (JSON.parse(text || '{}') as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  const { action, ...rest } = body;
  if (typeof action !== 'string' || !ACTIONS.has(action)) {
    return NextResponse.json({ code: 'validation_failed', title: 'Unknown action', status: 400 }, { status: 400, headers: NO_STORE });
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const ip = clientIp(req.headers);
  if (ip) headers['x-forwarded-for'] = ip;
  let upstream: Response;
  try {
    upstream = await fetch(`${process.env.API_INTERNAL_URL}/public/appointment/${action}`, {
      method: 'POST', cache: 'no-store', headers, body: JSON.stringify({ ...rest, host }),
    });
  } catch {
    return NextResponse.json({ code: 'upstream_unavailable', title: 'Temporarily unavailable', status: 503 }, { status: 503, headers: NO_STORE });
  }
  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', ...NO_STORE },
  });
}
