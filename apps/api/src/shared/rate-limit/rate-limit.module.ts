import { Global, Module } from '@nestjs/common';
import { RATE_LIMITER } from './ports';
import { RedisRateLimiter } from './rate-limiter.service';

/** Provides the RATE_LIMITER port (Redis adapter). Needs RedisModule for the connection. */
@Global()
@Module({
  providers: [{ provide: RATE_LIMITER, useClass: RedisRateLimiter }],
  exports: [RATE_LIMITER],
})
export class RateLimitModule {}
