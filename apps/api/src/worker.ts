import './threadpool';
import 'reflect-metadata';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { createDb, sql } from '@dental/db';
import { loadConfig, WORKER_POLICY } from './config';

/**
 * Background worker (separate process). Connects as app_worker, which may work across clinics.
 * Jobs: release expired website slot holds every minute; purge old auth data nightly.
 * Next slices add: outbox relay (emails, SMS, site revalidation), reminders, no-show marking.
 */
async function main() {
  const cfg = loadConfig();
  const db = createDb(cfg.DATABASE_WORKER_URL, { max: 5, applicationName: 'dental-worker' });
  const connection = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });

  const queue = new Queue('maintenance', { connection });
  await queue.upsertJobScheduler('release-expired-holds', { every: WORKER_POLICY.releaseHoldsEveryMs }, { name: 'release-expired-holds' });
  // 03:15 every night: delete expired codes, old sessions and auth events older than 180 days
  await queue.upsertJobScheduler('purge-auth-data', { pattern: WORKER_POLICY.purgeAuthCron, tz: WORKER_POLICY.timezone }, { name: 'purge-auth-data' });

  const worker = new Worker(
    'maintenance',
    async (job) => {
      if (job.name === 'release-expired-holds') {
        const { rows } = await sql<{ released: number }>`select release_all_expired_holds() as released`.execute(db);
        const released = rows[0]?.released ?? 0;
        if (released > 0) console.log(JSON.stringify({ job: job.name, released }));
        return { released };
      }
      if (job.name === 'purge-auth-data') {
        const { rows } = await sql<{ otp_deleted: number; tokens_deleted: number; events_deleted: number }>`select * from purge_auth_data()`.execute(db);
        console.log(JSON.stringify({ job: job.name, ...rows[0] }));
        return rows[0];
      }
      throw new Error(`Unknown job ${job.name}`);
    },
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => console.error(JSON.stringify({ job: job?.name, error: err.message })));
  console.log(`Worker ready: maintenance queue (release-expired-holds every ${WORKER_POLICY.releaseHoldsEveryMs / 1000}s)`);

  const shutdown = async () => {
    await worker.close();
    await queue.close();
    connection.disconnect();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
