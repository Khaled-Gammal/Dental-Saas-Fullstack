import { NextResponse } from 'next/server';

/**
 * Same-origin images for a clinic website: /media/<file>/<width>.webp on the clinic's hostname is fetched from the
 * API's public media endpoint for that hostname. The API decides whether the file may be shown (published gallery
 * photo, logo, shown doctor or service, open branch) and for which clinic; this route only checks the shape.
 */
const API = process.env.API_INTERNAL_URL;
const FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RENDITION = /^\d{2,4}\.webp$/;

const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=60' } });

export async function GET(_req: Request, ctx: { params: Promise<{ host: string; file: string; rendition: string }> }) {
  const { host, file, rendition } = await ctx.params;
  if (!FILE.test(file) || !RENDITION.test(rendition)) return notFound();
  let upstream: Response;
  try {
    upstream = await fetch(`${API}/public/media/${file}/${rendition}?host=${encodeURIComponent(decodeURIComponent(host))}`, { cache: 'no-store' });
  } catch {
    return new NextResponse('Image unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  if (upstream.status === 404) return notFound();
  if (!upstream.ok || !upstream.body) return new NextResponse('Image unavailable', { status: 502, headers: { 'cache-control': 'no-store' } });
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'image/webp',
      'cache-control': upstream.headers.get('cache-control') ?? 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}
