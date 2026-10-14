import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true }),
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
