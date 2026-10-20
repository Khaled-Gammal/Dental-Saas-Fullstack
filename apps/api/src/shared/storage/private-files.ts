/** Pure helpers for private files (clinical documents, expense documents): what a file really is, and short-lived links bound to the member. Unit-tested. */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface Sniffed { mime: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'pdf' | 'jpg' | 'png' | 'webp' }

/** The type from the bytes themselves, whatever the file name or declared type says. Anything else is refused. */
export function sniff(buf: Buffer): Sniffed | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

/**
 * A link to one private file for one signed-in user, valid a few minutes (NFR-03: signed URLs). The signature covers
 * its scope, clinic, file, user and expiry, so a link cannot be widened to another file, clinic or kind of file
 * (a clinical link is never an expense link), passed to someone else's name, or extended.
 */
export class PrivateFileSigner {
  constructor(private readonly secret: string, private readonly baseUrl: string, private readonly scope: string, private readonly path: string) {}

  private mac(tenantId: string, fileId: string, userId: string, exp: number): string {
    return createHmac('sha256', this.secret).update(`${this.scope}:${tenantId}:${fileId}:${userId}:${exp}`).digest('base64url');
  }

  url(tenantId: string, fileId: string, userId: string, ttlSeconds: number, now = Date.now()): string {
    const exp = Math.floor(now / 1000) + ttlSeconds;
    return `${this.baseUrl}/${this.path}/${tenantId}/${fileId}?u=${userId}&exp=${exp}&sig=${this.mac(tenantId, fileId, userId, exp)}`;
  }

  verify(tenantId: string, fileId: string, userId: string, exp: number, sig: string, now = Date.now()): boolean {
    if (!Number.isInteger(exp) || exp < Math.floor(now / 1000)) return false;
    const want = Buffer.from(this.mac(tenantId, fileId, userId, exp));
    const got = Buffer.from(sig);
    return got.length === want.length && timingSafeEqual(got, want);
  }
}
