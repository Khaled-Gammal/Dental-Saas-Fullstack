import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import type { Request } from 'express';
import { sql } from '@dental/db';
import type { RequestContext } from '../shared/context/request-context';
import { TenantDb } from '../shared/database/tenant-db.service';
import { Err } from '../shared/errors/app-error';
import { clipUserAgent } from '../shared/request-meta';
import { ALLOW_LEGAL_PENDING, IS_PUBLIC } from './decorators';
import { TokenService, type AccessTokenPayload } from './token.service';

/** Global guard: every endpoint needs a valid access token of a still-active member unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly cls: ClsService<RequestContext>,
    private readonly db: TenantDb,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    // who is calling, for audit rows — public requests too (an online booking writes patient audit entries)
    if (req.ip) this.cls.set('ip', req.ip);
    const ua = clipUserAgent(req.headers['user-agent']);
    if (ua) this.cls.set('userAgent', ua);

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Missing access token');

    let payload: AccessTokenPayload;
    try {
      payload = await this.tokens.verifyAccess(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    // SRS ACCESS-005: a disabled member, or a role/branch change, takes effect on the next request, not at token expiry.
    // One primary-key lookup; on `access_changed` the dashboard refreshes and gets a token with the new rights.
    const { rows } = await sql<{ tenant_id: string; status: string; access_version: number; tenant_status: string }>`
      select * from member_access_state(${payload.mid}::uuid)`.execute(this.db.platform());
    const state = rows[0];
    if (!state || state.tenant_id !== payload.tid || state.status !== 'active') {
      throw Err.unauthorized('access_revoked', 'Your access to this clinic has ended');
    }
    // H5: a clinic the platform suspended is closed to its staff from their next request (the owner's choice)
    if (state.tenant_status === 'suspended') throw Err.unauthorized('clinic_suspended', 'This clinic is suspended; contact the platform');
    // H8: the owner deleted the clinic: closed at once, like a suspension
    if (state.tenant_status === 'cancelled') throw Err.unauthorized('clinic_deleted', 'This clinic was deleted; contact the platform to restore it');
    if (state.access_version !== payload.av) throw Err.unauthorized('access_changed', 'Your access changed; sign in again');
    this.cls.set('userId', payload.sub);
    this.cls.set('tenantId', payload.tid);
    this.cls.set('memberId', payload.mid);
    this.cls.set('permissions', payload.perms ?? []);
    // H6: documents to accept first (owner 2026-10-20: before using the system)
    if (payload.lp && !this.reflector.getAllAndOverride<boolean>(ALLOW_LEGAL_PENDING, [ctx.getHandler(), ctx.getClass()])) {
      throw Err.forbidden('legal_acceptance_required', 'Accept the updated legal documents to continue');
    }
    return true;
  }
}
