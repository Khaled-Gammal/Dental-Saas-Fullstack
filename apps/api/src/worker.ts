import './threadpool';
import 'reflect-metadata';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { createDb, sql } from '@dental/db';
import { loadConfig, WORKER_POLICY } from './config';
import { DevEmailSender } from './shared/notifications/dev-email.sender';
import type { EmailSender } from './shared/notifications/ports';
import { SmtpEmailSender } from './shared/notifications/smtp-email.sender';
import { createObjectStorage } from './shared/storage/create-storage';
import { appointmentCreated, appointmentRescheduled } from './worker/appointment-notifications';
import { buildNextExport, expireExports, purgeDeletedClinics } from './worker/data-exports';
import { sendDueNotifications } from './worker/notification-sender';
import { relayOutbox } from './worker/outbox-relay';
import { purgeOrphanImages } from './worker/purge-orphan-images';

/**
 * Background worker (separate process). Connects as app_worker, which may work across clinics.
 * Jobs: outbox relay (booking emails and reminders), sending due notifications, releasing expired website slot
 * holds every minute, marking no-shows, suspending clinics whose trial ended (every 15 minutes), purging old auth data
 * and unused uploaded images nightly; H8: clinic data exports (their own queue, one at a time), expiring old exports
 * and erasing clinics whose 90 days after deletion are over (nightly). Next: site revalidation through the outbox.
 */
async function main() {
  const cfg = loadConfig();
  const db = createDb(cfg.DATABASE_WORKER_URL, { max: 5, applicationName: 'dental-worker' });
  const connection = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
  const log = (o: object) => console.log(JSON.stringify(o));
  // the same adapter the API uses; the worker has no Nest container, so it is built by hand
  // email is the only channel; outside production the same dev adapter as the API (works without Mailpit, keeps a copy)
  const email: EmailSender = cfg.NODE_ENV === 'production' ? new SmtpEmailSender(cfg) : new DevEmailSender(new SmtpEmailSender(cfg));
  const handlers = { 'appointment.created': appointmentCreated, 'appointment.rescheduled': appointmentRescheduled };
  const storage = await createObjectStorage(cfg);

  const queue = new Queue('maintenance', { connection });
  const every = (name: string, ms: number) => queue.upsertJobScheduler(name, { every: ms }, { name });
  await every('outbox-relay', WORKER_POLICY.outboxEveryMs);
  await every('send-notifications', WORKER_POLICY.notificationsEveryMs);
  await every('release-expired-holds', WORKER_POLICY.releaseHoldsEveryMs);
  await every('mark-no-shows', WORKER_POLICY.noShowEveryMs);
  await every('expire-trials', WORKER_POLICY.expireTrialsEveryMs);
  // 03:15 every night: delete expired codes, old sessions and auth events older than 180 days
  await queue.upsertJobScheduler('purge-auth-data', { pattern: WORKER_POLICY.purgeAuthCron, tz: WORKER_POLICY.timezone }, { name: 'purge-auth-data' });
  // 03:45 every night: uploaded images nothing uses, older than a day
  await queue.upsertJobScheduler('purge-orphan-images', { pattern: WORKER_POLICY.purgeImagesCron, tz: WORKER_POLICY.timezone }, { name: 'purge-orphan-images' });
  // H8: 04:00 exports past their days; 04:30 clinics whose 90 days after deletion are over
  await queue.upsertJobScheduler('expire-exports', { pattern: WORKER_POLICY.expireExportsCron, tz: WORKER_POLICY.timezone }, { name: 'expire-exports' });
  await queue.upsertJobScheduler('purge-clinics', { pattern: WORKER_POLICY.purgeClinicsCron, tz: WORKER_POLICY.timezone }, { name: 'purge-clinics' });
  // H8: a data export can take minutes: its own queue, so reminders and the rest never wait behind it
  const exportsQueue = new Queue('exports', { connection });
  await exportsQueue.upsertJobScheduler('build-exports', { every: WORKER_POLICY.buildExportsEveryMs }, { name: 'build-exports' });

  const worker = new Worker(
    'maintenance',
    async (job) => {
      switch (job.name) {
        case 'outbox-relay': {
          const relayed = await relayOutbox(db, handlers, log);
          if (relayed > 0) log({ job: job.name, relayed });
          return { relayed };
        }
        case 'send-notifications': {
          const sent = await sendDueNotifications(db, email, log);
          if (sent > 0) log({ job: job.name, sent });
          return { sent };
        }
        case 'release-expired-holds': {
          const { rows } = await sql<{ released: number }>`select release_all_expired_holds() as released`.execute(db);
          const released = rows[0]?.released ?? 0;
          if (released > 0) log({ job: job.name, released });
          return { released };
        }
        case 'mark-no-shows': {
          // SRS 4.10: pending/confirmed, never checked in, ended more than 2 h ago; their queued reminders are cancelled by the sender
          const { rows } = await sql<{ marked: number }>`select mark_no_shows() as marked`.execute(db);
          const marked = rows[0]?.marked ?? 0;
          if (marked > 0) log({ job: job.name, marked });
          return { marked };
        }
        case 'expire-trials': {
          // H5: trials that ended without activation; the clinic's staff are cut off at their next request
          const { rows } = await sql<{ suspended: number }>`select expire_trials() as suspended`.execute(db);
          const suspended = rows[0]?.suspended ?? 0;
          if (suspended > 0) log({ job: job.name, suspended });
          return { suspended };
        }
        case 'purge-auth-data': {
          const { rows } = await sql<{ otp_deleted: number; tokens_deleted: number; events_deleted: number }>`select * from purge_auth_data()`.execute(db);
          log({ job: job.name, ...rows[0] });
          return rows[0];
        }
        case 'purge-orphan-images': {
          const deleted = await purgeOrphanImages(db, storage, log);
          log({ job: job.name, deleted });
          return { deleted };
        }
        case 'expire-exports': {
          const expired = await expireExports(db, storage, log);
          if (expired > 0) log({ job: job.name, expired });
          return { expired };
        }
        case 'purge-clinics': {
          const purged = await purgeDeletedClinics(db, storage, log);
          if (purged > 0) log({ job: job.name, purged });
          return { purged };
        }
        default:
          throw new Error(`Unknown job ${job.name}`);
      }
    },
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => console.error(JSON.stringify({ job: job?.name, error: err.message })));
  // keep looping while there are queued exports, one at a time
  const exportsWorker = new Worker('exports', async () => {
    while (await buildNextExport(db, storage, email, cfg.DASHBOARD_URL, log)) { /* the next one */ }
  }, { connection, concurrency: 1 });
  exportsWorker.on('failed', (job, err) => console.error(JSON.stringify({ job: job?.name, error: err.message })));
  console.log(`Worker ready: outbox every ${WORKER_POLICY.outboxEveryMs / 1000}s, notifications every ${WORKER_POLICY.notificationsEveryMs / 1000}s, holds every ${WORKER_POLICY.releaseHoldsEveryMs / 1000}s`);

  const shutdown = async () => {
    await worker.close();
    await exportsWorker.close();
    await queue.close();
    await exportsQueue.close();
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
