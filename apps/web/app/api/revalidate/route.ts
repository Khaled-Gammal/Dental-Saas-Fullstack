import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

/**
 * Called by the API after a clinic publishes (or changes its catalogue): drops the cached pages for
 * that clinic's hostnames so visitors see the change at once instead of within 60 seconds.
 * Protected by a shared secret; only tags of the form site:<hostname> are accepted.
 */
const TAG = /^site:[a-z0-9.-]{1,253}$/;
const secret = process.env.REVALIDATE_SECRET ?? 'dev-only-revalidate-secret';

function authorised(req: NextRequest): boolean {
  const given = req.headers.get('x-revalidate-secret') ?? '';
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { tags?: unknown };
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string' && TAG.test(t)).slice(0, 50) : [];
  for (const tag of tags) revalidateTag(tag);
  return NextResponse.json({ revalidated: tags });
}
