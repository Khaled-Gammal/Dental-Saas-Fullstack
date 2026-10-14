/** Text helpers shared by the dashboard and the clinic websites (pure functions, no React). */

const HONORIFIC = /^(د\.?|دكتور|دكتورة|dr\.?)$/i;

/** Two-letter avatar initials, skipping titles: "د. أحمد سامي" -> "أس", "Dr. Sara Ali" -> "SA". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w && !HONORIFIC.test(w));
  return (words.length ? words : [name.trim()]).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase();
}

/** Picks the name in the viewer's language, falling back to the other language, then to `fallback`. */
export function pickName(lang: 'ar' | 'en', ar: string | null | undefined, en: string | null | undefined, fallback = ''): string {
  return (lang === 'ar' ? ar || en : en || ar) || fallback;
}

/** ٠١٢٣٤٥٦٧٨٩ and ۰۱۲۳۴۵۶۷۸۹ -> 0123456789 (Arabic-Indic and Persian digits). */
export function toAsciiDigits(v: string): string {
  return v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * A safe `tel:` href from free-text phone data, or null when it doesn't look like a phone number.
 * Keeps only digits and a leading +, so odd characters in stored data can't produce a broken or surprising link.
 */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = toAsciiDigits(phone).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return /^\+?\d{6,15}$/.test(d) ? `tel:${d}` : null;
}

const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = ([r, g, b]: number[]) => {
  const ch = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
const contrast = (a: number[], b: number[]) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

/**
 * The brand colour, darkened toward `ink` just enough to read as text on white (>= 4.5:1).
 * Lets a clinic pick a light brand colour (yellow, mint) without making prices and links unreadable.
 */
export function readableOnWhite(hex: string, ink = '#14213d'): string {
  const c = hexToRgb(hex), k = hexToRgb(ink), white = [255, 255, 255];
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const mix = c.map((v, i) => Math.round(v + (k[i] - v) * t));
    if (contrast(mix, white) >= 4.5) return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  return ink;
}

/** Text colour that stays readable on a #rrggbb background: white while it reaches 4.5:1, otherwise `dark`. */
export function onColor(hex: string, dark = '#14213d', light = '#ffffff'): string {
  return contrast(hexToRgb(hex), [255, 255, 255]) >= 4.5 ? light : dark;
}
