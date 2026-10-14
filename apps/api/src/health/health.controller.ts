import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type Redis from 'ioredis';
import { sql } from '@dental/db';
import { Public } from '../auth/decorators';
import { TenantDb } from '../shared/database/tenant-db.service';
import { REDIS } from '../shared/redis/redis.module';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: TenantDb,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Real check: database and Redis must both answer. Used by Docker / load balancer. */
  @Public()
  @Get()
  async check() {
    const checks: Record<string, 'up' | 'down'> = { database: 'down', redis: 'down' };
    try {
      await sql`select 1`.execute(this.db.raw);
      checks.database = 'up';
    } catch { /* reported below */ }
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      checks.redis = (await this.redis.ping()) === 'PONG' ? 'up' : 'down';
    } catch { /* reported below */ }
    const ok = Object.values(checks).every((v) => v === 'up');
    if (!ok) throw new ServiceUnavailableException({ message: 'Dependency down', code: 'unhealthy', errors: checks });
    return { status: 'ok', checks };
  }
}
