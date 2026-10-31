/**
 * Phase 2C-3: `/share-image.jpg` — the image WhatsApp, Facebook and the rest show for the clinic's link (1200×630 JPEG,
 * made by the API from the clinic's share image, or its logo and brand colour). The pages link it with `?v=` (changes
 * with the image), and the site's cache tag refreshes it when the clinic changes it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ host: string }> }) {
  const host = decodeURIComponent((await params).host);
  // one cache entry per clinic (the visitor's `?v=` is not passed on: it only refreshes browsers and social caches)
  const res = await fetch(`${process.env.API_INTERNAL_URL}/public/share-image?host=${encodeURIComponent(host)}`, {
    next: { revalidate: 3600, tags: [`site:${host}`] },
  });
  if (!res.ok) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(await res.arrayBuffer(), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600, s-maxage=86400', 'X-Content-Type-Options': 'nosniff' },
  });
}
