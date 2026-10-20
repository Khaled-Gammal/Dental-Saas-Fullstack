import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { CookieOptions, Request, Response } from 'express';
import { APP_CONFIG, PLATFORM_POLICY, type AppConfig } from '../../config';
import { TokenService } from '../../auth/token.service';
import type { RequestContext } from '../../shared/context/request-context';
import { Err } from '../../shared/errors/app-error';
import { PlatformRepository } from './platform.repository';

const { name: COOKIE, path: PATH } = PLATFORM_POLICY.cookie;

/** The platform session cookie: httpOnly, SameSite=Strict, scoped to /platform; JavaScript never sees the token. */
@Injectable()
export class PlatformCookie {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  private options(): CookieOptions {
    return { httpOnly: true, secure: this.cfg.NODE_ENV === 'production', sameSite: 'strict', path: PATH, maxAge: PLATFORM_POLICY.sessionSeconds * 1000 };
  }

  issue(res: Response, token: string): void { res.cookie(COOKIE, token, this.options()); }
  clear(res: Response): void { res.clearCookie(COOKIE, { path: PATH }); }

  read(req: Request): string | undefined {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === COOKIE) {
        try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return undefined; }
      }
    }
    return undefined;
  }
}

/**
 * Guards the platform panel's routes (they are @Public() for the clinic guard): a valid platform token in the cookie,
 * and — on every request — a user who is still an active platform admin. Clinic tokens are never accepted here.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly cookie: PlatformCookie,
    private readonly tokens: TokenService,
    private readonly repo: PlatformRepository,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const token = this.cookie.read(ctx.switchToHttp().getRequest<Request>());
    if (!token) throw Err.unauthorized('platform_session_required', 'Sign in to the platform panel');
    let sub: string;
    try {
      sub = (await this.tokens.verifyPlatform(token)).sub;
    } catch {
      throw Err.unauthorized('platform_session_required', 'Sign in to the platform panel');
    }
    if (!(await this.repo.isAdmin(sub))) throw Err.unauthorized('platform_session_required', 'Sign in to the platform panel');
    this.cls.set('platformUserId', sub);
    return true;
  }
}
