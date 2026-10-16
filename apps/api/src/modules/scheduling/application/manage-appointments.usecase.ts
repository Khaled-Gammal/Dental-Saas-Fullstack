import { Inject, Injectable } from '@nestjs/common';
import { hasPermission } from '../../../auth/permissions';
import { PatientDirectory } from '../../patients';
import { Err } from '../../../shared/errors/app-error';
import { ACTION_TARGET, canTransition, type StaffAction } from '../domain/appointment-status';
import { dateInZone, dayWindow, safeTimeZone } from '../../../shared/time/clinic-time';
import { GetAvailability } from './get-availability.usecase';
import {
  BOOKING_CODES, CLOCK, SCHEDULING_REPOSITORY,
  type AppointmentView, type BookingCodes, type CheckInResult, type Clock, type SchedulingRepository, type StatusPatch, type TenantScope,
} from './ports';

/** Who is acting, from the access token. Permissions are checked here because "own" needs the appointment. */
export interface Actor { memberId: string; permissions: string[] }

export interface StaffBookingInput {
  patientId: string; branchId: string; doctorId: string; serviceId?: string | null; startsAt: Date; durationMinutes?: number;
  source: 'dashboard' | 'phone' | 'walk_in' | 'whatsapp'; notes?: string | null; overrideReason?: string | null;
}

const has = (a: Actor, p: string) => hasPermission(a.permissions, p);

/** Recorded when a staff booking (which never has a code) is checked in at the desk. */
export const STAFF_ARRIVAL_NOTE = 'Checked in at reception (staff booking, no booking code)';

/** Reception and doctors working the day's appointments (DSH-02 day view, BOOK-13 check-in, SRS 4.10 moves). */
@Injectable()
export class ManageAppointments {
  constructor(
    @Inject(SCHEDULING_REPOSITORY) private readonly repo: SchedulingRepository,
    @Inject(BOOKING_CODES) private readonly codes: BookingCodes,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly availability: GetAvailability,
    private readonly patients: PatientDirectory,
  ) {}

  /** One calendar day in the branch's zone (or the clinic's, for all branches). */
  listDay(scope: TenantScope, q: { date: string; branchId?: string }): Promise<{ date: string; timezone: string; appointments: AppointmentView[] }> {
    return scope.run(async (tx) => {
      const policy = await this.repo.policy(tx);
      const branchTz = q.branchId ? await this.repo.branchTimezone(tx, q.branchId) : null;
      if (branchTz === undefined) throw Err.notFound('branch_not_found', 'Branch not found');
      const timezone = safeTimeZone(branchTz ?? policy.timezone);
      const w = dayWindow(q.date, timezone);
      const appointments = await this.repo.listBetween(tx, { from: new Date(w.start), to: new Date(w.end), branchId: q.branchId });
      return { date: q.date, timezone, appointments };
    });
  }

  /** Free times for a staff booking: the doctor's schedule and bookings, no website notice or horizon rules. */
  freeSlots(scope: TenantScope, q: { branchId: string; doctorId: string; serviceId?: string | null; date: string; durationMinutes?: number }) {
    return scope.run(async (tx) => {
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

  /** Staff booking: confirmed at once, inside the doctor's schedule unless an override reason is given (needs appointments:override). */
  create(scope: TenantScope, input: StaffBookingInput, actor: Actor): Promise<AppointmentView> {
    return scope.run(async (tx, tenantId) => {
      await this.patients.assertBookable(tx, tenantId, input.patientId);
      const policy = await this.repo.policy(tx);
      const branchTz = await this.repo.branchTimezone(tx, input.branchId);
      if (branchTz === undefined) throw Err.notFound('branch_not_found', 'Branch not found');
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
