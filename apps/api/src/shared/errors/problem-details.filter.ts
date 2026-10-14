import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from './app-error';

/** RFC 9457 problem+json body. `code` is stable for the frontend; `detail` is human-readable. */
interface Problem {
  [extra: string]: unknown;
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  errors?: unknown;
}

/** PostgreSQL error codes our rules raise, mapped to HTTP. */
const PG: Record<string, { status: number; code: string; title: string }> = {
  '23P01': { status: 409, code: 'slot_taken', title: 'This time is already booked' },
  '23505': { status: 409, code: 'conflict', title: 'Already exists' },
  '23514': { status: 422, code: 'rule_violation', title: 'Not allowed by the business rules' },
  '23503': { status: 422, code: 'invalid_reference', title: 'Refers to something that does not exist' },
  '23502': { status: 422, code: 'missing_field', title: 'A required field is missing' },
  '42501': { status: 403, code: 'forbidden', title: 'Not allowed' },
  P0002: { status: 404, code: 'not_found', title: 'Not found' },
  '55P03': { status: 409, code: 'busy', title: 'Another user is changing this right now, try again' },
};

const RESERVED = new Set(['message', 'code', 'errors', 'statusCode', 'error', 'type', 'title', 'status', 'detail', 'instance']);
function extras(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([k]) => !RESERVED.has(k)));
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const problem = this.toProblem(exception);
    problem.instance = req.originalUrl;
    if (typeof problem.retryAfter === 'number') res.setHeader('Retry-After', String(problem.retryAfter)); // 429s
    if (problem.status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(e: unknown): Problem {
    if (e instanceof AppError) {
      return {
        type: 'about:blank',
        title: HttpStatus[e.status]?.replace(/_/g, ' ').toLowerCase() ?? 'error',
        status: e.status,
        code: e.code,
        detail: e.message,
        ...extras(e.extras), // e.g. retryAfter, or the phone to verify on phone_not_verified
      };
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const body = e.getResponse() as string | { message?: unknown; code?: string; errors?: unknown };
      const message = typeof body === 'string' ? body : body.message;
      return {
        type: 'about:blank',
        title: HttpStatus[status]?.replace(/_/g, ' ').toLowerCase() ?? 'error',
        status,
        code: (typeof body === 'object' && body.code) || HttpStatus[status]?.toLowerCase() || 'error',
        detail: Array.isArray(message) ? message.join('; ') : (message as string | undefined),
        errors: typeof body === 'object' ? body.errors : undefined,
        // extra fields a use case attaches (e.g. phone_not_verified carries the phone to verify)
        ...(typeof body === 'object' ? extras(body as Record<string, unknown>) : {}),
      };
    }
    const pgCode = (e as { code?: string })?.code;
    if (pgCode && PG[pgCode]) {
      const m = PG[pgCode];
      // the database message names tables and constraints: log it, never send it
      this.logger.warn(`${pgCode} ${(e as Error).message}`);
      return { type: 'about:blank', title: m.title, status: m.status, code: m.code, detail: m.title };
    }
    return { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal' };
  }
}
