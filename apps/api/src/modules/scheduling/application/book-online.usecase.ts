import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config';
import { OtpService } from '../../identity/otp.service';
import type { RequestMeta } from '../../identity/identity.types';
import { PatientDirectory } from '../../patients';
import { Err } from '../../../shared/errors/app-error';
import { manageToken, manageTokenHash } from '../../../shared/manage-link';
import { maskEmail } from '../../../shared/mask';
import { emailWhen } from '../../../shared/notifications/arabic-mail';
import { EMAIL_SENDER, type EmailSender } from '../../../shared/notifications/ports';
import { dateInZone, endOfDay, safeTimeZone } from '../../../shared/time/clinic-time';
import {
  BOOKING_CODES, CLOCK, HOLD_DETAILS, SCHEDULING_REPOSITORY,
  type AppointmentView, type BookingCodes, type Clock, type HoldDetails, type HoldDetailsStore, type SchedulingRepository, type Session, type TenantScope,
} from './ports';

export interface DetailsInput { fullName: string; phone: string; email: string; notes?: string | null }

/** What the visitor gets once the booking exists: enough for the confirmation screen, plus the code shown once. */
export interface BookingSummary {
  appointmentId: string;
  status: 'pending' | 'confirmed';
  startsAt: Date;
  endsAt: Date;
  /** the zone the appointment's wall-clock time is in (the branch's, else the clinic's) */
  timezone: string;
  /** the one-time reception code; also emailed, never stored in clear */
  code: string;
  /**
   * Only what the confirmation screen shows (review R11): the full AppointmentView carried the patient's record
   * (name, phone, file no.) and the clinic's internal notes to an anonymous caller.
   */
  appointment: PublicAppointment;
}

export interface PublicAppointment {
  doctor: { name_ar: string | null; name_en: string | null };
  service: { name_ar: string | null; name_en: string | null } | null;
  branch_id: string;
}

const publicView = (a: AppointmentView): PublicAppointment => ({
  doctor: { name_ar: a.doctor.name_ar, name_en: a.doctor.name_en },
  service: a.service ? { name_ar: a.service.name_ar, name_en: a.service.name_en } : null,
  branch_id: a.branch_id,
});

export type DetailsOutcome = { status: 'otp_required'; maskedEmail: string } | { status: 'booked'; booking: BookingSummary };

/**
 * Steps 2–4 of online booking (SRS 4.11): details → email code → patient matched or created → `pending`/`confirmed`,
 * reception code issued, `appointment.created` written to the outbox in the same transaction. Email is the only
 * channel: the visitor's address is verified by the code, and the reception code goes to it after commit.
 */
@Injectable()
export class BookOnline {
  private readonly logger = new Logger('BookOnline');

  constructor(
    @Inject(SCHEDULING_REPOSITORY) private readonly repo: SchedulingRepository,
    @Inject(HOLD_DETAILS) private readonly details: HoldDetailsStore,
    @Inject(BOOKING_CODES) private readonly codes: BookingCodes,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly otp: OtpService,
    private readonly patients: PatientDirectory,
  ) {}

  /** Keeps the visitor's details for the life of the hold, then either books (no verification) or emails a code. */
  async submitDetails(scope: TenantScope, holdId: string, input: DetailsInput, meta: RequestMeta): Promise<DetailsOutcome> {
    const email = input.email.trim().toLowerCase();
    const outcome = await scope.run(async (tx, tenantId): Promise<DetailsOutcome> => {
      const hold = await this.repo.lockLiveHold(tx, holdId);
      if (!hold) throw Err.conflict('hold_expired', 'The reserved time ran out; pick a slot again');
      const policy = await this.repo.policy(tx);
      const details: HoldDetails = { tenantId, fullName: input.fullName, phone: input.phone, email, notes: input.notes ?? null };
      const ttl = Math.max(30, Math.ceil((hold.hold_expires_at.getTime() - this.clock.now().getTime()) / 1000));
      await this.details.put(holdId, details, ttl);
      if (policy.otpRequired) return { status: 'otp_required', maskedEmail: maskEmail(email) };
      return { status: 'booked', booking: await this.finalize(tx, tenantId, holdId, details) };
    });
    if (outcome.status === 'otp_required') await this.otp.sendByEmail(email, 'booking', meta, 'رمز تأكيد الحجز | Booking verification code'); // 429 otp_rate_limited when abused
    else await this.emailCode(outcome.booking, email);
    return outcome;
  }

  /** Verifies the code and books in the same transaction that consumes it: a failed booking leaves the code usable. */
  async confirm(scope: TenantScope, holdId: string, code: string, meta: RequestMeta): Promise<BookingSummary> {
    const details = await this.details.get(holdId);
    const tenantId = await scope.resolve();
    if (!details || details.tenantId !== tenantId) throw Err.conflict('hold_expired', 'The reserved time ran out; pick a slot again');
    const booking = await this.otp.verify(details.email, 'booking', code, meta, async (tx) => {
      await this.repo.enterTenant(tx, tenantId);
      return this.finalize(tx, tenantId, holdId, details);
    });
    // the booking is committed: the email and the cleanup are best-effort and must not turn it into an error
    await this.emailCode(booking, details.email);
    await this.forget(holdId);
    return booking;
  }

  private async finalize(tx: Session, tenantId: string, holdId: string, d: HoldDetails): Promise<BookingSummary> {
    const hold = await this.repo.lockLiveHold(tx, holdId);
    if (!hold) throw Err.conflict('hold_expired', 'The reserved time ran out; pick a slot again');
    const policy = await this.repo.policy(tx);
    // BOOK-11, owned by the patients module: phone + name links an existing patient, otherwise a new one for review
    const patient = await this.patients.matchOrCreateForBooking(tx, tenantId, { fullName: d.fullName, phone: d.phone, email: d.email, preferredBranchId: hold.branch_id });
    const timezone = safeTimeZone((await this.repo.branchTimezone(tx, hold.branch_id)) ?? policy.timezone);
    const { code, hash } = await this.freshCode(tx, tenantId);
    const status = policy.autoConfirm ? 'confirmed' : 'pending';
    await this.repo.finalizeHold(tx, holdId, {
      patientId: patient.id, status, patientNotes: d.notes, codeHash: hash,
      codeExpiresAt: new Date(endOfDay(dateInZone(hold.starts_at.getTime(), timezone), timezone)),
      manageTokenHash: manageTokenHash(manageToken(this.cfg.BOOKING_CODE_SECRET, holdId)), // Phase 2E: the patient's own link
    });
    await this.repo.addOutboxEvent(tx, tenantId, 'appointment.created', { appointmentId: holdId, source: 'website', status });
    const appointment = await this.repo.get(tx, holdId);
    if (!appointment) throw Err.conflict('hold_expired', 'The reserved time ran out; pick a slot again');
    return { appointmentId: holdId, status, startsAt: hold.starts_at, endsAt: hold.ends_at, timezone, code, appointment: publicView(appointment) };
  }

  /**
   * A 6-digit code that is not open on another appointment of the clinic. Codes are cleared when an appointment is
   * cancelled, missed or expires (trigger), so the open set stays small and a retry is almost never needed; checking
   * first avoids turning a rare collision into a failed booking (a unique violation would abort the transaction).
   */
  private async freshCode(tx: Session, tenantId: string): Promise<{ code: string; hash: string }> {
    for (let i = 0; i < 5; i++) {
      const c = this.codes.issue(tenantId);
      if (!(await this.repo.codeInUse(tx, c.hash))) return c;
    }
    throw Err.conflict('busy', 'Could not issue a booking code; please try again');
  }

  /** The visitor went back or left: free the slot now, forget what they typed. Unknown or ended holds are fine. */
  async release(scope: TenantScope, holdId: string): Promise<void> {
    await scope.run((tx) => this.repo.releaseHold(tx, holdId));
    await this.forget(holdId);
  }

  /** The details expire with the hold anyway (TTL); a Redis hiccup here is logged, never surfaced. */
  private async forget(holdId: string): Promise<void> {
    try {
      await this.details.delete(holdId);
    } catch (err) {
      this.logger.warn(`Could not clear booking details for hold ${holdId}: ${(err as Error).message}`);
    }
  }

  /** The code is shown on the confirmation screen; the email is a convenience and must never fail the booking. */
  private async emailCode(b: BookingSummary, email: string): Promise<void> {
    const when = emailWhen(b.startsAt, b.timezone); // the branch's wall clock, in Arabic (L10N-004)
    const doctor = b.appointment.doctor.name_ar ?? b.appointment.doctor.name_en ?? '';
    const title = b.status === 'confirmed' ? 'تم تأكيد موعدك' : 'تم استلام طلب الحجز';
    try {
      await this.email.send(email, `${title} – رمز الحضور ${b.code}`,
        `${title}.\nالموعد: ${when}\nالطبيب: ${doctor}\nرمز الحضور: ${b.code} — أظهره في الاستقبال.`);
    } catch (err) {
      this.logger.error(`Booking code email to ${maskEmail(email)} failed: ${(err as Error).message}`);
    }
  }
}
