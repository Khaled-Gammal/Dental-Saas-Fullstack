import 'reflect-metadata';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { createDb, sql } from '@dental/db';
import { loadConfig } from './config';

/**
 * Background worker (separate process). Connects as app_worker, which may work across clinics.
 * Sprint 0 job: release expired website slot holds every minute.
 * Next slices add: outbox relay (emails, SMS, site revalidation), reminders, no-show marking.
 */
async function main() {
  const cfg = loadConfig();
  const db = createDb(cfg.DATABASE_WORKER_URL, { max: 5, applicationName: 'dental-worker' });
  const connection = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });

  const queue = new Queue('maintenance', { connection });
  await queue.upsertJobScheduler('release-expired-holds', { every: 60_000 }, { name: 'release-expired-holds' });

  const worker = new Worker(
    'maintenance',
    async (job) => {
      if (job.name === 'release-expired-holds') {
        const { rows } = await sql<{ released: number }>`select release_all_expired_holds() as released`.execute(db);
        const released = rows[0]?.released ?? 0;
        if (released > 0) console.log(JSON.stringify({ job: job.name, released }));
        return { released };
      }
      throw new Error(`Unknown job ${job.name}`);
    },
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => console.error(JSON.stringify({ job: job?.name, error: err.message })));
  console.log('Worker ready: maintenance queue (release-expired-holds every 60s)');

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
