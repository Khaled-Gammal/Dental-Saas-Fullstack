/** Port: business code depends on this interface, never on Redis. */
export interface RateLimiter {
  /** Counts one hit in a fixed window; returns the count so far and seconds until the window resets. */
  hit(key: string, windowSeconds: number): Promise<{ count: number; retryAfter: number }>;
  reset(key: string): Promise<void>;
  /** Abuse throttle (per IP etc.): 429 `rate_limited` over the limit. Off when RATE_LIMIT_ENABLED=false (tests only). */
  throttle(key: string, limit: number, windowSeconds: number): Promise<void>;
  /** Security limit that is always on (login lockout): 429 with the given code. */
  enforce(key: string, limit: number, windowSeconds: number, message: string, code: string): Promise<void>;
}
export const RATE_LIMITER = Symbol('RATE_LIMITER');
