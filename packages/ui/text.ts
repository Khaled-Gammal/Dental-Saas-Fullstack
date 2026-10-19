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

/** Known specialty codes (seeded clinics use codes; clinics may also type free text, which is shown as is). */
const SPECIALTY_AR: Record<string, string> = {
  general: 'طب أسنان عام', cosmetic: 'تجميل الأسنان', orthodontics: 'تقويم الأسنان', orthodontic: 'تقويم الأسنان', implants: 'زراعة الأسنان',
  implant: 'زراعة الأسنان', pediatric: 'أسنان الأطفال', endodontic: 'علاج الجذور', endodontics: 'علاج الجذور', periodontal: 'أمراض اللثة',
  prosthodontic: 'التركيبات', prosthodontics: 'التركيبات', surgery: 'جراحة الفم', preventive: 'الوقاية', restorative: 'الحشوات والترميم',
};
/** A doctor's specialty in Arabic: the label of a known code, otherwise the clinic's own text. */
export const specialtyLabel = (code: string) => SPECIALTY_AR[code.trim().toLowerCase()] ?? code.trim();

/** "5:00 م" from "17:00" or "17:00:00": 12-hour clock with ص/م and Latin digits (CLR-08). */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`;
}

/** Minor units in the clinic currency with Latin digits: "1,250 ج.م", "99.50 SAR" (L10N-005, CLR-08). */
export function formatMoney(minor: number, currency = 'EGP'): string {
  const major = minor / 100;
  const n = major.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: Number.isInteger(major) ? 0 : 2, maximumFractionDigits: 2 });
  return `${n} ${currency === 'EGP' ? 'ج.م' : currency}`;
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
