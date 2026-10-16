import { createHmac, timingSafeEqual } from 'node:crypto';

/** Storage key of one rendition: t/<tenant>/<file>/<width>.webp. Built here only. */
export const renditionKey = (tenantId: string, fileId: string, width: number) => `t/${tenantId}/${fileId}/${width}.webp`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (s: string) => UUID.test(s);

/**
 * Short-lived links to private media (SRS NFR-03: files only through signed URLs). The signature covers the clinic,
 * the file, the rendition and the expiry, so a link cannot be widened to another file, size or clinic, or extended.
 */
export class MediaSigner {
  constructor(private readonly secret: string, private readonly baseUrl: string) {}

  private mac(tenantId: string, fileId: string, width: number, exp: number): string {
    return createHmac('sha256', this.secret).update(`${tenantId}:${fileId}:${width}:${exp}`).digest('base64url');
  }

  url(tenantId: string, fileId: string, width: number, ttlSeconds: number, now = Date.now()): string {
    const exp = Math.floor(now / 1000) + ttlSeconds;
    return `${this.baseUrl}/media/${tenantId}/${fileId}/${width}.webp?exp=${exp}&sig=${this.mac(tenantId, fileId, width, exp)}`;
  }

  verify(tenantId: string, fileId: string, width: number, exp: number, sig: string, now = Date.now()): boolean {
    if (!Number.isInteger(exp) || exp < Math.floor(now / 1000)) return false;
    const want = Buffer.from(this.mac(tenantId, fileId, width, exp));
    const got = Buffer.from(sig);
    return got.length === want.length && timingSafeEqual(got, want);
  }
}
export const MEDIA_SIGNER = Symbol('MEDIA_SIGNER');
