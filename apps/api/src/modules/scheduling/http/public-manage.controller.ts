import { Body, Controller, HttpCode, Inject, Ip, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Public } from '../../../auth/decorators';
import { TenantDb } from '../../../shared/database/tenant-db.service';
import { RATE_LIMITER, type RateLimiter } from '../../../shared/rate-limit/ports';
import { ZodBody } from '../../../shared/validation/zod-body.pipe';
import { PatientSelfService } from '../application/patient-self-service.usecase';
import { ManageBody, ManageMoveBody, ManageSlotsBody } from './schemas';
import { hostScope } from './scopes';

/** Per-IP limits: [requests, window seconds]. Reading is generous (the page and its date strip); changes are few. */
const THROTTLE = { view: [60, 600], slots: [120, 600], change: [10, 600] } as const;

/**
 * Phase 2E: the patient's own link to their booking, on the clinic's website (`/appointment/<token>`). No sign-in: the
 * clinic is the hostname's owner and the link's token is the patient's capability. POST everywhere, so the token stays
 * out of URLs and access logs on this side.
 */
@ApiTags('public')
@Public()
@Controller('public/appointment')
export class PublicManageController {
  constructor(
    private readonly db: TenantDb,
    private readonly self: PatientSelfService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  @Post('view')
  @HttpCode(200)
  async view(@Body(new ZodBody(ManageBody)) b: z.infer<typeof ManageBody>, @Ip() ip: string) {
    await this.limiter.throttle(`manage:view:${ip}`, ...THROTTLE.view);
    return this.self.view(hostScope(this.db, b.host), b.token);
  }

  @Post('slots')
  @HttpCode(200)
  async slots(@Body(new ZodBody(ManageSlotsBody)) b: z.infer<typeof ManageSlotsBody>, @Ip() ip: string) {
    await this.limiter.throttle(`manage:slots:${ip}`, ...THROTTLE.slots);
    return this.self.slots(hostScope(this.db, b.host), b.token, b.date);
  }

  @Post('cancel')
  @HttpCode(200)
  async cancel(@Body(new ZodBody(ManageBody)) b: z.infer<typeof ManageBody>, @Ip() ip: string) {
    await this.limiter.throttle(`manage:change:${ip}`, ...THROTTLE.change);
    return this.self.cancel(hostScope(this.db, b.host), b.token);
  }

  @Post('reschedule')
  @HttpCode(200)
  async reschedule(@Body(new ZodBody(ManageMoveBody)) b: z.infer<typeof ManageMoveBody>, @Ip() ip: string) {
    await this.limiter.throttle(`manage:change:${ip}`, ...THROTTLE.change);
    return this.self.reschedule(hostScope(this.db, b.host), b.token, b.startsAt);
  }
}
