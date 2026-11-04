import type { IconName } from '../components/icons';

/**
 * The landing page's wording, in one place so it can be edited without touching the layout. Every line describes
 * something the system does today; nothing is promised that is not built (no testimonials or figures until real ones
 * exist). The mock-ups on the page are drawings of the product, not data.
 */

export const HERO = {
  eyebrow: 'لعيادات الأسنان',
  /** the title, then the words drawn with the underline */
  title: 'نظام إدارة وموقع إلكتروني لعيادتك،',
  mark: 'في مكان واحد',
  lead: 'المواعيد وملفات المرضى وخطط العلاج والفواتير والمصروفات والتقارير، مع موقع باسم عيادتك يحجز منه المرضى بأنفسهم.',
};

/** The strip under the hero: short facts about the platform. */
export function facts(trialDays: number): { icon: IconName; value: string; label: string }[] {
  const list: { icon: IconName; value: string; label: string }[] = [
    { icon: 'check', value: 'بالعربية بالكامل', label: 'النظام وموقع العيادة' },
    { icon: 'sparkles', value: 'من المتصفح', label: 'على الكمبيوتر أو الموبايل، دون تثبيت' },
    { icon: 'shield', value: 'صلاحيات لكل موظف', label: 'أنت من يحدد ما يراه كل دور' },
  ];
  if (trialDays > 0) list.push({ icon: 'calendar', value: `${trialDays} يومًا مجانًا`, label: 'تجربة مجانية دون بطاقة دفع' });
  return list;
}

/** From sign-up to the first online booking: how the platform works, in the order a clinic lives it. */
export function steps(trialDays: number): { icon: IconName; title: string; text: string }[] {
  return [
    { icon: 'user', title: 'أنشئ حساب عيادتك', text: trialDays > 0 ? `سجّل باسم عيادتك وبريدك الإلكتروني، وتبدأ تجربتك المجانية لمدة ${trialDays} يومًا مباشرة.` : 'سجّل باسم عيادتك وبريدك الإلكتروني، وابدأ العمل مباشرة.' },
    { icon: 'stethoscope', title: 'أضف خدماتك وفريقك', text: 'الخدمات وأسعارها، والأطباء والفروع ومواعيد العمل، وصلاحيات كل موظف.' },
    { icon: 'sparkles', title: 'موقعك جاهز', text: 'يُنشأ لعيادتك موقع بشعارها وألوانها، ويتحدث تلقائيًا كلما عدّلت بياناتك.' },
    { icon: 'calendar', title: 'استقبل الحجوزات', text: 'يحجز المرضى من موقعك بأنفسهم، ويظهر الموعد مباشرة في تقويم العيادة.' },
  ];
}

export type FeatureKey = 'calendar' | 'patient' | 'plans' | 'billing' | 'reports' | 'team';
export interface Feature { key: FeatureKey; icon: IconName; title: string; text: string }
export const FEATURES: Feature[] = [
  { key: 'calendar', icon: 'calendar', title: 'المواعيد', text: 'تقويم لكل طبيب وفرع، وحالة كل موعد من الحجز حتى الانتهاء، مع تسجيل وصول المريض.' },
  { key: 'patient', icon: 'user', title: 'ملف المريض', text: 'البيانات والتاريخ الطبي ومخطط الأسنان والصور والملفات، في ملف واحد لكل مريض.' },
  { key: 'plans', icon: 'toothCheck', title: 'خطط العلاج', text: 'خطط بمراحل وأسعار، وما تم تنفيذه منها وما بقي، مرتبطة بالفواتير.' },
  { key: 'billing', icon: 'tag', title: 'الفواتير والمدفوعات', text: 'فواتير ومدفوعات وتقسيط وخصومات بحدود لكل دور، ورصيد المريض ظاهر للاستقبال.' },
  { key: 'reports', icon: 'pulse', title: 'المصروفات والتقارير', text: 'مصروفات بمستنداتها، وتقارير الإيرادات والأطباء والخدمات قابلة للتصدير.' },
  { key: 'team', icon: 'shield', title: 'الفريق والصلاحيات', text: 'أنت من يحدد الأدوار وما يراه كل موظف، والنظام يمنع ما لم تسمح به.' },
];

export const WEBSITE = {
  title: 'موقع إلكتروني لعيادتك من أول يوم',
  text: 'عند التسجيل يُنشأ لعيادتك موقع يعرض خدماتها وأسعارها وأطباءها وفروعها ومواعيد العمل، ويتحدث تلقائيًا كلما عدّلت بياناتك في النظام.',
  points: ['حجز أونلاين يظهر مباشرة في تقويم العيادة', 'رابط واتساب واتصال مباشر', 'شعار عيادتك وألوانها'],
};

/** The colours a clinic picks from in its dashboard (apps/dashboard profile screen, PRESETS), for the live colour demo. */
export const SITE_COLOURS: { hex: string; name: string }[] = [
  { hex: '#1d6fd8', name: 'أزرق' }, { hex: '#0e9aa7', name: 'فيروزي' }, { hex: '#12b5a0', name: 'نعناعي' },
  { hex: '#0f2f5c', name: 'كحلي' }, { hex: '#6d4ed6', name: 'بنفسجي' }, { hex: '#d6457a', name: 'وردي' },
];

/**
 * How «اشترك الآن» works (owner decision 2026-10-20): sign-up with the plan, a subscription request reaches the
 * platform, payment is agreed outside the site, then the admin activates the plan. No online payment.
 */
export function subscribeSteps(trialDays: number): { title: string; text: string }[] {
  return [
    { title: 'اختر باقتك', text: trialDays > 0 ? `اضغط «اشترك الآن» وأنشئ حساب عيادتك، وتبدأ بالتجربة المجانية ${trialDays} يومًا.` : 'اضغط «اشترك الآن» وأنشئ حساب عيادتك.' },
    { title: 'نتواصل معك', text: 'يصلنا طلب اشتراكك، ونتفق معك على طريقة الدفع.' },
    { title: 'يُفعَّل اشتراكك', text: 'نفعّل باقتك، وتبقى كل بياناتك كما هي.' },
  ];
}

export interface Faq { q: string; a: string }
export function faqs(trialDays: number): Faq[] {
  const list: Faq[] = [];
  if (trialDays > 0) {
    list.push({ q: 'هل توجد فترة تجربة مجانية؟', a: `نعم، تبدأ بتجربة مجانية لمدة ${trialDays} يومًا دون بطاقة دفع.` });
    list.push({ q: 'ماذا يحدث بعد انتهاء التجربة؟', a: 'اختر باقتك وتواصل معنا لتفعيل الاشتراك. إن لم يُفعَّل يتوقف حساب العيادة مؤقتًا، وتبقى بياناتك محفوظة كما هي.' });
  }
  list.push(
    { q: 'هل أحتاج إلى تثبيت برنامج؟', a: 'لا. النظام يعمل من المتصفح على الكمبيوتر أو الموبايل.' },
    { q: 'هل بيانات عيادتي آمنة؟', a: 'بيانات كل عيادة معزولة عن العيادات الأخرى في قاعدة البيانات نفسها، وكل موظف يرى فقط ما تسمح به صلاحياته، وتُسجَّل العمليات الحساسة.' },
    { q: 'هل يمكنني إضافة فروع وأطباء؟', a: 'نعم، في حدود باقتك الموضحة في الأسعار. ولتغيير الباقة تواصل معنا.' },
  );
  return list;
}
