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
  photo: MediaImage | null;
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
  logo: MediaImage | null;
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

/** One row of a doctor's weekly schedule (times are HH:MM). */
export interface ScheduleRow { branch_id: string; weekday: number; starts_at: string; ends_at: string }

export interface Doctor {
  id: string;
  name_ar: string | null;
  name_en: string | null;
  title_ar: string | null;
  title_en: string | null;
  bio_ar: string | null;
  bio_en: string | null;
  specialties: string[];
  show_on_website: boolean;
  accepts_online_booking: boolean;
  is_active: boolean;
  sort_order: number;
  photo: MediaImage | null;
  branch_ids: string[];
  schedule: ScheduleRow[];
}

/** Prices are in piastres (minor units); 0 means "price on consultation". */
export interface Service {
  id: string;
  catalog_code: string | null;
  name_ar: string | null;
  name_en: string | null;
  description_ar: string | null;
  description_en: string | null;
  price_minor: number;
  price_max_minor: number | null;
  duration_minutes: number;
  bookable_online: boolean;
  show_on_website: boolean;
  is_active: boolean;
  sort_order: number;
  image: MediaImage | null;
}

export interface CatalogEntry { code: string; category: string; name_en: string; name_ar: string; default_duration_minutes: number }

export type AppointmentStatus = 'held' | 'expired' | 'pending' | 'confirmed' | 'checked_in' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
export type AppointmentSource = 'website' | 'dashboard' | 'phone' | 'walk_in' | 'whatsapp';

/** One appointment as GET /appointments returns it: the row plus the names the list needs. */
export interface Appointment {
  id: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  starts_at: string;
  ends_at: string;
  branch_id: string;
  doctor_id: string;
  service_id: string | null;
  payment_mode: string;
  quoted_price_minor: number | null;
  patient_notes: string | null;
  internal_notes: string | null;
  cancel_reason: string | null;
  /** a website booking whose reception code is still open (checking in without it needs a reason) */
  has_code: boolean;
  patient: { id: string; full_name: string; phone: string; file_no: number } | null;
  doctor: { name_ar: string | null; name_en: string | null };
  service: { name_ar: string | null; name_en: string | null; duration_minutes: number } | null;
}

export interface DayAppointments { date: string; timezone: string; appointments: Appointment[] }

export interface CheckInResponse {
  result: { appointment_id: string; amount_due_minor: number; paid_online_minor: number; quoted_price_minor: number | null };
  appointment: Appointment;
}

// ---------- patients ----------
export type Gender = 'male' | 'female';
export type GuardianRelation = 'father' | 'mother' | 'sibling' | 'spouse' | 'legal_guardian' | 'other';

/** One row of GET /patients (search or page). */
export interface PatientRow {
  id: string;
  file_no: number;
  full_name: string;
  phone: string;
  gender: Gender | null;
  date_of_birth: string | null; // YYYY-MM-DD
  tags: string[];
  is_blocked: boolean;
  created_at: string;
}
export interface PatientPage { items: PatientRow[]; nextCursor: string | null }

export interface MedicalHistory {
  allergies: string[];
  conditions: string[];
  medications: string[];
  is_pregnant: boolean | null;
  is_smoker: boolean | null;
  notes: string | null;
  updated_at: string | null;
}

export interface PatientVisit {
  id: string; status: AppointmentStatus; source: AppointmentSource; starts_at: string; ends_at: string; cancel_reason: string | null;
  doctor_ar: string | null; doctor_en: string | null; service_ar: string | null; service_en: string | null; branch_ar: string | null; branch_en: string | null;
}

/** GET /patients/:id. `medicalHistory` is null when the caller may not see clinical data. */
export interface PatientDetail extends PatientRow {
  phone_alt: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  occupation: string | null;
  referral_source: string | null;
  preferred_branch_id: string | null;
  preferred_locale: 'ar' | 'en';
  notes: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_relation: GuardianRelation | null;
  guardian_patient_id: string | null;
  guardian_patient_name: string | null;
  marketing_opt_in: boolean;
  marketing_opt_in_at: string | null;
  needs_review: boolean;
  medicalHistory: MedicalHistory | null;
  appointments: PatientVisit[];
}

export interface AuditEntry { id: number; action: string; changes: Record<string, unknown> | null; created_at: string; actor_name: string | null }

export interface StaffSlots { date: string; timezone: string; durationMinutes: number; slots: string[] }

// ---------- media + gallery ----------
/** An uploaded image as the API returns it: original size, the rendition widths, and short-lived signed links. */
export interface MediaImage { id: string; width: number; height: number; widths: number[]; thumbUrl: string; fullUrl: string }
/** What an upload is for (POST /media?purpose=…): gallery photo, a doctor/service/branch photo, or the clinic logo. */
export type MediaPurpose = 'gallery' | 'photo' | 'logo';

export interface GalleryItem {
  id: string;
  branch_id: string | null;
  caption_ar: string | null;
  caption_en: string | null;
  alt_ar: string | null;
  alt_en: string | null;
  is_published: boolean;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  image: MediaImage;
}
export interface GalleryPage { items: GalleryItem[]; nextCursor: string | null }
/** all | clinic (clinic-wide photos) | a branch id */
export type GalleryScope = string;

/** A role of the clinic (seeded: owner, doctor, receptionist, assistant, accountant). */
export interface StaffRole { id: string; key: string; name_ar: string; name_en: string; is_system: boolean }
export interface StaffRoleRef { id: string; key: string; name_ar: string; name_en: string }
export interface DoctorRef { id: string; name_ar: string | null; name_en: string | null }
export interface StaffMember {
  id: string; status: 'active' | 'disabled'; all_branches: boolean; branch_ids: string[]; job_title: string | null; joined_at: string;
  role: StaffRoleRef; user: { full_name: string; email: string | null; phone: string | null }; doctor: DoctorRef | null;
}
export interface StaffInvitation {
  id: string; email: string; branch_ids: string[]; job_title: string | null; expires_at: string; created_at: string; expired: boolean;
  role: StaffRoleRef; doctor: DoctorRef | null; invited_by: string | null;
}
/** What an invitation link shows before the invitee signs in. */
export interface InvitationPreview {
  clinic: { slug: string; nameAr: string | null; nameEn: string | null }; role: { key: string; nameAr: string };
  email: string; jobTitle: string | null; expiresAt: string; allBranches: boolean; accountExists: boolean;
}
