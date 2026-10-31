import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

/**
 * Called by the API after a clinic publishes (or changes its catalogue): drops the cached pages for
 * that clinic's hostnames so visitors see the change at once instead of within 60 seconds.
 * Protected by a shared secret; only tags of the form site:<hostname> are accepted.
 */
const TAG = /^site:[a-z0-9.-]{1,253}$/;
const DEV_SECRET = 'dev-only-revalidate-secret';

/**
 * Read at request time, never inlined at build (review R11: it used to sit in next.config `env`, i.e. in the bundles).
 * In production a missing or development secret switches the endpoint off rather than accepting a guessable one.
 */
function secret(): string | null {
  const s = process.env.REVALIDATE_SECRET;
  if (process.env.NODE_ENV === 'production') return s && !s.startsWith('dev-only') ? s : null;
  return s || DEV_SECRET;
}

function authorised(req: NextRequest, expected: string): boolean {
  const given = req.headers.get('x-revalidate-secret') ?? '';
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const expected = secret();
  if (!expected) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  if (!authorised(req, expected)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { tags?: unknown };
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string' && TAG.test(t)).slice(0, 50) : [];
  for (const tag of tags) revalidateTag(tag);
  return NextResponse.json({ revalidated: tags });
}
