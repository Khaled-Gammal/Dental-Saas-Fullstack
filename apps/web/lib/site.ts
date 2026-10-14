import { cache } from 'react';

/** Shape of GET /public/site (apps/api/src/modules/public-site). */
export interface SiteData {
  clinic: { slug: string; name_en: string | null; name_ar: string | null; about_ar: string | null; about_en: string | null; primary_phone: string | null };
  theme: { primary?: string };
  showPoweredBy: boolean;
  branches: SiteBranch[];
  services: SiteService[];
  doctors: { id: string; name_ar: string | null; name_en: string | null; title_ar: string | null }[];
}
export interface SiteBranch {
  id: string; name_ar: string | null; name_en: string | null; address_ar: string | null; phone: string | null;
  hours: { weekday: number; opens_at: string; closes_at: string }[];
}
export interface SiteService { id: string; name_ar: string | null; name_en: string | null; price_minor: number; price_max_minor: number | null; duration_minutes: number }

export const SITE_REVALIDATE_S = 60;

/** One API call per render: cache() lets generateMetadata and the page share it. */
export const getSite = cache(async (host: string): Promise<SiteData | null> => {
  const res = await fetch(`${process.env.API_INTERNAL_URL}/public/site?host=${encodeURIComponent(host)}`, {
    next: { revalidate: SITE_REVALIDATE_S, tags: [`site:${host}`] }, // the worker will call revalidateTag on publish / catalog change
  });
  if (res.status === 404) return null; // unknown host: show the 404 page
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
});

// ---------- formatting (Arabic site) ----------

export const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5]; // the Egyptian week starts on Saturday
export const CLINIC_TZ = 'Africa/Cairo';
export const DEFAULT_PRIMARY = '#1d6fd8'; // = --primary-500 in packages/ui/tokens.css

const egpFormat = new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const egp = (minor: number) => egpFormat.format(minor / 100);

/** 0 -> "on consultation", range -> "from – to", otherwise one price. */
export function priceText(min: number, max: number | null): string {
  if (!min && !max) return 'السعر عند الكشف';
  if (max && max > min) return `${egp(min)} – ${egp(max)}`;
  return egp(min);
}

export const hhmm = (t: string) => t.slice(0, 5);

/** Today's weekday (0 = Sunday) in the clinic's timezone, not the server's. */
export const clinicWeekday = () => new Date(new Date().toLocaleString('en-US', { timeZone: CLINIC_TZ })).getDay();

/** Only a plain #rrggbb reaches inline CSS; anything else falls back, so a bad theme value can't inject styles. */
export const safeColor = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_PRIMARY);

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
