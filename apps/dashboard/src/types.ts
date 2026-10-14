/** API response shapes used by more than one screen. */

export interface HoursRow { weekday: number; opens_at: string; closes_at: string }

export interface Branch {
  id: string;
  name_ar: string | null;
  name_en: string | null;
  slug: string;
  address_ar: string | null;
  address_en: string | null;
  city: string | null;
  phone: string | null;
  whatsapp: string | null;
  is_main: boolean;
  is_active: boolean;
  hours: HoursRow[];
}

export interface ClinicProfile {
  slug: string;
  status: string;
  nameAr: string | null;
  nameEn: string | null;
  aboutAr: string | null;
  aboutEn: string | null;
  primaryPhone: string | null;
  whatsapp: string | null;
  email: string | null;
  specialties: string[];
  defaultLocale: 'ar' | 'en';
  brandColor: string | null;
}

/** GET /clinic/onboarding: each step is derived from the clinic's data. */
export interface OnboardingStatus {
  profile: boolean;
  branches: boolean;
  hours: boolean;
  doctors: boolean;
  services: boolean;
  published: boolean;
  pendingChanges: boolean;
}

export interface WebsiteStatus { status: 'draft' | 'published' | 'maintenance'; version: number; publishedAt: string | null; pendingChanges: boolean }
