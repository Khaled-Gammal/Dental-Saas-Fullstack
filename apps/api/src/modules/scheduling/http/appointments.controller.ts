import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import type { z } from 'zod';
import { RequirePermission } from '../../../auth/decorators';
import type { RequestContext } from '../../../shared/context/request-context';
import { TenantDb } from '../../../shared/database/tenant-db.service';
import { Err } from '../../../shared/errors/app-error';
import { ZodBody } from '../../../shared/validation/zod-body.pipe';
import { ManageAppointments, type Actor } from '../application/manage-appointments.usecase';
import type { StaffAction } from '../domain/appointment-status';
import { ArriveBody, CancelBody, CheckInBody, DayQuery, StaffBookingBody, StaffSlotsQuery } from './schemas';
import { sessionScope } from './scopes';

const id = new ParseUUIDPipe();

/** The dashboard's appointments: a day's list, staff bookings, reception check-in and status moves. */
@ApiTags('appointments')
@ApiBearerAuth()
@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly db: TenantDb,
    private readonly cls: ClsService<RequestContext>,
    private readonly appointments: ManageAppointments,
  ) {}

  private scope() { return sessionScope(this.db, this.cls); }

  private actor(): Actor {
    const memberId = this.cls.get('memberId');
    if (!memberId) throw Err.forbidden('no_clinic', 'No clinic selected for this request');
    return { memberId, permissions: this.cls.get('permissions') ?? [] };
  }

  @Get()
  @RequirePermission('appointments:read')
  list(@Query(new ZodBody(DayQuery)) q: z.infer<typeof DayQuery>) {
    return this.appointments.listDay(this.scope(), q);
  }

  /** Free times for one doctor on one day (the dashboard's booking form). Declared before ':id'. */
  @Get('availability')
  @RequirePermission('appointments:write')
  availability(@Query(new ZodBody(StaffSlotsQuery)) q: z.infer<typeof StaffSlotsQuery>) {
    return this.appointments.freeSlots(this.scope(), q);
  }

  @Get(':id')
  @RequirePermission('appointments:read')
  get(@Param('id', id) appointmentId: string) {
    return this.appointments.get(this.scope(), appointmentId);
  }

  @Post()
  @RequirePermission('appointments:write')
  create(@Body(new ZodBody(StaffBookingBody)) b: z.infer<typeof StaffBookingBody>) {
    return this.appointments.create(this.scope(), b, this.actor());
  }

  @Post('check-in')
  @HttpCode(200)
  @RequirePermission('appointments:write')
  checkIn(@Body(new ZodBody(CheckInBody)) b: z.infer<typeof CheckInBody>) {
    return this.appointments.checkIn(this.scope(), b, this.actor());
  }

  /** The patient is here and has no code to show (staff bookings), or lost it (then `note` is required). */
  @Post(':id/arrive') @HttpCode(200)
  arrive(@Param('id', id) a: string, @Body(new ZodBody(ArriveBody)) b: z.infer<typeof ArriveBody>) {
    return this.appointments.arrive(this.scope(), a, this.actor(), b.note);
  }

  // status moves: the use case decides (doctors may only start/complete their own visits)
  @Post(':id/confirm') @HttpCode(200)
  confirm(@Param('id', id) a: string) { return this.move(a, 'confirm'); }

  @Post(':id/start') @HttpCode(200)
  start(@Param('id', id) a: string) { return this.move(a, 'start'); }

  @Post(':id/complete') @HttpCode(200)
  complete(@Param('id', id) a: string) { return this.move(a, 'complete'); }

  @Post(':id/no-show') @HttpCode(200)
  noShow(@Param('id', id) a: string) { return this.move(a, 'noShow'); }

  @Post(':id/cancel') @HttpCode(200)
  cancel(@Param('id', id) a: string, @Body(new ZodBody(CancelBody)) b: z.infer<typeof CancelBody>) { return this.move(a, 'cancel', b.reason); }

  private move(appointmentId: string, action: StaffAction, reason?: string) {
    return this.appointments.transition(this.scope(), appointmentId, action, this.actor(), reason);
  }
}
