import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../../auth/decorators';
import { AUTH_POLICY } from '../../config';
import { AppError } from '../../shared/errors/app-error';
import { RATE_LIMITER, type RateLimiter } from '../../shared/rate-limit/ports';
import { DisplayName, OtpCode, PhoneText, TenantSlug } from '../../shared/validation/common';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { LoginService } from './login.service';
import { SessionCookie, requestMeta } from './session-cookie';
import { SessionService } from './session.service';
import { SignupService } from './signup.service';

const Signup = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(200),
  phone: PhoneText,
  password: z.string().min(8).max(128),
  clinicNameAr: DisplayName,
  clinicNameEn: DisplayName.optional(),
  slug: TenantSlug,
  locale: z.enum(['ar', 'en']).optional(),
});
const SlugQuery = z.string().trim().toLowerCase().max(63).catch('');
const Email = z.string().trim().toLowerCase().email().max(200);
const Resend = z.object({ email: Email });
const Verify = z.object({ email: Email, code: OtpCode });
const Login = z.object({
  identifier: z.string().trim().min(3).max(200), // email or phone
  password: z.string().min(1).max(128),
  clinic: z.string().trim().optional(), // clinic slug, for people who work at several clinics
});

const T = AUTH_POLICY.throttle;

/** HTTP edge of identity: validation, per-IP throttles and the refresh cookie. Rules live in the services. */
@ApiTags('auth')
@Controller('auth')
export class IdentityController {
  constructor(
    private readonly signups: SignupService,
    private readonly logins: LoginService,
    private readonly sessions: SessionService,
    private readonly cookie: SessionCookie,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  /** Per-IP abuse limits on the public auth endpoints (email codes, scrypt CPU, scraping). */
  private throttle(req: Request, action: keyof typeof T) {
    const [limit, windowSeconds] = T[action];
    return this.limiter.throttle(`ip:${action}:${req.ip ?? '-'}`, limit, windowSeconds);
  }

  @Public()
  @Get('slug-available')
  async slugAvailable(@Query('slug') raw: unknown, @Req() req: Request) {
    await this.throttle(req, 'slug');
    const slug = SlugQuery.parse(raw); // ?slug=a&slug=b or missing -> '' (not available), never a 500
    return { slug, available: slug.length >= 3 && (await this.signups.slugAvailable(slug)) };
  }

  @Public()
  @Post('signup')
  async signup(@Body(new ZodBody(Signup)) body: z.infer<typeof Signup>, @Req() req: Request) {
    await this.throttle(req, 'signup');
    return this.signups.signup(body, requestMeta(req));
  }

  @Public()
  @Post('otp/resend')
  @HttpCode(202)
  async resend(@Body(new ZodBody(Resend)) body: z.infer<typeof Resend>, @Req() req: Request) {
    await this.throttle(req, 'otpResend');
    return this.signups.resendOtp(body.email, requestMeta(req));
  }

  /** The owner confirms the sign-up email with the 6-digit code and is signed in (SRS AUTH-101). */
  @Public()
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body(new ZodBody(Verify)) body: z.infer<typeof Verify>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.throttle(req, 'otpVerify');
    return this.cookie.issue(res, await this.signups.verifyEmail(body.email, body.code, requestMeta(req)));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodBody(Login)) body: z.infer<typeof Login>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.throttle(req, 'login');
    return this.cookie.issue(res, await this.logins.login(body.identifier, body.password, body.clinic, requestMeta(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.cookie.issue(res, await this.sessions.refresh(this.cookie.read(req), requestMeta(req)));
    } catch (err) {
      // a refresh race keeps the cookie (the other tab holds the new one); any other failure ends the session
      if (!(err instanceof AppError && err.code === 'refresh_race')) this.cookie.clear(res);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sessions.logout(this.cookie.read(req), requestMeta(req));
    this.cookie.clear(res);
  }
}
