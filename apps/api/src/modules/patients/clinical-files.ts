/** Pure helpers for clinical documents: what a file really is, and short-lived links bound to the member. Unit-tested. */
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

/** Storage key of a clinical file (server-generated only). */
export const clinicalKey = (tenantId: string, fileId: string) => `t/${tenantId}/clinical/${fileId}`;

/**
 * A link to one clinical file for one signed-in user, valid a few minutes (NFR-03: signed URLs). The signature covers
 * clinic, file, user and expiry, so a link cannot be widened to another file or clinic, passed to someone else's name,
 * or extended. The download is audited as that user's view.
 */
export class ClinicalFileSigner {
  constructor(private readonly secret: string, private readonly baseUrl: string) {}

  private mac(tenantId: string, fileId: string, userId: string, exp: number): string {
    return createHmac('sha256', this.secret).update(`clinical:${tenantId}:${fileId}:${userId}:${exp}`).digest('base64url');
  }

  url(tenantId: string, fileId: string, userId: string, ttlSeconds: number, now = Date.now()): string {
    const exp = Math.floor(now / 1000) + ttlSeconds;
    return `${this.baseUrl}/clinical-files/${tenantId}/${fileId}?u=${userId}&exp=${exp}&sig=${this.mac(tenantId, fileId, userId, exp)}`;
  }

  verify(tenantId: string, fileId: string, userId: string, exp: number, sig: string, now = Date.now()): boolean {
    if (!Number.isInteger(exp) || exp < Math.floor(now / 1000)) return false;
    const want = Buffer.from(this.mac(tenantId, fileId, userId, exp));
    const got = Buffer.from(sig);
    return got.length === want.length && timingSafeEqual(got, want);
  }
}
export const CLINICAL_FILE_SIGNER = Symbol('CLINICAL_FILE_SIGNER');
