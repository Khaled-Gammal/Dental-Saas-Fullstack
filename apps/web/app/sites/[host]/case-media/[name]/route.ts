/**
 * Phase 2C-2: a before/after case's image on the clinic's site, `/case-media/<file id>-<width>.webp`. Patient images,
 * published with their consent: fetched from the API on every request and never cached (here, in the browser or at
 * the edge), so withdrawing the consent or removing the case takes them off the site at once.
 */
const NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d{2,4})\.webp$/i;
const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ host: string; name: string }> }) {
  const { host, name } = await params;
  const m = NAME.exec(name);
  if (!m) return new Response('Not found', { status: 404, headers: NO_STORE });
  const res = await fetch(`${process.env.API_INTERNAL_URL}/public/case-media/${m[1]}/${m[2]}.webp?host=${encodeURIComponent(decodeURIComponent(host))}`, { cache: 'no-store' });
  if (!res.ok || !res.body) return new Response('Not found', { status: 404, headers: NO_STORE });
  return new Response(res.body, { status: 200, headers: { ...NO_STORE, 'Content-Type': 'image/webp' } });
}
