import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../../auth/decorators';
import { ISO_DATE } from '../../../shared/time/clinic-time';
import { ZodBody } from '../../../shared/validation/zod-body.pipe';
import { CalendarService } from './calendar.service';

const id = new ParseUUIDPipe();
const IsoDate = z.string().regex(ISO_DATE, 'YYYY-MM-DD');
const Instant = z.string().datetime({ offset: true }).transform((v) => new Date(v));

const HolidaysQuery = z.object({ from: IsoDate.optional() }).strict();
const HolidayBody = z.object({ branchId: z.string().uuid().nullable().default(null), date: IsoDate, name: z.string().trim().min(1).max(100) }).strict();
const TimeOffBody = z.object({ startsAt: Instant, endsAt: Instant, reason: z.string().trim().max(200).transform((v) => v || null).nullable().default(null) }).strict();
const RoomBody = z.object({ name: z.string().trim().min(1).max(40) }).strict();
const RoomPatch = z.object({ name: z.string().trim().min(1).max(40).optional(), isActive: z.boolean().optional() }).strict();
/** The website booking rules; limits mirror the tenant_settings CHECKs. Online payment stays off (no gateway in v4). */
const BookingSettingsBody = z.object({
  autoConfirm: z.boolean(),
  otpRequired: z.boolean(),
  minNoticeMinutes: z.number().int().min(0).max(10080),
  maxDaysAhead: z.number().int().min(1).max(365),
  slotStepMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]),
  cancelWindowHours: z.number().int().min(0).max(168),
  reminderOffsetsMinutes: z.array(z.number().int().min(15).max(10080)).max(4)
    .transform((xs) => [...new Set(xs)].sort((a, b) => b - a)),
}).partial().strict();

/**
 * The clinic calendar: holidays, doctors' time off, rooms, booking rules (SRS APPT-005/006/009). Reads need only
 * membership (reception plans around them); writes are the owner's (`settings:write`).
 */
@ApiTags('calendar')
@ApiBearerAuth()
@Controller()
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('holidays')
  holidays(@Query(new ZodBody(HolidaysQuery)) q: z.infer<typeof HolidaysQuery>) { return this.calendar.holidays(q.from); }

  @Post('holidays')
  @RequirePermission('settings:write')
  addHoliday(@Body(new ZodBody(HolidayBody)) b: z.infer<typeof HolidayBody>) { return this.calendar.addHoliday(b); }

  @Delete('holidays/:id') @HttpCode(204)
  @RequirePermission('settings:write')
  removeHoliday(@Param('id', id) holidayId: string) { return this.calendar.removeHoliday(holidayId); }

  @Get('doctors/:id/time-off')
  timeOff(@Param('id', id) doctorId: string) { return this.calendar.timeOff(doctorId); }

  @Post('doctors/:id/time-off')
  @RequirePermission('settings:write')
  addTimeOff(@Param('id', id) doctorId: string, @Body(new ZodBody(TimeOffBody)) b: z.infer<typeof TimeOffBody>) { return this.calendar.addTimeOff(doctorId, b); }

  @Delete('doctors/:id/time-off/:offId') @HttpCode(204)
  @RequirePermission('settings:write')
  removeTimeOff(@Param('id', id) doctorId: string, @Param('offId', id) offId: string) { return this.calendar.removeTimeOff(doctorId, offId); }

  @Get('branches/:id/rooms')
  rooms(@Param('id', id) branchId: string) { return this.calendar.rooms(branchId); }

  @Post('branches/:id/rooms')
  @RequirePermission('settings:write')
  addRoom(@Param('id', id) branchId: string, @Body(new ZodBody(RoomBody)) b: z.infer<typeof RoomBody>) { return this.calendar.addRoom(branchId, b.name); }

  @Patch('rooms/:id')
  @RequirePermission('settings:write')
  updateRoom(@Param('id', id) roomId: string, @Body(new ZodBody(RoomPatch)) b: z.infer<typeof RoomPatch>) { return this.calendar.updateRoom(roomId, b); }

  @Get('clinic/booking-settings')
  bookingSettings() { return this.calendar.bookingSettings(); }

  @Patch('clinic/booking-settings')
  @RequirePermission('settings:write')
  updateBookingSettings(@Body(new ZodBody(BookingSettingsBody)) b: z.infer<typeof BookingSettingsBody>) { return this.calendar.updateBookingSettings(b); }
}
