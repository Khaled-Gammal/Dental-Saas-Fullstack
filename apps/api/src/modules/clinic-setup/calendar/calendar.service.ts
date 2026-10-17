import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../../shared/context/request-context';
import { TenantDb } from '../../../shared/database/tenant-db.service';
import { Err } from '../../../shared/errors/app-error';
import { dateInZone, safeTimeZone } from '../../../shared/time/clinic-time';
import { LiveSiteWrite } from '../../website/live-site';
import { CalendarRepository } from './calendar.repository';

/** API names of the booking rules -> tenant_settings columns. */
const BOOKING_COLUMN = {
  autoConfirm: 'booking_auto_confirm', otpRequired: 'booking_otp_required', minNoticeMinutes: 'booking_min_notice_minutes',
  maxDaysAhead: 'booking_max_days_ahead', slotStepMinutes: 'booking_slot_step_minutes', cancelWindowHours: 'booking_cancel_window_hours',
  reminderOffsetsMinutes: 'reminder_offsets_minutes',
} as const;
export type BookingSettingsInput = Partial<{ autoConfirm: boolean; otpRequired: boolean; minNoticeMinutes: number; maxDaysAhead: number;
  slotStepMinutes: number; cancelWindowHours: number; reminderOffsetsMinutes: number[] }>;

/**
 * The clinic calendar (SRS APPT-005, APPT-006, APPT-009): closed days, doctors' time off, rooms, booking rules.
 * Availability already honours holidays and time off; adding one over existing bookings is allowed and returns the
 * bookings it falls on, for reception to move or cancel. Nothing is changed automatically.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly db: TenantDb,
    private readonly site: LiveSiteWrite,
    private readonly repo: CalendarRepository,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private member() { return this.cls.get('memberId') ?? null; }

  holidays(from?: string) {
    return this.db.run(async (tx) => {
      const today = dateInZone(Date.now(), safeTimeZone((await tx.selectFrom('tenants').select('timezone').executeTakeFirst())?.timezone));
      return this.repo.holidays(tx, from ?? today);
    });
  }

  /** Closed days change the website's opening hours, so its cache is purged. */
  addHoliday(input: { branchId: string | null; date: string; name: string }) {
    return this.site.run(async (tx, tenantId) => {
      if (input.branchId && !(await this.repo.branchExists(tx, input.branchId))) throw Err.badRequest('branch_not_found', 'Branch not found');
      const holiday = await this.repo.insertHoliday(tx, { tenantId, ...input, createdBy: this.member() });
      return { holiday, conflicts: await this.repo.holidayConflicts(tx, input.date, input.branchId) };
    });
  }

  removeHoliday(id: string) {
    return this.site.run(async (tx) => {
      if (!(await this.repo.deleteHoliday(tx, id))) throw Err.notFound('holiday_not_found', 'Holiday not found');
    });
  }

  timeOff(doctorId: string) {
    return this.db.run(async (tx) => {
      if (!(await this.repo.doctorExists(tx, doctorId))) throw Err.notFound('doctor_not_found', 'Doctor not found');
      return this.repo.timeOff(tx, doctorId);
    });
  }

  addTimeOff(doctorId: string, input: { startsAt: Date; endsAt: Date; reason: string | null }) {
    if (input.endsAt <= input.startsAt) throw Err.badRequest('invalid_range', 'The end must be after the start');
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.repo.doctorExists(tx, doctorId))) throw Err.notFound('doctor_not_found', 'Doctor not found');
      const timeOff = await this.repo.insertTimeOff(tx, { tenantId, doctorId, ...input, createdBy: this.member() });
      return { timeOff, conflicts: await this.repo.timeOffConflicts(tx, doctorId, input.startsAt, input.endsAt) };
    });
  }

  removeTimeOff(doctorId: string, id: string) {
    return this.db.run(async (tx) => {
      if (!(await this.repo.deleteTimeOff(tx, doctorId, id))) throw Err.notFound('time_off_not_found', 'Time off not found');
    });
  }

  rooms(branchId: string) {
    return this.db.run(async (tx) => {
      if (!(await this.repo.branchExists(tx, branchId))) throw Err.notFound('branch_not_found', 'Branch not found');
      return this.repo.rooms(tx, branchId);
    });
  }

  addRoom(branchId: string, name: string) {
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.repo.branchExists(tx, branchId))) throw Err.notFound('branch_not_found', 'Branch not found');
      return this.repo.insertRoom(tx, { tenantId, branchId, name });
    });
  }

  /** A room is deactivated rather than deleted: past bookings point at it. */
  updateRoom(id: string, input: { name?: string; isActive?: boolean }) {
    return this.db.run(async (tx) => {
      const room = await this.repo.updateRoom(tx, id, {
        ...(input.name !== undefined && { name: input.name }), ...(input.isActive !== undefined && { is_active: input.isActive }),
      });
      if (!room) throw Err.notFound('room_not_found', 'Room not found');
      return room;
    });
  }

  bookingSettings() {
    return this.db.run(async (tx) => toApi(await this.repo.bookingSettings(tx)));
  }

  updateBookingSettings(input: BookingSettingsInput) {
    return this.db.run(async (tx) => {
      const patch: Record<string, unknown> = {};
      for (const [k, col] of Object.entries(BOOKING_COLUMN)) if (k in input) patch[col] = input[k as keyof BookingSettingsInput];
      await this.repo.updateBookingSettings(tx, patch);
      return toApi(await this.repo.bookingSettings(tx));
    });
  }
}

function toApi(s: Awaited<ReturnType<CalendarRepository['bookingSettings']>>) {
  return {
    autoConfirm: s.booking_auto_confirm, otpRequired: s.booking_otp_required, minNoticeMinutes: s.booking_min_notice_minutes,
    maxDaysAhead: s.booking_max_days_ahead, slotStepMinutes: s.booking_slot_step_minutes, cancelWindowHours: s.booking_cancel_window_hours,
    reminderOffsetsMinutes: s.reminder_offsets_minutes,
  };
}
