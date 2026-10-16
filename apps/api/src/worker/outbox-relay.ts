import { sql, type Db, type Tx } from '@dental/db';

export interface OutboxEvent { id: number; tenant_id: string | null; type: string; payload: Record<string, unknown>; attempts: number }
export type OutboxHandler = (tx: Tx, event: OutboxEvent) => Promise<void>;

/** After this many failures an event is dead: never retried, reported on every pass until someone handles it. */
export const MAX_ATTEMPTS = 10;
const BATCH = 50;

/**
 * Transactional outbox relay (SRS 8.3): events were written in the same transaction as the change they describe;
 * this takes pending ones in order, runs the handler for their type and marks them processed. Rows are locked with
 * SKIP LOCKED so several worker processes never handle the same event; a handler failure counts an attempt.
 * Dead events (attempts exhausted) are logged at `error` when they die and counted on every pass, so a broken
 * handler is visible instead of silently dropping a clinic's notifications.
 */
export async function relayOutbox(db: Db, handlers: Record<string, OutboxHandler>, log: (o: object) => void): Promise<number> {
  const events = await db.selectFrom('outbox_events').select(['id', 'tenant_id', 'type', 'payload', 'attempts'])
    .where('processed_at', 'is', null).where('attempts', '<', MAX_ATTEMPTS).orderBy('id').limit(BATCH).execute();
  let done = 0;
  for (const e of events) {
    const event: OutboxEvent = { ...e, id: Number(e.id), payload: (e.payload ?? {}) as Record<string, unknown> };
    const handler = handlers[event.type];
    try {
      await db.transaction().execute(async (tx) => {
        // re-check under lock: another worker may have taken it since the select
        const locked = await tx.selectFrom('outbox_events').select('id').where('id', '=', e.id).where('processed_at', 'is', null).forUpdate().skipLocked().executeTakeFirst();
        if (!locked) return;
        if (handler) await handler(tx, event);
        else log({ outbox: event.id, type: event.type, warn: 'no handler; marked processed' });
        await tx.updateTable('outbox_events').set({ processed_at: sql<Date>`now()` }).where('id', '=', e.id).execute();
        done++;
      });
    } catch (err) {
      const attempt = event.attempts + 1;
      await db.updateTable('outbox_events').set({ attempts: sql<number>`attempts + 1` }).where('id', '=', e.id).execute();
      log({ level: attempt >= MAX_ATTEMPTS ? 'error' : 'warn', outbox: event.id, type: event.type, tenant: event.tenant_id, attempt,
        ...(attempt >= MAX_ATTEMPTS && { dead: true }), error: (err as Error).message });
    }
  }
  const { n } = await db.selectFrom('outbox_events').select((eb) => eb.fn.countAll<string>().as('n'))
    .where('processed_at', 'is', null).where('attempts', '>=', MAX_ATTEMPTS).executeTakeFirstOrThrow();
  if (Number(n) > 0) log({ level: 'error', outbox_dead: Number(n), hint: 'events that exhausted their retries; fix the handler, then reset attempts to 0' });
  return done;
}
