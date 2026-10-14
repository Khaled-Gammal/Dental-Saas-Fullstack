import { z } from 'zod';
import { normalizePhone, toAsciiDigits } from '../phone';

/** Reusable zod rules, so one rule never has two spellings across controllers. */

/** Clinic subdomain: 3-63 chars, lowercase letters/digits/dashes, no dash at either end (matches is_reserved_slug / slug_available). */
export const TenantSlug = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$/, '3-63 lowercase letters, digits or dashes');

/** Branch slug inside a clinic: 1-60 chars, same alphabet. */
export const BranchSlug = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/, 'lowercase letters, digits and dashes (not at the start or end)');

/** A phone as typed (validated and normalised later by the use case, which reports `invalid_phone`). */
export const PhoneText = z.string().trim().min(8).max(20);

/** A phone normalised to E.164 at the edge; accepts 010…, +20…, 0020… and Arabic digits. */
export const E164Phone = z.string().trim().max(20).transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Phone number is not valid' });
  return p ?? v;
});

/** A 6-digit one-time code; ٠١٢٣٤٥ typed on an Arabic keyboard works too. */
export const OtpCode = z.string().trim().transform(toAsciiDigits).pipe(z.string().regex(/^\d{6}$/, '6 digits'));

export const DisplayName = z.string().trim().min(2).max(120);
