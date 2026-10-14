import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AUTH_POLICY } from '../config';

/** Issuer stamped on every access token and required when verifying one. */
export const JWT_ISSUER = 'dental-saas';
export const JWT_ALGORITHM = 'HS256' as const;

export interface AccessTokenPayload {
  sub: string; // user id
  tid: string; // tenant (clinic) id
  mid: string; // tenant_members id
  perms: string[];
}

/** The only place access tokens are signed. Other modules depend on this, not on JwtService or the guard. */
@Injectable()
export class TokenService {
  readonly accessTtlSeconds = AUTH_POLICY.accessTtlSeconds;

  constructor(private readonly jwt: JwtService) {}

  signAccess(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, { expiresIn: this.accessTtlSeconds, issuer: JWT_ISSUER, algorithm: JWT_ALGORITHM });
  }

  verifyAccess(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, { algorithms: [JWT_ALGORITHM], issuer: JWT_ISSUER });
  }
}
