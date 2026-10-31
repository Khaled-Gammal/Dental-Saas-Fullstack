import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type Redis from 'ioredis';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
import { AppModule } from '../src/app.module';
import { WORKER_POLICY } from '../src/config';
import { REDIS } from '../src/shared/redis/tokens';
import { ProblemDetailsFilter } from '../src/shared/errors/problem-details.filter';

/**
 * Phase 1B (monitoring): GET /health/worker tells an uptime monitor whether the background worker is alive, from the
 * heartbeat the worker writes to Redis. The test writes the heartbeat itself (no worker process here) and puts back
 * whatever a locally running worker had written.
 */
describe('Worker health (e2e, Phase 1B)', () => {
  let app: INestApplication;
  let redis: Redis;
  let saved: string | null = null;
  const key = WORKER_POLICY.heartbeatKey;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    redis = app.get(REDIS);
    if (redis.status === 'wait') await redis.connect();
    saved = await redis.get(key);
  });

  afterAll(async () => {
    if (saved === null) await redis.del(key);
    else await redis.set(key, saved, 'EX', 24 * 3600);
    await app.close();
  });

  it('503 problem+json when the worker never reported', async () => {
    await redis.del(key);
    const res = await request(app.getHttpServer()).get('/health/worker').expect(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ code: 'worker_stale', lastBeatAt: null });
  });

  it('503 when the last heartbeat is older than the limit', async () => {
    await redis.set(key, String(Date.now() - WORKER_POLICY.heartbeatStaleMs - 60_000));
    const res = await request(app.getHttpServer()).get('/health/worker').expect(503);
    expect(res.body.code).toBe('worker_stale');
    expect(res.body.ageSeconds).toBeGreaterThan(WORKER_POLICY.heartbeatStaleMs / 1000);
  });

  it('200 with the time of the last heartbeat when it is recent; public, no token', async () => {
    const at = Date.now() - 5_000;
    await redis.set(key, String(at));
    const res = await request(app.getHttpServer()).get('/health/worker').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', ok: true, lastBeatAt: new Date(at).toISOString() });
  });

  it('a value the database cannot read is a 400 and an unreachable database a 503, not a 500 sent to Sentry', () => {
    const f = new ProblemDetailsFilter() as unknown as { toProblem(e: unknown): { status: number; code: string } };
    const err = (message: string, code: string) => Object.assign(new Error(message), { code });
    expect(f.toProblem(err('invalid input syntax for type uuid: "x"', '22P02'))).toMatchObject({ status: 400, code: 'invalid_input' });
    expect(f.toProblem(err('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED'))).toMatchObject({ status: 503, code: 'unhealthy' });
    expect(f.toProblem(err('terminating connection due to administrator command', '57P01'))).toMatchObject({ status: 503, code: 'unhealthy' });
    expect(f.toProblem(err('connection failure', '08006'))).toMatchObject({ status: 503 });
    expect(f.toProblem(new Error('boom'))).toMatchObject({ status: 500, code: 'internal' });
  });
});
