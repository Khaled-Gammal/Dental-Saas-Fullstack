/** ٠١٢٣٤٥٦٧٨٩ (Arabic-Indic) and ۰۱۲۳۴۵۶۷۸۹ (Persian) -> 0123456789. The one copy in the API. */
export function toAsciiDigits(v: string): string {
  return v.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Normalises a phone number to E.164 (+201012345678).
 * Accepts Egyptian local formats (01012345678), 00-prefixed international, and +-prefixed.
 * Returns null when the result is not a plausible E.164 number.
 */
export function normalizePhone(input: string): string | null {
  let p = toAsciiDigits(input.replace(/[\s\-().]/g, ''));
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  else if (/^01[0125]\d{8}$/.test(p)) p = `+20${p.slice(1)}`;
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}

/** +201012345678 -> +20101****678, for responses and logs */
export function maskPhone(e164: string): string {
  return e164.length > 8 ? `${e164.slice(0, 6)}****${e164.slice(-3)}` : e164;
}
