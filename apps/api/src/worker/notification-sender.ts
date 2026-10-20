import { sql, type Db } from '@dental/db';
import type { EmailSender } from '../shared/notifications/ports';

const BATCH = 20;
const MAX_ATTEMPTS = 5;
/** A claimed row is invisible to other passes for this long; if the worker dies mid-send it is retried after it. */
const LEASE_MINUTES = 10;

/**
 * Sends queued notifications whose time has come (NTF-04), email only. Each row is first *claimed* in a short
 * transaction (attempts + 1 and a lease on scheduled_at, SKIP LOCKED so parallel workers never share a row), then
 * sent with no transaction or lock held — a slow mail server cannot pin a database connection — and finally marked
 * sent. Delivery is at-least-once: a crash between the send and the final update sends again after the lease.
 * Reminders for appointments that are no longer pending/confirmed are cancelled instead of sent, and so is anything a
 * suspended clinic would send (H5, owner 2026-10-20) — cancelled, not held back, so a reactivated clinic gets no stale mail.
 */
export async function sendDueNotifications(db: Db, email: EmailSender, log: (o: object) => void): Promise<number> {
  const claimed = await db.transaction().execute(async (tx) => {
    const { rows } = await sql<{ id: string; channel: string; recipient: string; subject: string | null; body: string; attempts: number; event: string; related_id: string | null; appointment_status: string | null; tenant_status: string | null }>`
      with due as (
        select id from notifications
        where status = 'queued' and scheduled_at <= now() and attempts < ${MAX_ATTEMPTS}
        order by scheduled_at limit ${BATCH}
        for update skip locked)
      update notifications n set attempts = n.attempts + 1, scheduled_at = now() + make_interval(mins => ${LEASE_MINUTES})
      from due where n.id = due.id
      returning n.id, n.channel, n.recipient, n.subject, n.body, n.attempts, n.event, n.related_id,
        (select a.status from appointments a where a.id = n.related_id) as appointment_status,
        (select t.status from tenants t where t.id = n.tenant_id) as tenant_status`.execute(tx);
    return rows;
  });

  let sent = 0;
  for (const n of claimed) {
    const cancel = (why: string) => db.updateTable('notifications').set({ status: 'cancelled', last_error: why }).where('id', '=', n.id).execute();
    if (n.channel !== 'email') { await cancel('channel disabled: email only'); continue; }
    if (n.tenant_status === 'suspended') { await cancel('clinic suspended'); continue; }
    if (n.event === 'appointment.reminder' && !['pending', 'confirmed'].includes(n.appointment_status ?? '')) { await cancel(`appointment ${n.appointment_status ?? 'missing'}`); continue; }
    try {
      await email.send(n.recipient, n.subject ?? '', n.body);
    } catch (err) {
      const failed = n.attempts >= MAX_ATTEMPTS;
      await db.updateTable('notifications').set({
        last_error: (err as Error).message.slice(0, 500), status: failed ? 'failed' : 'queued',
        ...(failed ? {} : { scheduled_at: sql<Date>`now() + make_interval(mins => ${2 ** n.attempts})` }),
      }).where('id', '=', n.id).execute();
      log({ level: failed ? 'error' : 'warn', notification: n.id, attempt: n.attempts, failed, error: (err as Error).message });
      continue;
    }
    await db.updateTable('notifications').set({ status: 'sent', sent_at: sql<Date>`now()`, provider: 'smtp', last_error: null }).where('id', '=', n.id).execute();
    sent++;
  }
  return sent;
}
