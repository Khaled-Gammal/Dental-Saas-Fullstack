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
  /** CLR-09: ISO code, default EGP; fixed once an invoice is issued */
  currency: string;
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
  room_id: string | null;
  room: { id: string; name: string } | null;
  payment_mode: string;
  quoted_price_minor: number | null;
  patient_notes: string | null;
  internal_notes: string | null;
  cancel_reason: string | null;
  confirmed_at: string | null;
  checked_in_at: string | null;
  completed_at: string | null;
  /** a website booking whose reception code is still open (checking in without it needs a reason) */
  has_code: boolean;
  /** the clinical visit opened on it, if any (everyone who reads appointments sees that it exists) */
  visit_id: string | null;
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

/** Closed day: one branch, or the whole clinic when `branch_id` is null. */
export interface Holiday { id: string; branch_id: string | null; date: string; name: string }
export interface TimeOff { id: string; starts_at: string; ends_at: string; reason: string | null }
export interface Room { id: string; branch_id: string; name: string; is_active: boolean }
/** A booking a new holiday or time off falls on (listed, never changed automatically). */
export interface CalendarConflict {
  id: string; starts_at: string; status: AppointmentStatus; branch_id: string;
  patient: { id: string; full_name: string; phone: string } | null; doctor: { name_ar: string | null; name_en: string | null };
}
export interface BookingSettings {
  autoConfirm: boolean; otpRequired: boolean; minNoticeMinutes: number; maxDaysAhead: number; slotStepMinutes: number;
  cancelWindowHours: number; reminderOffsetsMinutes: number[];
}

/** One saved version of a patient's medical history (newest first). */
export interface HistoryVersion {
  id: number; allergies: string[]; conditions: string[]; medications: string[]; is_pregnant: boolean | null; is_smoker: boolean | null;
  notes: string | null; saved_at: string; saved_by_name: string | null;
}
export type ClinicalFileKind = 'xray' | 'clinical_photo' | 'document';
/** A clinical file of a patient; `url` is a 5-minute link for the signed-in member. */
export interface PatientFile {
  file_id: string; kind: ClinicalFileKind; mime_type: string; size_bytes: number; caption: string | null; taken_at: string | null;
  created_at: string; uploaded_by_name: string | null; archived_at: string | null; archive_reason: string | null; url: string;
}

// ---------- clinical (Phase D4) ----------
export type NoteField = 'chief_complaint' | 'diagnosis' | 'clinical_notes' | 'next_visit_note';
export type ToothCondition = 'healthy' | 'caries' | 'filled' | 'crown' | 'bridge' | 'missing' | 'implant' | 'root_canal' | 'fractured'
  | 'extraction_needed' | 'veneer' | 'sealant' | 'other';
export type Surface = 'M' | 'O' | 'D' | 'B' | 'L' | 'I' | 'F' | 'P';
export interface ChartEntry {
  id: string; tooth_code: number; surfaces: Surface[]; condition: ToothCondition; notes: string | null; visit_id: string | null;
  recorded_at: string; recorded_by_name: string | null;
}
export interface PatientChart { current: ChartEntry[]; entries: ChartEntry[] }
export interface Procedure {
  id: string; service_id: string; service_ar: string | null; service_en: string | null; tooth_code: number | null; surfaces: Surface[];
  price_minor: number; plan_item_id: string | null; notes: string | null; created_at: string; billed: boolean;
}
export interface PrescriptionLine { id: string; drug_name: string; dose: string | null; frequency: string | null; duration: string | null; instructions: string | null }
export interface Prescription {
  id: string; visit_id: string; patient_id: string; doctor_id: string; notes: string | null; issued_at: string; replaces_id: string | null;
  replaced_by_id: string | null; issued_by_name: string | null; items: PrescriptionLine[];
}
export interface PrescriptionPrint extends Prescription {
  branch_id: string;
  doctor: { name_ar: string | null; name_en: string | null; title_ar: string | null; title_en: string | null };
  patient: { id: string; full_name: string; file_no: number; date_of_birth: string | null; gender: Gender | null } | null;
}
export interface Amendment { id: string; field: NoteField; new_text: string; reason: string; created_at: string; author_name: string | null }
export interface Visit {
  id: string; status: 'draft' | 'final'; appointment_id: string | null; patient_id: string; doctor_id: string; branch_id: string; visit_at: string;
  chief_complaint: string | null; diagnosis: string | null; clinical_notes: string | null; next_visit_note: string | null;
  finalized_at: string | null; finalized_by_name: string | null; created_at: string;
  doctor: { name_ar: string | null; name_en: string | null; title_ar: string | null; title_en: string | null };
  branch: { name_ar: string | null; name_en: string | null };
  patient: { id: string; file_no: number; full_name: string; phone: string; gender: Gender | null; date_of_birth: string | null; medicalHistory: MedicalHistory } | null;
  amendments: Amendment[]; procedures: Procedure[]; prescriptions: Prescription[]; chart: ChartEntry[];
  can: { writeNotes: boolean; amend: boolean; procedures: boolean; prescribe: boolean; chart: boolean };
}
export type VisitSummary = Omit<Visit, 'patient' | 'amendments' | 'procedures' | 'prescriptions' | 'chart' | 'can'> & { procedures: number };

export type PlanStatus = 'draft' | 'proposed' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';
export type PlanItemStatus = 'planned' | 'scheduled' | 'done' | 'cancelled';
export interface PlanItem {
  id: string; plan_id: string; service_id: string; service_ar: string | null; service_en: string | null; duration_minutes: number; tooth_code: number | null;
  surfaces: Surface[]; price_minor: number; discount_minor: number; status: PlanItemStatus; appointment_id: string | null; appointment_at: string | null;
  sort_order: number; done_visit_id: string | null;
}
export interface PlanSummary {
  items_total: number; items_done: number; items_cancelled: number; estimate_minor: number; done_estimate_minor: number; remaining_estimate_minor: number;
}
export interface PlanRow {
  id: string; patient_id: string; doctor_id: string; title: string; status: PlanStatus; total_estimate_minor: number; notes: string | null;
  accepted_at: string | null; accepted_by_name: string | null; created_at: string; updated_at: string;
  doctor: { name_ar: string | null; name_en: string | null }; summary: PlanSummary;
}
export interface PlanDetail extends PlanRow {
  items: PlanItem[];
  next: { item: PlanItem | null; next_visit_note: string | null; noted_at: string | null };
  can: { write: boolean; schedule: boolean };
}

export type RecallReason = 'checkup' | 'cleaning' | 'ortho_adjustment' | 'post_op' | 'implant_followup' | 'other';
export type RecallStatus = 'pending' | 'contacted' | 'booked' | 'done' | 'dismissed';
export interface Recall {
  id: string; patient_id: string; doctor_id: string | null; reason: RecallReason; status: RecallStatus; due_date: string; appointment_id: string | null;
  appointment_at: string | null; source_visit_id: string | null; last_contacted_at: string | null; contact_attempts: number; notes: string | null; created_at: string;
  patient: { id: string; full_name: string; phone: string; file_no: number }; doctor: { name_ar: string | null; name_en: string | null } | null;
}

// ---------- billing (Phase E1) ----------
export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void';
export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'wallet' | 'instapay';
export interface InvoiceRow {
  id: string; number: string | null; status: InvoiceStatus; currency: string; patient_id: string; branch_id: string;
  subtotal_minor: number; discount_minor: number; tax_minor: number; total_minor: number; paid_minor: number; balance_minor: number;
  issue_date: string | null; due_date: string | null; notes: string | null; void_reason: string | null; voided_at: string | null; created_at: string;
  created_by_name: string | null; voided_by_name: string | null;
  patient: { id: string; full_name: string; file_no: number; phone: string }; branch: { name_ar: string | null; name_en: string | null };
}
export interface InvoiceLine {
  id: string; service_id: string | null; visit_procedure_id: string | null; doctor_id: string | null; description: string; tooth_code: number | null;
  quantity: number; unit_price_minor: number; discount_minor: number; line_total_minor: number; sort_order: number;
}
export interface Refund { id: string; amount_minor: number; method: PaymentMethod; reason: string; reference: string | null; refunded_at: string; created_by_name: string | null }
export interface Payment {
  id: string; invoice_id: string | null; patient_id: string; branch_id: string; amount_minor: number; refunded_minor: number; currency: string; method: PaymentMethod;
  reference: string | null; status: 'succeeded' | 'partially_refunded' | 'refunded' | 'reversed' | 'pending' | 'failed'; paid_at: string; notes: string | null;
  received_by: string | null; received_by_name: string | null; reversed_at: string | null; reversal_reason: string | null; reversed_by_name: string | null;
  refunds?: Refund[]; can?: { reverse: boolean; refund: boolean };
}
export interface InvoiceDetail extends InvoiceRow {
  lines: InvoiceLine[]; payments: (Payment & { refunds: Refund[]; can: { reverse: boolean; refund: boolean } })[];
  tax_rate_bp: number; tax_preview_minor: number;
  can: { edit: boolean; issue: boolean; void: boolean; pay: boolean };
}
export interface UnbilledProcedure {
  id: string; visit_id: string; service_id: string; service_ar: string | null; service_en: string | null; tooth_code: number | null; surfaces: Surface[];
  price_minor: number; doctor_id: string; branch_id: string; visit_at: string; doctor_ar: string | null; doctor_en: string | null;
}
export interface PatientBilling { currency: string; balance_minor: number; invoices: InvoiceRow[]; unbilled: UnbilledProcedure[] }
export interface PaymentReceipt extends Payment { invoice: InvoiceRow | null }
