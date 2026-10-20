import { formatMoney, toAsciiDigits } from '@dental/ui/text';
import { arNoun } from './site';

/** The platform's name on the landing page (header, footer, page title). */
export const BRAND = 'منصة عيادات الأسنان';

/** Shape of GET /public/plans (apps/api/src/modules/landing): the plans offered to new clinics, in the panel's order. */
export interface PublicPlan {
  id: string; code: string; name_ar: string; price_monthly_minor: number; price_yearly_minor: number; currency: string; trial_days: number;
  /** plans.limits: a missing or null key means no limit */
  limits: Partial<Record<LimitKey, number | null>>;
}
export type Cycle = 'monthly' | 'yearly';
type LimitKey = 'branches' | 'doctors' | 'staff' | 'patients' | 'storage_mb';

export const PLANS_REVALIDATE_S = 300;

/**
 * LND-02: the pricing table reads the plans from the API, never from code. A failing API must not take the landing page
 * down: the page then shows the pricing section without plans and points to the contact form.
 */
export async function getPlans(): Promise<PublicPlan[]> {
  try {
    const res = await fetch(`${process.env.API_INTERNAL_URL}/public/plans`, { next: { revalidate: PLANS_REVALIDATE_S, tags: ['plans'] } });
    if (!res.ok) return [];
    return (await res.json()) as PublicPlan[];
  } catch {
    return [];
  }
}

const num = (n: number) => n.toLocaleString('ar-EG-u-nu-latn');

/** "500 ج.م" and what it is per: the yearly price also reads as a monthly equivalent. */
export function planPrice(plan: PublicPlan, cycle: Cycle): { amount: string; per: string; note: string | null } {
  if (cycle === 'monthly') return { amount: formatMoney(plan.price_monthly_minor, plan.currency), per: 'شهريًا', note: null };
  const monthly = Math.round(plan.price_yearly_minor / 12);
  return { amount: formatMoney(plan.price_yearly_minor, plan.currency), per: 'سنويًا', note: `يعادل ${formatMoney(monthly, plan.currency)} شهريًا` };
}

/** Whole percent saved by paying yearly instead of twelve months; 0 when there is no saving. */
export function yearlySaving(plan: PublicPlan): number {
  const twelve = plan.price_monthly_minor * 12;
  if (twelve <= 0 || plan.price_yearly_minor >= twelve) return 0;
  return Math.floor((1 - plan.price_yearly_minor / twelve) * 100);
}

/** The best yearly saving across the plans, for the toggle's label; 0 hides it. */
export const bestSaving = (plans: PublicPlan[]) => plans.reduce((m, p) => Math.max(m, yearlySaving(p)), 0);

const FORMS = {
  branch: { one: 'فرع', two: 'فرعان', few: 'فروع', many: 'فرعًا', other: 'فرع' },
  doctor: { one: 'طبيب', two: 'طبيبان', few: 'أطباء', many: 'طبيبًا', other: 'طبيب' },
  user: { one: 'مستخدم', two: 'مستخدمان', few: 'مستخدمين', many: 'مستخدمًا', other: 'مستخدم' },
  file: { one: 'ملف', two: 'ملفان', few: 'ملفات', many: 'ملفًا', other: 'ملف' },
};

function counted(n: number | null | undefined, forms: (typeof FORMS)[keyof typeof FORMS], one: string, unlimited: string, suffix = ''): string {
  if (n == null) return unlimited;
  if (n === 1) return one;
  if (n === 2) return `${forms.two}${suffix}`;
  return `حتى ${num(n)} ${arNoun(n, forms)}${suffix}`;
}

/** The plan's limits as lines for the pricing card, in a fixed order. Only limits the system enforces are listed. */
export function limitLines(limits: PublicPlan['limits']): string[] {
  const storage = limits.storage_mb;
  return [
    counted(limits.branches, FORMS.branch, 'فرع واحد', 'فروع بلا حد'),
    counted(limits.doctors, FORMS.doctor, 'طبيب واحد', 'أطباء بلا حد'),
    counted(limits.staff, FORMS.user, 'مستخدم واحد', 'مستخدمون بلا حد'),
    counted(limits.patients, FORMS.file, 'ملف مريض واحد', 'ملفات مرضى بلا حد', ' مريض'),
    storage == null ? 'مساحة صور بلا حد'
      : storage >= 1024 ? `${num(Math.round((storage / 1024) * 10) / 10)} جيجابايت للصور والملفات`
        : `${num(storage)} ميجابايت للصور والملفات`,
  ];
}

/** The longest free trial among the plans (a new clinic starts on one), or 0. */
export const trialDays = (plans: PublicPlan[]) => plans.reduce((m, p) => Math.max(m, p.trial_days), 0);

// ---------- the contact form (LND-04) ----------

export interface LeadForm { fullName: string; phone: string; email: string; clinicName: string; city: string; message: string; planCode: string; website: string }
export const EMPTY_LEAD: LeadForm = { fullName: '', phone: '', email: '', clinicName: '', city: '', message: '', planCode: '', website: '' };

/** The API's own check (apps/api/src/shared/phone.ts), so the visitor hears about a typo before sending. */
export function looksLikePhone(input: string): boolean {
  let p = toAsciiDigits(input.replace(/[\s\-().]/g, ''));
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  else if (/^01[0125]\d{8}$/.test(p)) p = `+20${p.slice(1)}`;
  return /^\+[1-9]\d{7,14}$/.test(p);
}

/** What is wrong with the form, field by field (empty when it can be sent). */
export function leadProblems(f: LeadForm): Partial<Record<keyof LeadForm, string>> {
  const out: Partial<Record<keyof LeadForm, string>> = {};
  if (f.fullName.trim().length < 2) out.fullName = 'اكتب اسمك';
  if (!looksLikePhone(f.phone)) out.phone = 'اكتب رقم موبايل صحيحًا، مثل 01012345678';
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) out.email = 'البريد الإلكتروني غير صحيح';
  return out;
}

/** The request body: empty optional fields are left out, the plan only when one was picked. */
export function leadBody(f: LeadForm): Record<string, string> {
  const body: Record<string, string> = { fullName: f.fullName.trim(), phone: f.phone.trim(), source: 'landing' };
  for (const k of ['email', 'clinicName', 'city', 'message', 'planCode', 'website'] as const) if (f[k].trim()) body[k] = f[k].trim();
  return body;
}

export const LEAD_ERRORS: Record<string, string> = {
  validation_failed: 'تحقق من الاسم ورقم الموبايل ثم أرسل مرة أخرى.',
  rate_limited: 'وصلتنا طلبات كثيرة من هذا الجهاز. حاول بعد قليل.',
  upstream_unavailable: 'تعذّر الإرسال الآن. حاول مرة أخرى بعد قليل.',
};
export const leadError = (code: string | undefined) => LEAD_ERRORS[code ?? ''] ?? 'تعذّر الإرسال الآن. حاول مرة أخرى بعد قليل.';
