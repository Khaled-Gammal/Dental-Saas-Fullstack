import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { Public } from '../../auth/decorators';
import { AUTH_POLICY } from '../../config';
import { RATE_LIMITER, type RateLimiter } from '../../shared/rate-limit/ports';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { requestMeta } from '../identity/session-cookie';
import { Activate, ChangePlan, EditPlan, ExtendTrial, NewNote, PlatformLogin, PlatformVerify, Suspend } from './platform.schemas';
import { PlatformCookie, PlatformGuard } from './platform-session';
import { PlatformService } from './platform.service';

const id = new ParseUUIDPipe();
type Body<T extends z.ZodTypeAny> = z.infer<T>;
const T = AUTH_POLICY.throttle;

/** Platform panel sign-in (H5): password, then the emailed code; throttled per IP like the clinic sign-in. */
@ApiTags('platform')
@Public()
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly platform: PlatformService,
    private readonly cookie: PlatformCookie,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  @Post('login') @HttpCode(200)
  async login(@Body(new ZodBody(PlatformLogin)) b: Body<typeof PlatformLogin>, @Req() req: Request) {
    await this.limiter.throttle(`ip:platform-login:${req.ip ?? '-'}`, ...T.login);
    return this.platform.login(b.email, b.password, requestMeta(req));
  }

  @Post('verify') @HttpCode(200)
  async verify(@Body(new ZodBody(PlatformVerify)) b: Body<typeof PlatformVerify>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.limiter.throttle(`ip:platform-verify:${req.ip ?? '-'}`, ...T.otpVerify);
    const { token, me } = await this.platform.verify(b.email, b.code, requestMeta(req));
    this.cookie.issue(res, token);
    return me;
  }

  @Post('logout') @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    this.cookie.clear(res);
  }
}

/** The platform panel (H5; ADM-01, ADM-02, ADM-04): platform admins only, checked on every request. */
@ApiTags('platform')
@Public()
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('me')
  me() { return this.platform.me(); }

  @Get('clinics')
  clinics() { return this.platform.clinics(); }

  @Get('clinics/:id')
  clinic(@Param('id', id) clinicId: string) { return this.platform.clinic(clinicId); }

  @Post('clinics/:id/trial') @HttpCode(200)
  extendTrial(@Param('id', id) clinicId: string, @Body(new ZodBody(ExtendTrial)) b: Body<typeof ExtendTrial>) {
    return this.platform.extendTrial(clinicId, b.until);
  }

  @Post('clinics/:id/suspend') @HttpCode(200)
  suspend(@Param('id', id) clinicId: string, @Body(new ZodBody(Suspend)) b: Body<typeof Suspend>) {
    return this.platform.suspend(clinicId, b.reason);
  }

  @Post('clinics/:id/reactivate') @HttpCode(200)
  reactivate(@Param('id', id) clinicId: string) { return this.platform.reactivate(clinicId); }

  @Post('clinics/:id/activate') @HttpCode(200)
  activate(@Param('id', id) clinicId: string, @Body(new ZodBody(Activate)) b: Body<typeof Activate>) {
    return this.platform.activate(clinicId, b.cycle);
  }

  @Post('clinics/:id/plan') @HttpCode(200)
  changePlan(@Param('id', id) clinicId: string, @Body(new ZodBody(ChangePlan)) b: Body<typeof ChangePlan>) {
    return this.platform.changePlan(clinicId, b.planId);
  }

  @Post('clinics/:id/notes')
  addNote(@Param('id', id) clinicId: string, @Body(new ZodBody(NewNote)) b: Body<typeof NewNote>) {
    return this.platform.addNote(clinicId, b.body);
  }

  @Get('audit')
  audit() { return this.platform.audit(); }

  @Get('plans')
  plans() { return this.platform.plans(); }

  @Patch('plans/:id')
  editPlan(@Param('id', id) planId: string, @Body(new ZodBody(EditPlan)) b: Body<typeof EditPlan>, @Req() req: Request) {
    return this.platform.editPlan(planId, b, req.ip ?? null);
  }
}
