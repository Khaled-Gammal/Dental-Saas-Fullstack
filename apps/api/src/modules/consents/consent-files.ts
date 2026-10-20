import { PrivateFileSigner } from '../../shared/storage/private-files';

/** Storage key of a consent's signature or scanned form (server-generated only). */
export const consentKey = (tenantId: string, fileId: string) => `t/${tenantId}/consents/${fileId}`;

/** A 5-minute link to one consent's signature or scan, for one signed-in user; its opening is audited. */
export class ConsentFileSigner extends PrivateFileSigner {
  constructor(secret: string, baseUrl: string) {
    super(secret, baseUrl, 'consent', 'consent-files');
  }
}
export const CONSENT_FILE_SIGNER = Symbol('CONSENT_FILE_SIGNER');

/** A signature drawn on screen: `data:image/png;base64,…` → the PNG bytes, or null when it is not one. */
export function signaturePng(dataUrl: string): Buffer | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? buf : null;
}

/** A new consent text's key: short, lowercase, unique enough within a clinic (the starter drafts have readable keys). */
export const newConsentKey = () => `c-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
