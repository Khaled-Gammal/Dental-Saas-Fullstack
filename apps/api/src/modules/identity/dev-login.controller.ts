import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../../auth/decorators';
import { APP_CONFIG, type AppConfig } from '../../config';
import { Err } from '../../shared/errors/app-error';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { IdentityRepository } from './identity.repository';
import { SessionCookie, requestMeta } from './session-cookie';
import { SessionService } from './session.service';

const DevLogin = z.object({
  email: z.string().trim().toLowerCase().email(),
  clinic: z.string().trim().optional(), // clinic slug, when the user works at several clinics
});

/**
 * DEVELOPMENT ONLY: sign in as a seeded user without a password (used by the e2e tests).
 * 404 unless DEV_LOGIN_ENABLED=true; production refuses to start with it on (config.ts).
 * Goes through the normal SessionService, so it gets the same clinic, role and member checks as a real login.
 */
@ApiTags('auth')
@Controller('auth')
export class DevLoginController {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly repo: IdentityRepository,
    private readonly sessions: SessionService,
    private readonly cookie: SessionCookie,
  ) {}

  @Public()
  @Post('dev-login')
  async devLogin(@Body(new ZodBody(DevLogin)) body: z.infer<typeof DevLogin>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!this.cfg.DEV_LOGIN_ENABLED) throw Err.notFound('not_found', 'Not found');
    const user = await this.repo.findUserIdByEmail(body.email);
    if (!user) throw Err.notFound('user_not_found', 'No such user');
    return this.cookie.issue(res, await this.sessions.start(user.id, body.clinic, requestMeta(req)));
  }
}
