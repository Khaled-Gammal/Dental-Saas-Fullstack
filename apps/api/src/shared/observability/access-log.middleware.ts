import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { RequestContext } from '../context/request-context';

const QUIET = new Set(['/health']);

/**
 * One structured line per request (method, route, status, duration, tenant, user, request id), written when the
 * response finishes, so guard rejections and filter-rendered errors are logged exactly like successes.
 * The `X-Request-Id` header lets a user's report be matched to its log line.
 */
@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('http');
  constructor(private readonly cls: ClsService<RequestContext>) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const started = process.hrtime.bigint();
    const requestId = this.cls.isActive() ? this.cls.getId() : randomUUID();
    const store = this.cls.isActive() ? this.cls.get() : undefined; // same object the auth guard fills in later (tenantId, userId)
    res.setHeader('X-Request-Id', requestId);
    // `close` fires for aborted requests too (no `finish` then): the slow ones are the ones worth seeing
    res.once('close', () => {
      if (QUIET.has(req.path)) return;
      const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
      const path = (req.route as { path?: string } | undefined)?.path ?? '<unmatched>'; // the route pattern: no ids, no scanner noise
      this.logger.log({ req: requestId, method: req.method, path, status: res.statusCode, ms, aborted: !res.writableFinished || undefined, tenant: store?.tenantId, user: store?.userId });
    });
    next();
  }
}
