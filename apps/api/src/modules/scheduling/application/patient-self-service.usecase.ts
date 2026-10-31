import { Inject, Injectable, Logger } from '@nestjs/common';
import { Err } from '../../../shared/errors/app-error';
import { MANAGE_TOKEN_RE, manageTokenHash } from '../../../shared/manage-link';
import { maskEmail } from '../../../shared/mask';
import { emailWhen } from '../../../shared/notifications/arabic-mail';
import { EMAIL_SENDER, type EmailSender } from '../../../shared/notifications/ports';
import { dateInZone, endOfDay, safeTimeZone } from '../../../shared/time/clinic-time';
import { bookableDates } from '../domain/booking-policy';
import { cancelBlock, changeDeadline, MAX_PATIENT_RESCHEDULES, rescheduleBlock, statusAfterMove, type SelfServiceState } from '../domain/self-service';
import { GetAvailability } from './get-availability.usecase';
import { BOOKING_CODES, CLOCK, SCHEDULING_REPOSITORY, type BookingCodes, type Clock, type SchedulingRepository, type SelfServiceRow, type Session, type TenantScope } from './ports';

const pick = (ar: string | null, en: string | null) => ar ?? en ?? null;

/** What the patient's page shows. Nothing about the patient beyond their first name, nothing the clinic wrote. */
export interface SelfServiceView {
  status: string; startsAt: Date; endsAt: Date; timezone: string;
  patientFirstName: string | null;
  clinic: { name: string | null; phone: string | null };
  doctor: string | null; service: string | null; branch: { name: string | null; address: string | null };
  /** the last moment the link can still cancel or move the booking */
  changeUntil: Date;
  cancel: { allowed: boolean; block: string | null };
  reschedule: { allowed: boolean; block: string | null; left: number };
  /** the days the website offers for a new time (clinic zone) */
  dates: { first: string; last: string };
}

/**
 * Phase 2E: the patient's own link to their booking (from the confirmation and reminder emails): see it, cancel it, or
 * move it to another free time with the same doctor at the same branch — up to the clinic's cancellation window
 * before the visit, and at most MAX_PATIENT_RESCHEDULES moves. The link's token is the capability (no sign-in); each
 * change is one transaction under a row lock, audited as the patient's act, and tells the patient and the clinic by
 * email through the outbox.
 */
@Injectable()
export class PatientSelfService {
  private readonly logger = new Logger('PatientSelfService');

  constructor(
    @Inject(SCHEDULING_REPOSITORY) private readonly repo: SchedulingRepository,
    @Inject(BOOKING_CODES) private readonly codes: BookingCodes,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly availability: GetAvailability,
  ) {}

  /** The booking behind a link (locked for a change); a malformed or unknown link is one answer (404), never a hint. */
  private async load(tx: Session, token: string, lock: boolean): Promise<SelfServiceRow> {
    const row = MANAGE_TOKEN_RE.test(token) ? await this.repo.byManageToken(tx, manageTokenHash(token), lock) : undefined;
    if (!row) throw Err.notFound('manage_link_invalid', 'This link is not valid');
    return row;
  }

  /** The doctor still takes website bookings at an open branch: the new time comes from the website's own times. */
  private async onlineDoctor(tx: Session, row: SelfServiceRow): Promise<boolean> {
    if ((await this.repo.branchTimezone(tx, row.branch_id)) === undefined) return false; // the branch was closed
    return (await this.repo.doctorsFor(tx, { branchId: row.branch_id, serviceId: null, doctorId: row.doctor_id, online: true })).length > 0;
  }

  private async state(tx: Session, row: SelfServiceRow): Promise<SelfServiceState> {
    const active = row.status === 'pending' || row.status === 'confirmed';
    return { status: row.status, startsAt: row.starts_at, patientReschedules: row.patient_reschedules, onlineDoctor: active && (await this.onlineDoctor(tx, row)) };
  }

  view(scope: TenantScope, token: string): Promise<SelfServiceView> {
    return scope.run(async (tx) => {
      const row = await this.load(tx, token, false);
      const [policy, windowHours] = [await this.repo.policy(tx), await this.repo.cancelWindowHours(tx)];
      const timezone = safeTimeZone(row.branch_tz ?? policy.timezone);
      const now = this.clock.now().getTime();
      const s = await this.state(tx, row);
      const c = cancelBlock(s, now, windowHours);
      const r = rescheduleBlock(s, now, windowHours);
      return {
        status: row.status, startsAt: row.starts_at, endsAt: row.ends_at, timezone,
        patientFirstName: row.patient_name?.trim().split(/\s+/)[0] ?? null,
        clinic: { name: pick(row.clinic_ar, row.clinic_en), phone: row.branch_phone ?? row.clinic_phone },
        doctor: pick(row.doctor_ar, row.doctor_en), service: pick(row.service_ar, row.service_en),
        branch: { name: pick(row.branch_ar, row.branch_en), address: row.branch_address },
        changeUntil: changeDeadline(row.starts_at, windowHours),
        cancel: { allowed: !c, block: c },
        reschedule: { allowed: !r, block: r, left: Math.max(0, MAX_PATIENT_RESCHEDULES - row.patient_reschedules) },
        dates: bookableDates(now, { ...policy, timezone }),
      };
    });
  }

  /** Free times for the move: the same doctor and branch, the booking's own length, the website's notice and horizon. */
  slots(scope: TenantScope, token: string, date: string) {
    return scope.run(async (tx) => {
      const row = await this.load(tx, token, false);
      const block = rescheduleBlock(await this.state(tx, row), this.clock.now().getTime(), await this.repo.cancelWindowHours(tx));
      if (block) throw this.refused(block);
      const day = await this.availability.forDate(tx, this.slotQuery(row, date, await this.repo.policy(tx)));
      return { date: day.date, timezone: day.timezone, durationMinutes: day.durationMinutes, slots: day.slots.map((x) => ({ startsAt: x.startsAt })) };
    });
  }

  private slotQuery(row: SelfServiceRow, date: string, policy: Awaited<ReturnType<SchedulingRepository['policy']>>) {
    // no service: the length is the booking's own (a staff booking may differ from the service's usual length), and the
    // doctor already provides it; `online` applies the website's notice, horizon and "takes website bookings"
    return {
      branchId: row.branch_id, serviceId: null, doctorId: row.doctor_id, date, policy, online: true,
      durationMinutes: (row.ends_at.getTime() - row.starts_at.getTime()) / 60_000, excludeAppointmentId: row.id,
    };
  }

  private refused(block: string) {
    if (block === 'limit') return Err.conflict('reschedule_limit', `A booking can be moved from the link ${MAX_PATIENT_RESCHEDULES} times; call the clinic`);
    if (block === 'not_online') return Err.conflict('reschedule_not_online', 'This booking cannot be moved online; call the clinic');
    if (block === 'too_late') return Err.conflict('too_late_to_change', 'It is too close to the visit to change it online; call the clinic');
    return Err.conflict('appointment_not_active', 'This booking can no longer be changed');
  }

  async cancel(scope: TenantScope, token: string): Promise<SelfServiceView> {
    await scope.run(async (tx, tenantId) => {
      const row = await this.load(tx, token, true);
      const block = cancelBlock(await this.state(tx, row), this.clock.now().getTime(), await this.repo.cancelWindowHours(tx));
      if (block) throw this.refused(block);
      await this.repo.setStatus(tx, row.id, { status: 'cancelled', cancelledAt: this.clock.now(), cancelReason: null, cancelledBy: 'patient' });
      await this.repo.addOutboxEvent(tx, tenantId, 'appointment.cancelled', { appointmentId: row.id, by: 'patient' });
    });
    return this.view(scope, token);
  }

  async reschedule(scope: TenantScope, token: string, startsAt: Date): Promise<SelfServiceView> {
    let newCode: { to: string; code: string; when: string } | null = null;
    await scope.run(async (tx, tenantId) => {
      const row = await this.load(tx, token, true);
      const block = rescheduleBlock(await this.state(tx, row), this.clock.now().getTime(), await this.repo.cancelWindowHours(tx));
      if (block) throw this.refused(block);
      if (startsAt.getTime() === row.starts_at.getTime()) throw Err.badRequest('nothing_to_change', 'That is the booking\'s current time');
      const policy = await this.repo.policy(tx);
      const tz = safeTimeZone(row.branch_tz ?? policy.timezone);
      const date = dateInZone(startsAt.getTime(), tz);
      const day = await this.availability.forDate(tx, this.slotQuery(row, date, policy));
      if (!day.slots.some((s) => s.startsAt.getTime() === startsAt.getTime())) throw Err.conflict('slot_unavailable', 'That time is no longer available; pick another');

      // a reception code is valid for its day only: a new day gets a new code, emailed after commit
      let code: { hash: string; expiresAt: Date } | undefined;
      if (row.has_code && date !== dateInZone(row.starts_at.getTime(), tz)) {
        const fresh = await this.freshCode(tx, tenantId);
        code = { hash: fresh.hash, expiresAt: new Date(endOfDay(date, tz)) };
        if (row.patient_email) newCode = { to: row.patient_email, code: fresh.code, when: emailWhen(startsAt, tz) };
      }
      await this.repo.releaseExpiredHolds(tx, row.doctor_id);
      const status = statusAfterMove(row.status as 'pending' | 'confirmed', policy.autoConfirm);
      await this.repo.selfMove(tx, row.id, { startsAt, endsAt: new Date(startsAt.getTime() + (row.ends_at.getTime() - row.starts_at.getTime())), status, code });
      await this.repo.addOutboxEvent(tx, tenantId, 'appointment.rescheduled', { appointmentId: row.id, from: row.starts_at.toISOString(), by: 'patient' });
    });
    if (newCode) await this.emailNewCode(newCode);
    return this.view(scope, token);
  }

  private async freshCode(tx: Session, tenantId: string): Promise<{ code: string; hash: string }> {
    for (let i = 0; i < 5; i++) {
      const c = this.codes.issue(tenantId);
      if (!(await this.repo.codeInUse(tx, c.hash))) return c;
    }
    throw Err.conflict('busy', 'Could not issue a booking code; please try again');
  }

  /** The new code is a convenience; the move itself never fails because email is down. */
  private async emailNewCode(m: { to: string; code: string; when: string }): Promise<void> {
    try {
      await this.email.send(m.to, `تغيّر موعدك – رمز الحضور ${m.code}`,
        `تم تغيير موعدك إلى ${m.when}.\nرمز الحضور الجديد: ${m.code} — أظهره في الاستقبال. الرمز السابق لم يعد صالحًا.`);
    } catch (err) {
      this.logger.error(`New booking code email to ${maskEmail(m.to)} failed: ${(err as Error).message}`);
    }
  }
}
