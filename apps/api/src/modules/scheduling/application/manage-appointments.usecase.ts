import { Inject, Injectable, Logger } from '@nestjs/common';
import { hasPermission } from '../../../auth/permissions';
import { PatientDirectory } from '../../patients';
import { Err } from '../../../shared/errors/app-error';
import { maskEmail } from '../../../shared/mask';
import { emailWhen } from '../../../shared/notifications/arabic-mail';
import { EMAIL_SENDER, type EmailSender } from '../../../shared/notifications/ports';
import { ACTION_TARGET, canTransition, type StaffAction } from '../domain/appointment-status';
import { dateInZone, dayWindow, endOfDay, safeTimeZone } from '../../../shared/time/clinic-time';
import { GetAvailability } from './get-availability.usecase';
import {
  BOOKING_CODES, CLOCK, SCHEDULING_REPOSITORY,
  type AppointmentView, type BookingCodes, type CheckInResult, type Clock, type SchedulingRepository, type Session, type StatusPatch, type TenantScope,
} from './ports';

/** Who is acting, from the access token. Permissions are checked here because "own" needs the appointment. */
export interface Actor { memberId: string; permissions: string[] }

export interface StaffBookingInput {
  patientId: string; branchId: string; doctorId: string; serviceId?: string | null; startsAt: Date; durationMinutes?: number;
  source: 'dashboard' | 'phone' | 'walk_in' | 'whatsapp'; notes?: string | null; overrideReason?: string | null;
}

/** A move: any of the fields; what is left out stays as it is. `roomId: null` clears the room. */
export interface MoveInput {
  startsAt?: Date; doctorId?: string; branchId?: string; durationMinutes?: number; roomId?: string | null; overrideReason?: string | null;
}

const has = (a: Actor, p: string) => hasPermission(a.permissions, p);
const branchForbidden = () => Err.forbidden('branch_forbidden', 'You do not work at this branch');

/** Recorded when a staff booking (which never has a code) is checked in at the desk. */
export const STAFF_ARRIVAL_NOTE = 'Checked in at reception (staff booking, no booking code)';

/** Reception and doctors working the day's appointments (DSH-02 day view, BOOK-13 check-in, SRS 4.10 moves). */
@Injectable()
export class ManageAppointments {
  private readonly logger = new Logger('ManageAppointments');

  constructor(
    @Inject(SCHEDULING_REPOSITORY) private readonly repo: SchedulingRepository,
    @Inject(BOOKING_CODES) private readonly codes: BookingCodes,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly availability: GetAvailability,
    private readonly patients: PatientDirectory,
  ) {}

  /**
   * A member limited to some branches is refused another branch explicitly (403), for a clear message. Row-level
   * security would hide or refuse those rows anyway; this check is for the user, not the last guard.
   */
  private async assertBranch(tx: Session, branchId: string) {
    if (!(await this.repo.branchAllowed(tx, branchId))) throw branchForbidden();
  }

  /**
   * One calendar day in the branch's zone (or the clinic's, for all branches; a branch-limited member sees theirs).
   * `mine`: only the appointments of the doctor record the member signs in as (SRS APPT-004).
   */
  listDay(scope: TenantScope, q: { date: string; branchId?: string; mine?: boolean }, actor?: Actor): Promise<{ date: string; timezone: string; appointments: AppointmentView[] }> {
    return scope.run(async (tx) => {
      if (q.branchId) await this.assertBranch(tx, q.branchId);
      const policy = await this.repo.policy(tx);
      const branchTz = q.branchId ? await this.repo.branchTimezone(tx, q.branchId) : null;
      if (branchTz === undefined) throw Err.notFound('branch_not_found', 'Branch not found');
      const timezone = safeTimeZone(branchTz ?? policy.timezone);
      const w = dayWindow(q.date, timezone);
      let doctorId: string | undefined;
      if (q.mine) {
        doctorId = (actor && (await this.repo.doctorOfMember(tx, actor.memberId))) ?? undefined;
        if (!doctorId) return { date: q.date, timezone, appointments: [] }; // not a doctor: nothing is "mine"
      }
      const appointments = await this.repo.listBetween(tx, { from: new Date(w.start), to: new Date(w.end), branchId: q.branchId, doctorId });
      return { date: q.date, timezone, appointments };
    });
  }

  /**
   * Move a booking to another time, doctor or branch, and/or give it a room (SRS APPT-001, APPT-006). Same record, same
   * rules as a staff booking: inside the doctor's schedule, or outside it with a reason and `appointments:override`.
   * Times move only while pending/confirmed; a room can also be set after check-in. If the day changes, an unused
   * reception code is replaced and the new one emailed; reminders follow through `appointment.rescheduled`.
   */
  async move(scope: TenantScope, id: string, input: MoveInput, actor: Actor): Promise<AppointmentView> {
    let newCode: { to: string; code: string; when: string } | null = null;
    const view = await scope.run(async (tx, tenantId) => {
      if (!has(actor, 'appointments:write')) throw Err.forbidden('missing_permission', 'You cannot move appointments');
      const row = await this.repo.lockForMove(tx, id);
      if (!row) throw Err.notFound('appointment_not_found', 'Appointment not found');
      const branchId = input.branchId ?? row.branch_id;
      const doctorId = input.doctorId ?? row.doctor_id;
      const lengthMs = input.durationMinutes ? input.durationMinutes * 60_000 : row.ends_at.getTime() - row.starts_at.getTime();
      const startsAt = input.startsAt ?? row.starts_at;
      const moves = startsAt.getTime() !== row.starts_at.getTime() || branchId !== row.branch_id || doctorId !== row.doctor_id
        || lengthMs !== row.ends_at.getTime() - row.starts_at.getTime();

      if (!moves) {
        if (input.roomId === undefined) throw Err.badRequest('nothing_to_change', 'Nothing to change');
        if (!['pending', 'confirmed', 'checked_in', 'in_progress'].includes(row.status)) {
          throw Err.conflict('invalid_transition', `An appointment that is ${row.status} cannot get a room`, { from: row.status });
        }
        if (input.roomId && !(await this.repo.roomInBranch(tx, input.roomId, row.branch_id))) throw Err.badRequest('room_not_in_branch', 'Room not found in this branch');
        await this.repo.setRoom(tx, id, input.roomId);
        return (await this.repo.get(tx, id))!;
      }

      if (!['pending', 'confirmed'].includes(row.status)) {
        throw Err.conflict('invalid_transition', `An appointment that is ${row.status} cannot be moved; book a new one`, { from: row.status });
      }
      await this.assertBranch(tx, branchId);
      const doctor = await this.repo.doctorAtBranch(tx, doctorId, branchId);
      if (doctor === 'not_found') throw Err.notFound('doctor_not_found', 'Doctor not found');
      if (doctor === 'inactive') throw Err.conflict('doctor_inactive', 'This doctor is deactivated and cannot be booked');
      if (doctor === 'not_at_branch') throw Err.conflict('doctor_not_at_branch', 'This doctor does not work at this branch');

      const policy = await this.repo.policy(tx);
      const branchTz = await this.repo.branchTimezone(tx, branchId);
      if (branchTz === undefined) throw Err.notFound('branch_not_found', 'Branch not found');
      const tz = safeTimeZone(branchTz ?? policy.timezone);
      const date = dateInZone(startsAt.getTime(), tz);
      // the slot grid for this length; the appointment's own current time is not busy
      const day = await this.availability.forDate(tx, {
        branchId, doctorId, serviceId: null, date, policy, online: false, durationMinutes: lengthMs / 60_000, excludeAppointmentId: id,
      });
      const onGrid = day.slots.some((s) => s.startsAt.getTime() === startsAt.getTime());
      if (!onGrid) {
        if (!input.overrideReason) throw Err.conflict('outside_schedule', 'The doctor is not scheduled then; give an override reason to book anyway');
        if (!has(actor, 'appointments:override')) throw Err.forbidden('missing_permission', 'Booking outside the schedule needs appointments:override');
      }
      const roomId = input.roomId !== undefined ? input.roomId : branchId === row.branch_id ? row.room_id : null;
      if (roomId && !(await this.repo.roomInBranch(tx, roomId, branchId))) throw Err.badRequest('room_not_in_branch', 'Room not found in this branch');

      // a reception code is valid for its day only: a new day gets a new code
      let code: { hash: string; expiresAt: Date } | undefined;
      if (row.has_code && date !== dateInZone(row.starts_at.getTime(), tz)) {
        const fresh = await this.freshCode(tx, tenantId);
        code = { hash: fresh.hash, expiresAt: new Date(endOfDay(date, tz)) };
        if (row.patient_email) newCode = { to: row.patient_email, code: fresh.code, when: emailWhen(startsAt, tz) };
      }
      await this.repo.releaseExpiredHolds(tx, doctorId);
      await this.repo.move(tx, id, {
        startsAt, endsAt: new Date(startsAt.getTime() + lengthMs), doctorId, branchId, roomId,
        overrideReason: onGrid ? null : input.overrideReason ?? null, code,
      });
      await this.repo.addOutboxEvent(tx, tenantId, 'appointment.rescheduled', { appointmentId: id, from: row.starts_at.toISOString() });
      return (await this.repo.get(tx, id))!;
    });
    if (newCode) await this.emailNewCode(newCode);
    return view;
  }

  /** A 6-digit code not open on another appointment of the clinic (as for website bookings). */
  private async freshCode(tx: Session, tenantId: string): Promise<{ code: string; hash: string }> {
    for (let i = 0; i < 5; i++) {
      const c = this.codes.issue(tenantId);
      if (!(await this.repo.codeInUse(tx, c.hash))) return c;
    }
    throw Err.conflict('busy', 'Could not issue a booking code; please try again');
  }

  /** The code is a convenience after a move; the move itself never fails because email is down. */
  private async emailNewCode(m: { to: string; code: string; when: string }): Promise<void> {
    try {
      await this.email.send(m.to, `تغيّر موعدك – رمز الحضور ${m.code}`,
        `تم تغيير موعدك إلى ${m.when}.\nرمز الحضور الجديد: ${m.code} — أظهره في الاستقبال. الرمز السابق لم يعد صالحًا.`);
    } catch (err) {
      this.logger.error(`New booking code email to ${maskEmail(m.to)} failed: ${(err as Error).message}`);
    }
  }

  /** Free times for a staff booking: the doctor's schedule and bookings, no website notice or horizon rules. */
  freeSlots(scope: TenantScope, q: { branchId: string; doctorId: string; serviceId?: string | null; date: string; durationMinutes?: number; excludeAppointmentId?: string }) {
    return scope.run(async (tx) => {
      await this.assertBranch(tx, q.branchId);
      const policy = await this.repo.policy(tx);
      const day = await this.availability.forDate(tx, { ...q, serviceId: q.serviceId ?? null, policy, online: false });
      return { date: day.date, timezone: day.timezone, durationMinutes: day.durationMinutes, slots: day.slots.map((s) => s.startsAt) };
    });
  }

  get(scope: TenantScope, id: string): Promise<AppointmentView> {
    return scope.run(async (tx) => {
      const a = await this.repo.get(tx, id);
      if (!a) throw Err.notFound('appointment_not_found', 'Appointment not found');
      return a;
    });
  }

  /**
   * Staff booking: confirmed at once, inside the doctor's schedule unless an override reason is given (needs
   * appointments:override). The override relaxes the schedule only: the doctor must be active and work at the branch
   * (SRS APPT-002; the database refuses it too).
   */
  create(scope: TenantScope, input: StaffBookingInput, actor: Actor): Promise<AppointmentView> {
    return scope.run(async (tx, tenantId) => {
      await this.assertBranch(tx, input.branchId);
      await this.patients.assertBookable(tx, tenantId, input.patientId);
      const policy = await this.repo.policy(tx);
      const branchTz = await this.repo.branchTimezone(tx, input.branchId);
      if (branchTz === undefined) throw Err.notFound('branch_not_found', 'Branch not found');
      const doctor = await this.repo.doctorAtBranch(tx, input.doctorId, input.branchId);
      if (doctor === 'not_found') throw Err.notFound('doctor_not_found', 'Doctor not found');
      if (doctor === 'inactive') throw Err.conflict('doctor_inactive', 'This doctor is deactivated and cannot be booked');
      if (doctor === 'not_at_branch') throw Err.conflict('doctor_not_at_branch', 'This doctor does not work at this branch');
      const date = dateInZone(input.startsAt.getTime(), safeTimeZone(branchTz ?? policy.timezone));
      const day = await this.availability.forDate(tx, { branchId: input.branchId, serviceId: input.serviceId ?? null, doctorId: input.doctorId, date, policy, online: false, durationMinutes: input.durationMinutes });
      const onGrid = day.slots.some((s) => s.startsAt.getTime() === input.startsAt.getTime());
      if (!onGrid) {
        if (!input.overrideReason) throw Err.conflict('outside_schedule', 'The doctor is not scheduled then; give an override reason to book anyway');
        if (!has(actor, 'appointments:override')) throw Err.forbidden('missing_permission', 'Booking outside the schedule needs appointments:override');
      }
      await this.repo.releaseExpiredHolds(tx, input.doctorId);
      const { id } = await this.repo.insertStaffAppointment(tx, {
        tenantId, branchId: input.branchId, doctorId: input.doctorId, serviceId: input.serviceId ?? null, patientId: input.patientId,
        startsAt: input.startsAt, endsAt: new Date(input.startsAt.getTime() + day.durationMinutes * 60_000), source: input.source, bookedBy: actor.memberId,
        status: 'confirmed', quotedPriceMinor: day.service?.price_minor ?? null, internalNotes: input.notes ?? null, overrideReason: onGrid ? null : input.overrideReason ?? null,
      });
      await this.repo.addOutboxEvent(tx, tenantId, 'appointment.created', { appointmentId: id, source: input.source, status: 'confirmed' });
      return (await this.repo.get(tx, id))!;
    });
  }

  /** Reception consumes the patient's code; the database function makes a code single-use even under concurrency. */
  checkIn(scope: TenantScope, q: { code: string; branchId: string; method?: 'code' | 'qr' }, actor: Actor): Promise<{ result: CheckInResult; appointment: AppointmentView }> {
    return scope.run(async (tx, tenantId) => {
      await this.assertBranch(tx, q.branchId);
      const result = await this.repo.checkInByCode(tx, this.codes.hash(tenantId, q.code), q.branchId, actor.memberId, q.method ?? 'code');
      if (!result) throw Err.notFound('code_invalid', 'Booking code not valid for this branch today (wrong, used, expired or cancelled)');
      return { result, appointment: (await this.repo.get(tx, result.appointment_id))! };
    });
  }

  /**
   * Reception marks the patient arrived without a code: every staff booking (they have none), or a website booking
   * whose patient lost the code — then a note is required ("ID checked, phone lost"), as the schema demands.
   */
  arrive(scope: TenantScope, id: string, actor: Actor, note?: string): Promise<AppointmentView> {
    return scope.run(async (tx) => {
      if (!has(actor, 'appointments:write')) throw Err.forbidden('missing_permission', 'You cannot check patients in');
      const row = await this.repo.lockForTransition(tx, id);
      if (!row) throw Err.notFound('appointment_not_found', 'Appointment not found');
      if (!canTransition(row.status, 'checked_in')) throw Err.conflict('invalid_transition', `An appointment that is ${row.status} cannot be checked in`, { from: row.status, to: 'checked_in' });
      if (row.has_code && !note) throw Err.badRequest('note_required', 'This booking has a reception code; ask for it, or say why it is being skipped');
      await this.repo.arriveManually(tx, id, { memberId: actor.memberId, note: note ?? STAFF_ARRIVAL_NOTE });
      return (await this.repo.get(tx, id))!;
    });
  }

  /** One status move. Doctors with only `appointments:write:own` may start and complete their own visits. */
  transition(scope: TenantScope, id: string, action: StaffAction, actor: Actor, reason?: string | null): Promise<AppointmentView> {
    return scope.run(async (tx) => {
      const row = await this.repo.lockForTransition(tx, id);
      if (!row) throw Err.notFound('appointment_not_found', 'Appointment not found');
      const own = row.doctor_member_id !== null && row.doctor_member_id === actor.memberId;
      const allowed = has(actor, 'appointments:write') || (has(actor, 'appointments:write:own') && own && (action === 'start' || action === 'complete'));
      if (!allowed) throw Err.forbidden('missing_permission', 'You cannot change this appointment');
      const to = ACTION_TARGET[action];
      if (!canTransition(row.status, to)) throw Err.conflict('invalid_transition', `An appointment that is ${row.status} cannot be ${to}`, { from: row.status, to });
      const now = this.clock.now();
      const patch: StatusPatch = { status: to };
      if (to === 'confirmed') patch.confirmedAt = now;
      if (to === 'completed') patch.completedAt = now;
      if (to === 'cancelled') { patch.cancelledAt = now; patch.cancelReason = reason ?? null; patch.cancelledBy = 'clinic'; }
      await this.repo.setStatus(tx, id, patch);
      return (await this.repo.get(tx, id))!;
    });
  }
}
