import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AUTH_POLICY, PLATFORM_POLICY } from '../config';

/** Issuer stamped on every access token and required when verifying one. */
export const JWT_ISSUER = 'dental-saas';
export const JWT_ALGORITHM = 'HS256' as const;

export interface AccessTokenPayload {
  sub: string; // user id
  tid: string; // tenant (clinic) id
  mid: string; // tenant_members id
  perms: string[];
  /** tenant_members.access_version when the token was signed; a role/status/branch change makes the token stale */
  av: number;
}

/** A platform admin's session (H5): no clinic; only the /platform routes accept it, and they re-check the admin each request. */
export interface PlatformTokenPayload { sub: string; typ: 'platform' }

/** The only place access tokens are signed. Other modules depend on this, not on JwtService or the guard. */
@Injectable()
export class TokenService {
  readonly accessTtlSeconds = AUTH_POLICY.accessTtlSeconds;

  constructor(private readonly jwt: JwtService) {}

  signAccess(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, { expiresIn: this.accessTtlSeconds, issuer: JWT_ISSUER, algorithm: JWT_ALGORITHM });
  }

  async verifyAccess(token: string): Promise<AccessTokenPayload> {
    const p = await this.jwt.verifyAsync<AccessTokenPayload & { typ?: string }>(token, { algorithms: [JWT_ALGORITHM], issuer: JWT_ISSUER });
    if (p.typ === 'platform' || !p.tid || !p.mid) throw new Error('not a clinic access token'); // a platform token opens no clinic
    return p;
  }

  signPlatform(userId: string): Promise<string> {
    const payload: PlatformTokenPayload = { sub: userId, typ: 'platform' };
    return this.jwt.signAsync(payload, { expiresIn: PLATFORM_POLICY.sessionSeconds, issuer: JWT_ISSUER, algorithm: JWT_ALGORITHM });
  }

  async verifyPlatform(token: string): Promise<PlatformTokenPayload> {
    const p = await this.jwt.verifyAsync<PlatformTokenPayload>(token, { algorithms: [JWT_ALGORITHM], issuer: JWT_ISSUER });
    if (p.typ !== 'platform' || !p.sub) throw new Error('not a platform token');
    return p;
  }
}
