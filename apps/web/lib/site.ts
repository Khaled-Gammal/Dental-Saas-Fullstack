import { cache } from 'react';
import { telHref } from '@dental/ui/text';
import type { Holiday, HourSlot } from './hours';
import type { SiteImage } from './media';

/** Shape of GET /public/site (apps/api/src/modules/public-site). */
export interface SiteData {
  clinic: { slug: string; name_en: string | null; name_ar: string | null; about_ar: string | null; about_en: string | null;
    primary_phone: string | null; whatsapp: string | null; specialties: string[]; default_locale: 'ar' | 'en'; timezone: string;
    logo?: SiteImage | null };
  theme: { primary?: string };
  showPoweredBy: boolean;
  /** the clinic has bookable services and doctors who accept online booking: the website offers its own wizard */
  onlineBooking: boolean;
  branches: SiteBranch[];
  holidays: Holiday[];
  services: SiteService[];
  doctors: SiteDoctor[];
}
export interface SiteBranch {
  id: string; name_ar: string | null; name_en: string | null; address_ar: string | null; address_en: string | null; city: string | null;
  phone: string | null; whatsapp: string | null; timezone: string | null; latitude: number | null; longitude: number | null; is_main: boolean;
  hours: HourSlot[];
  photo?: SiteImage | null;
}
export interface SiteService {
  id: string; name_ar: string | null; name_en: string | null; description_ar: string | null; description_en: string | null;
  category: string | null; price_minor: number; price_max_minor: number | null; duration_minutes: number;
  image?: SiteImage | null;
}
export interface SiteDoctor {
  id: string; name_ar: string | null; name_en: string | null; title_ar: string | null; title_en: string | null;
  bio_ar: string | null; bio_en: string | null; specialties: string[];
  photo?: SiteImage | null;
}

export const SITE_REVALIDATE_S = 60;

/** One API call per render: cache() lets generateMetadata and the page share it. */
export const getSite = cache(async (host: string): Promise<SiteData | null> => {
  const res = await fetch(`${process.env.API_INTERNAL_URL}/public/site?host=${encodeURIComponent(host)}`, {
    next: { revalidate: SITE_REVALIDATE_S, tags: [`site:${host}`] }, // the worker will call revalidateTag on publish / catalog change
  });
  if (res.status === 404) return null; // unknown host: show the 404 page
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = (await res.json()) as Partial<SiteData> & Pick<SiteData, 'clinic'>;
  // tolerate a payload from an older API (or a cached response from before a field was added)
  return { theme: {}, showPoweredBy: true, onlineBooking: false, branches: [], holidays: [], services: [], doctors: [], ...data };
});

// ---------- formatting (Arabic site) ----------

export const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5]; // the Egyptian week starts on Saturday
export const DEFAULT_TZ = 'Africa/Cairo';
export const DEFAULT_PRIMARY = '#4f46e5'; // indigo: the site's default when a clinic has not picked a brand colour (6.3:1 on white)

/** The Arabic text when present, else the English one (the site is served in Arabic); null when both are empty. */
export const ar = (a: string | null | undefined, e: string | null | undefined): string | null => a?.trim() || e?.trim() || null;

const egpFormat = new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const egp = (minor: number) => egpFormat.format(minor / 100);

/** 0 -> "on consultation", range -> "from – to", otherwise one price. */
export function priceText(min: number, max: number | null): string {
  if (!min && !max) return 'السعر عند الكشف';
  if (max && max > min) return `${egp(min)} – ${egp(max)}`;
  return egp(min);
}

/** The public origin of a clinic site. Local demo hosts are plain http; every real clinic domain is served over https. */
export const originOf = (host: string) => `${/(^|\.)(lvh\.me|localhost)$/.test(host) ? 'http' : 'https'}://${host}`;

/** Only a plain #rrggbb reaches inline CSS; anything else falls back, so a bad theme value can't inject styles. */
export const safeColor = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_PRIMARY);

/** A wa.me link with a prefilled greeting, or null when the number does not look like a phone. */
export function whatsappHref(phone: string | null | undefined, text: string): string | null {
  const tel = telHref(phone);
  if (!tel) return null;
  return `https://wa.me/${tel.slice(4).replace('+', '')}?text=${encodeURIComponent(text)}`;
}

/** Directions to real coordinates only; never guessed from an address. */
export const mapsHref = (lat: number | null, lng: number | null) =>
  lat != null && lng != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null;

const arPlural = new Intl.PluralRules('ar');
type Forms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
/** Arabic noun for a count: 1 طبيب، 2 طبيبان، 3–10 أطباء، 11+ طبيبًا. */
export const arNoun = (n: number, forms: Forms) => forms[arPlural.select(n)] ?? forms.other;

export const NOUNS = {
  doctor: { one: 'طبيب', two: 'طبيبان', few: 'أطباء', many: 'طبيبًا', other: 'طبيب' },
  service: { one: 'خدمة', two: 'خدمتان', few: 'خدمات', many: 'خدمة', other: 'خدمة' },
  branch: { one: 'فرع', two: 'فرعان', few: 'فروع', many: 'فرعًا', other: 'فرع' },
  minute: { one: 'دقيقة', two: 'دقيقتان', few: 'دقائق', many: 'دقيقة', other: 'دقيقة' },
} satisfies Record<string, Forms>;

/** Known specialty codes (seeded clinics use codes; clinics may also type free text, which is shown as is). */
const SPECIALTY_AR: Record<string, string> = {
  general: 'طب أسنان عام', cosmetic: 'تجميل الأسنان', orthodontics: 'تقويم الأسنان', orthodontic: 'تقويم الأسنان', implants: 'زراعة الأسنان',
  implant: 'زراعة الأسنان', pediatric: 'أسنان الأطفال', endodontic: 'علاج الجذور', endodontics: 'علاج الجذور', periodontal: 'أمراض اللثة',
  prosthodontic: 'التركيبات', prosthodontics: 'التركيبات', surgery: 'جراحة الفم', preventive: 'الوقاية', restorative: 'الحشوات والترميم',
};
export const specialtyLabel = (code: string) => SPECIALTY_AR[code.trim().toLowerCase()] ?? code.trim();

/** Service-catalog category -> icon in @dental/ui ICON_PATHS; services added by hand (no category) get the tooth. */
export const CATEGORY_ICON: Record<string, string> = {
  general: 'stethoscope', preventive: 'toothSparkle', restorative: 'toothCheck', endodontic: 'toothRoot', cosmetic: 'sparkles',
  surgery: 'toothSurgery', prosthodontic: 'crown', orthodontic: 'toothBrace', pediatric: 'smile', periodontal: 'toothGum',
};
