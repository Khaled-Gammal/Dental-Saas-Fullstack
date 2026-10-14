import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import type { Request } from 'express';
import type { RequestContext } from '../shared/context/request-context';
import { IS_PUBLIC } from './decorators';
import { TokenService, type AccessTokenPayload } from './token.service';

/** Global guard: every endpoint needs a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Missing access token');

    let payload: AccessTokenPayload;
    try {
      payload = await this.tokens.verifyAccess(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    this.cls.set('userId', payload.sub);
    this.cls.set('tenantId', payload.tid);
    this.cls.set('memberId', payload.mid);
    this.cls.set('permissions', payload.perms ?? []);
    return true;
  }
}
