import { Body, Controller, Get, HttpCode, Inject, Ip, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { z } from 'zod';
import { Public } from '../../../auth/decorators';
import { clipUserAgent } from '../../../shared/request-meta';
import { TenantDb } from '../../../shared/database/tenant-db.service';
import { RATE_LIMITER, type RateLimiter } from '../../../shared/rate-limit/ports';
import { ZodBody } from '../../../shared/validation/zod-body.pipe';
import type { RequestMeta } from '../../identity/identity.types';
import { BookOnline } from '../application/book-online.usecase';
import { GetAvailability } from '../application/get-availability.usecase';
import { GetBookingOptions } from '../application/get-booking-options.usecase';
import { HoldSlot } from '../application/hold-slot.usecase';
import { SCHEDULING_REPOSITORY, type SchedulingRepository } from '../application/ports';
import { ConfirmBody, DetailsBody, HoldBody, HostOnlyBody, HostQuery, SlotsQuery } from './schemas';
import { hostScope } from './scopes';

/** Per-IP abuse limits on the public booking endpoints: [requests, window seconds]. */
const THROTTLE = { release: [40, 600], slots: [120, 60], hold: [20, 600], details: [10, 600], confirm: [30, 600] } as const;

const meta = (req: Request, ip: string): RequestMeta => ({ ip, userAgent: clipUserAgent(req.headers['user-agent']) ?? undefined });
const holdId = new ParseUUIDPipe();

/**
 * Online booking for a clinic website (SRS 4.5, 4.11). No login: the clinic is the hostname's owner, the hold id is
 * the visitor's capability, and the phone OTP proves who is booking. Each handler is one use case in one transaction.
 */
@ApiTags('public')
@Public()
@Controller('public/booking')
export class PublicBookingController {
  constructor(
    private readonly db: TenantDb,
    private readonly options: GetBookingOptions,
    private readonly availability: GetAvailability,
    private readonly hold: HoldSlot,
    private readonly book: BookOnline,
    @Inject(SCHEDULING_REPOSITORY) private readonly repo: SchedulingRepository,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  @Get('options')
  // not throttled per IP: the website server renders /book with it (one address for every visitor), and caches it like /public/site
  getOptions(@Query(new ZodBody(HostQuery)) q: z.infer<typeof HostQuery>) {
    return this.options.execute(hostScope(this.db, q.host));
  }

  @Get('slots')
  async getSlots(@Query(new ZodBody(SlotsQuery)) q: z.infer<typeof SlotsQuery>, @Ip() ip: string) {
    await this.limiter.throttle(`booking:slots:${ip}`, ...THROTTLE.slots);
    return hostScope(this.db, q.host).run(async (tx) => {
      const policy = await this.repo.policy(tx);
      const day = await this.availability.forDate(tx, { branchId: q.branchId, serviceId: q.serviceId, doctorId: q.doctorId, date: q.date, policy, online: true });
      return { date: day.date, timezone: day.timezone, durationMinutes: day.durationMinutes, slots: day.slots };
    });
  }

  @Post('holds')
  async createHold(@Body(new ZodBody(HoldBody)) b: z.infer<typeof HoldBody>, @Ip() ip: string) {
    await this.limiter.throttle(`booking:hold:${ip}`, ...THROTTLE.hold);
    const { host, ...input } = b;
    return this.hold.execute(hostScope(this.db, host), input);
  }

  @Post('holds/:id/details')
  async submitDetails(@Param('id', holdId) id: string, @Body(new ZodBody(DetailsBody)) b: z.infer<typeof DetailsBody>, @Ip() ip: string, @Req() req: Request) {
    await this.limiter.throttle(`booking:details:${ip}`, ...THROTTLE.details);
    const { host, ...input } = b;
    return this.book.submitDetails(hostScope(this.db, host), id, input, meta(req, ip));
  }

  /** The visitor went back or left the page: free the slot now instead of in up to 10 minutes. Idempotent. */
  @Post('holds/:id/release')
  @HttpCode(204)
  async release(@Param('id', holdId) id: string, @Body(new ZodBody(HostOnlyBody)) b: z.infer<typeof HostOnlyBody>, @Ip() ip: string): Promise<void> {
    await this.limiter.throttle(`booking:release:${ip}`, ...THROTTLE.release);
    await this.book.release(hostScope(this.db, b.host), id);
  }

  @Post('holds/:id/confirm')
  async confirm(@Param('id', holdId) id: string, @Body(new ZodBody(ConfirmBody)) b: z.infer<typeof ConfirmBody>, @Ip() ip: string, @Req() req: Request) {
    await this.limiter.throttle(`booking:confirm:${ip}`, ...THROTTLE.confirm);
    return this.book.confirm(hostScope(this.db, b.host), id, b.code, meta(req, ip));
  }
}
