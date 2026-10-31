import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type Redis from 'ioredis';
import { sql } from '@dental/db';
import { Public } from '../auth/decorators';
import { TenantDb } from '../shared/database/tenant-db.service';
import { REDIS } from '../shared/redis/redis.module';
import { HEARTBEAT_KEY, heartbeatStatus } from '../shared/observability/heartbeat';

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
      await sql`select 1`.execute(this.db.platform());
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

  /**
   * Phase 1B: is the background worker alive? It writes a heartbeat to Redis after each job that completes (the outbox
   * relay runs every 5 s). 503 when the heartbeat is missing or older than 10 minutes: reminders, receipts and exports
   * have stopped, or every job is failing.
   * For the uptime monitor, next to GET /health. Says nothing about any clinic.
   */
  @Public()
  @Get('worker')
  async worker() {
    let raw: string | null;
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      raw = await this.redis.get(HEARTBEAT_KEY);
    } catch {
      throw new ServiceUnavailableException({ message: 'Redis down', code: 'unhealthy', errors: { redis: 'down' } });
    }
    const beat = heartbeatStatus(raw);
    if (!beat.ok) throw new ServiceUnavailableException({ message: 'The worker has not reported recently', code: 'worker_stale', ...beat });
    return { status: 'ok', ...beat };
  }
}
