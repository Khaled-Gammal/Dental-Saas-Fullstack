import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config';
import { REDIS } from './tokens';

export { REDIS };

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      // fail fast: a request must never hang because Redis is down (BullMQ uses its own connection in the worker)
      useFactory: (cfg: AppConfig) => new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
  }
}
