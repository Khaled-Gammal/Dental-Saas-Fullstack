import type { Tx } from '@dental/db';
import type { AppointmentStatus } from '../domain/appointment-status';
import type { BookingPolicy } from '../domain/booking-policy';

/** The repository's unit of work. Use cases pass it through; they never query with it (SRS 8.3 Repository + Unit of Work). */
export type Session = Tx;

/**
 * Opens one transaction for a clinic and runs a use case inside it. The HTTP layer builds one from the website
 * hostname (public booking) or from the signed-in session (dashboard); the use cases do not know which.
 */
export interface TenantScope {
  run<T>(fn: (tx: Session, tenantId: string) => Promise<T>): Promise<T>;
  /** The clinic id without doing any work (cross-checks before a transaction that is opened elsewhere). */
  resolve(): Promise<string>;
}

// ---------- read models ----------

export interface BookingBranch { id: string; name_ar: string | null; name_en: string | null; address_ar: string | null; address_en: string | null; city: string | null; timezone: string | null }
export interface BookingService { id: string; name_ar: string | null; name_en: string | null; price_minor: number; price_max_minor: number | null; duration_minutes: number; bookable_online: boolean }
export interface BookingDoctor { id: string; name_ar: string | null; name_en: string | null; title_ar: string | null; title_en: string | null; branch_ids: string[]; service_ids: string[] }
export interface BookingOptions { branches: BookingBranch[]; services: BookingService[]; doctors: BookingDoctor[] }

/** Raw day facts for the slot engine (times as PostgreSQL returns them; the use case converts to instants). */
export interface DayContext {
  /** a holiday for this branch (or for the whole clinic) */
  closed: boolean;
  branchHours: { opens_at: string; closes_at: string }[];
  shifts: { doctor_id: string; starts_at: string; ends_at: string }[];
  /** appointments, live website holds and time off */
  blocked: { doctor_id: string; starts_at: Date; ends_at: Date }[];
}

export interface DayQuery { branchId: string; doctorIds: string[]; weekday: number; date: string; from: Date; to: Date }
export interface DoctorsQuery { branchId: string; serviceId: string | null; doctorId?: string; online: boolean }

export interface HoldInput {
  tenantId: string; branchId: string; doctorId: string; serviceId: string; startsAt: Date; endsAt: Date;
  holdExpiresAt: Date; quotedPriceMinor: number | null; paymentMode: string;
}
export interface HoldRow {
  id: string; branch_id: string; doctor_id: string; service_id: string | null; starts_at: Date; ends_at: Date; hold_expires_at: Date;
}

export interface FinalizeInput {
  patientId: string; status: 'pending' | 'confirmed'; patientNotes: string | null; codeHash: string; codeExpiresAt: Date;
}

export interface StaffAppointmentInput {
  tenantId: string; branchId: string; doctorId: string; serviceId: string | null; patientId: string; startsAt: Date; endsAt: Date;
  source: 'dashboard' | 'phone' | 'walk_in' | 'whatsapp'; bookedBy: string; status: 'confirmed'; quotedPriceMinor: number | null;
  internalNotes: string | null; overrideReason: string | null;
}

/** One appointment as the dashboard shows it: the row plus the names it needs (one query, no N+1). */
export interface AppointmentView {
  id: string; status: AppointmentStatus; source: string; starts_at: Date; ends_at: Date; branch_id: string; doctor_id: string;
  service_id: string | null; room_id: string | null; payment_mode: string; quoted_price_minor: number | null;
  patient_notes: string | null; internal_notes: string | null; cancel_reason: string | null;
  confirmed_at: Date | null; checked_in_at: Date | null; completed_at: Date | null; cancelled_at: Date | null; created_at: Date;
  patient: { id: string; full_name: string; phone: string; file_no: number } | null;
  doctor: { name_ar: string | null; name_en: string | null };
  service: { name_ar: string | null; name_en: string | null; duration_minutes: number } | null;
  /** a website booking whose reception code is still open */
  has_code: boolean;
}

export interface TransitionRow { id: string; status: AppointmentStatus; doctor_id: string; doctor_member_id: string | null; has_code: boolean }

export interface StatusPatch {
  status: AppointmentStatus; confirmedAt?: Date; completedAt?: Date; cancelledAt?: Date; cancelReason?: string | null; cancelledBy?: 'clinic';
}

export interface CheckInResult {
  appointment_id: string; patient_id: string | null; doctor_id: string; service_id: string | null; starts_at: Date;
  payment_mode: string; quoted_price_minor: number | null; paid_online_minor: number; amount_due_minor: number;
}

// ---------- ports ----------

export interface SchedulingRepository {
  /** Sets the clinic on a transaction opened elsewhere (the OTP consume transaction). */
  enterTenant(tx: Session, tenantId: string): Promise<void>;
  policy(tx: Session): Promise<BookingPolicy>;
  options(tx: Session): Promise<BookingOptions>;
  service(tx: Session, id: string): Promise<BookingService | undefined>;
  branchTimezone(tx: Session, branchId: string): Promise<string | null | undefined>;
  /** Doctors who work at the branch, perform the service and (for the website) accept online booking. */
  doctorsFor(tx: Session, q: DoctorsQuery): Promise<string[]>;
  /** Whether the signed-in member may work in this branch (branch-scoped access; true for all-branch members). */
  branchAllowed(tx: Session, branchId: string): Promise<boolean>;
  /** Whether a staff booking may name this doctor at this branch: the doctor exists, is active and works there. */
  doctorAtBranch(tx: Session, doctorId: string, branchId: string): Promise<'ok' | 'not_found' | 'inactive' | 'not_at_branch'>;
  dayContext(tx: Session, q: DayQuery): Promise<DayContext>;
  releaseExpiredHolds(tx: Session, doctorId: string): Promise<void>;
  insertHold(tx: Session, h: HoldInput): Promise<{ id: string }>;
  /** The hold, locked, while it is still live; undefined when it expired, was released or never existed here. */
  lockLiveHold(tx: Session, id: string): Promise<HoldRow | undefined>;
  finalizeHold(tx: Session, id: string, f: FinalizeInput): Promise<void>;
  addOutboxEvent(tx: Session, tenantId: string, type: string, payload: Record<string, unknown>): Promise<void>;
  listBetween(tx: Session, q: { from: Date; to: Date; branchId?: string }): Promise<AppointmentView[]>;
  get(tx: Session, id: string): Promise<AppointmentView | undefined>;
  lockForTransition(tx: Session, id: string): Promise<TransitionRow | undefined>;
  setStatus(tx: Session, id: string, patch: StatusPatch): Promise<void>;
  /** Reception marks the patient arrived without a code (staff bookings, or a code the patient lost; a note says why). */
  arriveManually(tx: Session, id: string, a: { memberId: string; note: string }): Promise<void>;
  /** Whether an unused code with this hash is already open in the clinic (codes are random; collisions are rare but possible). */
  codeInUse(tx: Session, codeHash: string): Promise<boolean>;
  /** Ends a live hold now (the visitor went back or left); false when it was not a live hold. */
  releaseHold(tx: Session, id: string): Promise<boolean>;
  insertStaffAppointment(tx: Session, a: StaffAppointmentInput): Promise<{ id: string }>;
  /** Consumes a booking code atomically (check_in_by_code); undefined when no open code matches at this branch today. */
  checkInByCode(tx: Session, codeHash: string, branchId: string, memberId: string, method: 'code' | 'qr'): Promise<CheckInResult | undefined>;
}

/** What the visitor typed while the slot is held; lives only as long as the hold, outside the database. */
export interface HoldDetails { tenantId: string; fullName: string; phone: string; email: string; notes: string | null }
export interface HoldDetailsStore {
  put(holdId: string, d: HoldDetails, ttlSeconds: number): Promise<void>;
  get(holdId: string): Promise<HoldDetails | null>;
  delete(holdId: string): Promise<void>;
}

export interface Clock { now(): Date }

/** The one-time booking code a patient shows at reception; only its keyed hash is stored. */
export interface BookingCodes {
  issue(tenantId: string): { code: string; hash: string };
  hash(tenantId: string, code: string): string;
}

export const SCHEDULING_REPOSITORY = Symbol('SCHEDULING_REPOSITORY');
export const HOLD_DETAILS = Symbol('HOLD_DETAILS');
export const CLOCK = Symbol('CLOCK');
export const BOOKING_CODES = Symbol('BOOKING_CODES');
