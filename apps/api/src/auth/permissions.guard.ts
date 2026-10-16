import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../shared/context/request-context';
import { PERMISSIONS } from './decorators';
import { hasPermission } from './permissions';

/** Runs after JwtAuthGuard. RLS already limits data to the clinic; this limits actions by role. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const needed = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, [ctx.getHandler(), ctx.getClass()]);
    if (!needed?.length) return true;
    const have = this.cls.get('permissions');
    if (needed.every((p) => hasPermission(have, p))) return true;
    throw new ForbiddenException({ message: `Missing permission: ${needed.join(', ')}`, code: 'missing_permission' });
  }
}
