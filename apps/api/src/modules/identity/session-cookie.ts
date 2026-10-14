import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { APP_CONFIG, AUTH_POLICY, type AppConfig } from '../../config';
import type { RequestMeta, Session } from './identity.types';

const { name: COOKIE, path: COOKIE_PATH } = AUTH_POLICY.refreshCookie;

export const requestMeta = (req: Request): RequestMeta => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

/** The refresh token lives only in an httpOnly cookie scoped to /auth; JavaScript never sees it. */
@Injectable()
export class SessionCookie {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  private options(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.cfg.NODE_ENV === 'production',
      sameSite: 'lax',
      path: COOKIE_PATH,
      maxAge: AUTH_POLICY.refreshTtlDays * 24 * 60 * 60 * 1000,
    };
  }

  /** Sets the cookie and returns the session body without the refresh token. */
  issue(res: Response, s: Session): Omit<Session, 'refreshToken'> {
    res.cookie(COOKIE, s.refreshToken, this.options());
    const { refreshToken: _hidden, ...body } = s;
    return body;
  }

  clear(res: Response): void {
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
  }

  read(req: Request): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === COOKIE) {
        try {
          return decodeURIComponent(part.slice(i + 1).trim());
        } catch {
          return undefined; // malformed cookie: treat as signed out instead of a 500
        }
      }
    }
    return undefined;
  }
}
