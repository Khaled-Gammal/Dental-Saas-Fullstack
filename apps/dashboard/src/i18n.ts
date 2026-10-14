export type Lang = 'ar' | 'en';

const dict = {
  title: { ar: 'لوحة العيادة', en: 'Clinic dashboard' },
  signIn: { ar: 'تسجيل الدخول (تطوير)', en: 'Sign in (dev)' },
  signOut: { ar: 'خروج', en: 'Sign out' },
  branches: { ar: 'الفروع', en: 'Branches' },
  main: { ar: 'رئيسي', en: 'Main' },
  addBranch: { ar: 'إضافة فرع', en: 'Add branch' },
  nameAr: { ar: 'الاسم بالعربية', en: 'Arabic name' },
  slug: { ar: 'المعرّف (بالإنجليزية)', en: 'Slug' },
  save: { ar: 'حفظ', en: 'Save' },
  devNote: {
    ar: 'دخول تجريبي بحسابات البيانات التجريبية. تسجيل الدخول الحقيقي في الأسبوع الثاني.',
    en: 'Dev sign-in with the seeded demo accounts. Real login arrives in week 2.',
  },
} as const;

export const t = (key: keyof typeof dict, lang: Lang) => dict[key][lang];
