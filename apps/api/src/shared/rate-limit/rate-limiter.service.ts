import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config';
import { Err } from '../errors/app-error';
import { REDIS } from '../redis/tokens';
import type { RateLimiter } from './ports';

// INCR + set the window on first hit, atomically. Returns [count, secondsLeft].
const HIT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return { n, redis.call('TTL', KEYS[1]) }`;

/**
 * Redis adapter for the RateLimiter port. Fixed-window counters, atomic, so 200 parallel requests
 * cannot all slip past a "count then insert" check the way they can with SELECT count(*).
 */
@Injectable()
export class RedisRateLimiter implements RateLimiter {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async hit(key: string, windowSeconds: number): Promise<{ count: number; retryAfter: number }> {
    const [count, ttl] = (await this.redis.eval(HIT, 1, `rl:${key}`, windowSeconds)) as [number, number];
    return { count, retryAfter: Math.max(ttl, 1) };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`rl:${key}`);
  }

  async throttle(key: string, limit: number, windowSeconds: number): Promise<void> {
    if (!this.cfg.RATE_LIMIT_ENABLED) return;
    await this.enforce(key, limit, windowSeconds, 'Too many requests. Please wait and try again.', 'rate_limited');
  }

  async enforce(key: string, limit: number, windowSeconds: number, message: string, code: string): Promise<void> {
    const { count, retryAfter } = await this.hit(key, windowSeconds);
    if (count > limit) throw Err.tooMany(code, message, { retryAfter });
  }
}
