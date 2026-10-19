import { Inject, Injectable } from '@nestjs/common';
import { Err } from '../../../shared/errors/app-error';
import { computeSlots } from '../domain/availability';
import { dateProblem, earliestStart, type BookingPolicy } from '../domain/booking-policy';
import { dayWindow, safeTimeZone, weekdayOf, zonedToUtc } from '../../../shared/time/clinic-time';
import type { Interval } from '../domain/intervals';
import { CLOCK, SCHEDULING_REPOSITORY, type BookingService, type Clock, type SchedulingRepository, type Session } from './ports';

export interface AvailabilityQuery {
  branchId: string;
  serviceId: string | null;
  /** undefined = any doctor who performs the service at the branch */
  doctorId?: string;
  date: string;
  policy: BookingPolicy;
  /** website rules (bookable services, doctors accepting online booking, minimum notice) or staff rules */
  online: boolean;
  /** staff may book without a service; then the visit length comes from here */
  durationMinutes?: number;
  /** a move: the appointment's own current time does not block its new time */
  excludeAppointmentId?: string;
}

export interface Slot { startsAt: Date; doctorIds: string[] }

export interface Availability { date: string; timezone: string; durationMinutes: number; service: BookingService | null; slots: Slot[] }

/** Free slots for one day at one branch, for one doctor or for every doctor who can do the service (SRS BOOK-01/02). */
@Injectable()
export class GetAvailability {
  constructor(
    @Inject(SCHEDULING_REPOSITORY) private readonly repo: SchedulingRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async forDate(tx: Session, q: AvailabilityQuery): Promise<Availability> {
    const branchTz = await this.repo.branchTimezone(tx, q.branchId);
    if (branchTz === undefined) throw Err.notFound('branch_not_found', 'Branch not found');
    const timezone = safeTimeZone(branchTz ?? q.policy.timezone);

    let service: BookingService | null = null;
    if (q.serviceId) {
      service = (await this.repo.service(tx, q.serviceId)) ?? null;
      if (!service) throw Err.notFound('service_not_found', 'Service not found');
      if (q.online && !service.bookable_online) throw Err.badRequest('service_not_bookable', 'This service cannot be booked online');
    }
    const durationMinutes = service?.duration_minutes ?? q.durationMinutes ?? 30;

    const now = this.clock.now().getTime();
    const problem = q.online ? dateProblem(q.date, now, { ...q.policy, timezone }) : null;
    if (problem) throw Err.badRequest('date_out_of_range', problem === 'past' ? 'That day has passed' : `Bookings open ${q.policy.maxDaysAhead} days ahead at most`, { problem });

    const doctorIds = await this.repo.doctorsFor(tx, { branchId: q.branchId, serviceId: q.serviceId, doctorId: q.doctorId, online: q.online });
    const empty = { date: q.date, timezone, durationMinutes, service, slots: [] as Slot[] };
    if (!doctorIds.length) return empty;

    const window = dayWindow(q.date, timezone);
    const ctx = await this.repo.dayContext(tx, {
      branchId: q.branchId, doctorIds, weekday: weekdayOf(q.date), date: q.date, from: new Date(window.start), to: new Date(window.end),
      excludeAppointmentId: q.excludeAppointmentId,
    });
    if (ctx.closed) return empty;

    const toIv = (s: string, e: string): Interval => ({ start: zonedToUtc(q.date, s, timezone), end: zonedToUtc(q.date, e, timezone) });
    const branchHours = ctx.branchHours.map((h) => toIv(h.opens_at, h.closes_at));
    const notBefore = q.online ? earliestStart(now, q.policy) : now;
    const byStart = new Map<number, string[]>();
    for (const doctorId of doctorIds) {
      const slots = computeSlots({
        shifts: ctx.shifts.filter((s) => s.doctor_id === doctorId).map((s) => toIv(s.starts_at, s.ends_at)),
        branchHours,
        busy: ctx.blocked.filter((b) => b.doctor_id === doctorId).map((b) => ({ start: b.starts_at.getTime(), end: b.ends_at.getTime() })),
        durationMs: durationMinutes * 60_000,
        stepMs: q.policy.slotStepMinutes * 60_000,
        notBefore,
      });
      for (const t of slots) byStart.set(t, [...(byStart.get(t) ?? []), doctorId]);
    }
    const slots = [...byStart.entries()].sort(([a], [b]) => a - b).map(([t, ids]) => ({ startsAt: new Date(t), doctorIds: ids }));
    return { ...empty, slots };
  }
}
