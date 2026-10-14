/**
 * The one error type services throw. Carries the stable `code` the frontend switches on, the HTTP status,
 * and optional extra fields (e.g. `retryAfter`, `phone`). ProblemDetailsFilter turns it into RFC 9457 JSON,
 * so application code never depends on Nest's HTTP exception classes.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly extras: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

type Extras = Record<string, unknown>;
/** Short constructors so call sites read like the rule they enforce. */
export const Err = {
  badRequest: (code: string, message: string, extras?: Extras) => new AppError(code, 400, message, extras),
  unauthorized: (code: string, message: string, extras?: Extras) => new AppError(code, 401, message, extras),
  forbidden: (code: string, message: string, extras?: Extras) => new AppError(code, 403, message, extras),
  notFound: (code: string, message: string, extras?: Extras) => new AppError(code, 404, message, extras),
  conflict: (code: string, message: string, extras?: Extras) => new AppError(code, 409, message, extras),
  tooMany: (code: string, message: string, extras?: Extras) => new AppError(code, 429, message, extras),
};
