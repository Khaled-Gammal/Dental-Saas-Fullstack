import { Body, Controller, Get, Header, HttpCode, Inject, Ip, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { z } from 'zod';
import { Public } from '../../auth/decorators';
import { LANDING_POLICY } from '../../config';
import { RATE_LIMITER, type RateLimiter } from '../../shared/rate-limit/ports';
import { clipUserAgent } from '../../shared/request-meta';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { NewLead } from './landing.schemas';
import { LandingService } from './landing.service';

/** The platform landing page (H7): plans for the pricing table and the contact form. No login. */
@ApiTags('public')
@Public()
@Controller('public')
export class PublicLandingController {
  constructor(private readonly landing: LandingService, @Inject(RATE_LIMITER) private readonly limiter: RateLimiter) {}

  /** LND-02: read by the landing page's server (one address for every visitor), so cached, not throttled */
  @Get('plans')
  @Header('Cache-Control', `public, max-age=0, s-maxage=${LANDING_POLICY.plansCacheSeconds}, stale-while-revalidate=600`)
  plans() { return this.landing.plans(); }

  /** LND-04: a clinic asks for a call */
  @Post('leads') @HttpCode(204)
  async lead(@Body(new ZodBody(NewLead)) b: z.infer<typeof NewLead>, @Ip() ip: string, @Req() req: Request): Promise<void> {
    await this.limiter.throttle(`lead:ip:${ip}`, ...LANDING_POLICY.throttle.leadIp);
    await this.landing.submitLead(b, { ip, userAgent: clipUserAgent(req.headers['user-agent']) ?? undefined });
  }
}
