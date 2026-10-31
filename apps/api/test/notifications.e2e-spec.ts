import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createDb, sql, type Db } from '@dental/db';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';
import type { OutboxEvent, OutboxHandler } from '../src/worker/outbox-relay';
import { appointmentCancelled, appointmentCreated } from '../src/worker/appointment-notifications';
import { paymentReceived } from '../src/worker/payment-notifications';
import { queueTrialReminders } from '../src/worker/trial-reminders';
import { workerUrl } from './test-admin';

const NASR = 'd0000000-0000-0000-0000-0000000000a1';
const MONA = 'f0000000-0000-0000-0000-0000000000a2';
const CONSULT = '90000000-0000-0000-0000-0000000000a1';
const OMAR = '70000000-0000-0000-0000-0000000000a1'; // seeded patient with an email (omar@example.test)
const CLINIC_B = '22222222-2222-2222-2222-222222222222';

function futureSaturday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7) + 7 * Math.floor(Math.random() * 7));
  return d.toISOString().slice(0, 10);
}
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

/**
 * Review R11 (NTF-03): the events the API writes in its own transaction and the emails the worker queues from them —
 * a cancellation, a payment receipt, the trial-ending warning. The worker's handlers run here directly, as the worker
 * role, on the events the API just wrote (no worker process in the tests).
 */
describe('Notification events (e2e, review R11)', () => {
  let app: INestApplication;
  let worker: Db;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const run = `${Date.now()}`.slice(-6);

  /** The event the API wrote for this entity (newest), run through the worker's handler. */
  async function handle(type: string, key: string, id: string, handler: OutboxHandler): Promise<void> {
    const { rows } = await sql<{ id: string; tenant_id: string; payload: Record<string, unknown>; attempts: number }>`
      select id, tenant_id, payload, attempts from outbox_events where type = ${type} and payload->>${key} = ${id} order by id desc limit 1`.execute(worker);
    expect(rows).toHaveLength(1);
    const event: OutboxEvent = { id: Number(rows[0].id), tenant_id: rows[0].tenant_id, type, payload: rows[0].payload, attempts: rows[0].attempts };
    await worker.transaction().execute((tx) => handler(tx, event));
  }
  const queued = async (dedupe: string) => (await sql<{ recipient: string; subject: string; body: string; status: string }>`
    select recipient, subject, body, status from notifications where dedupe_key = ${dedupe}`.execute(worker)).rows;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
    worker = createDb(workerUrl(), { max: 2, applicationName: 'dental-worker-test' });
  });
  afterAll(async () => {
    await worker.destroy();
    await app.close();
  });

  it('a cancellation by the clinic emails the patient once, and only after the cancel committed', async () => {
    const date = futureSaturday();
    const free = await http().get('/appointments/availability').query({ branchId: NASR, doctorId: MONA, serviceId: CONSULT, date }).set(as('receptionA')).expect(200);
    const booked = (await http().post('/appointments').set(as('receptionA'))
      .send({ patientId: OMAR, branchId: NASR, doctorId: MONA, serviceId: CONSULT, startsAt: pick(free.body.slots as string[]), source: 'phone' }).expect(201)).body;
    // the booking's own emails first: its confirmation and reminders are queued
    await handle('appointment.created', 'appointmentId', booked.id, appointmentCreated);
    const waiting = async () => Number((await sql<{ n: string }>`select count(*) as n from notifications
      where related_id = ${booked.id} and event <> 'appointment.cancelled' and status = 'queued'`.execute(worker)).rows[0].n);
    expect(await waiting()).toBeGreaterThan(0);
    await http().post(`/appointments/${booked.id}/cancel`).set(as('receptionA')).send({ reason: 'الطبيب معتذر' }).expect(200);
    await handle('appointment.cancelled', 'appointmentId', booked.id, appointmentCancelled);
    await handle('appointment.cancelled', 'appointmentId', booked.id, appointmentCancelled); // a retry adds nothing
    const rows = await queued(`cancelled:${booked.id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipient: 'omar@example.test', status: 'queued' });
    expect(rows[0].subject).toContain('تم إلغاء موعدك');
    expect(rows[0].body).not.toContain('الطبيب معتذر'); // the clinic's reason stays internal
    expect(await waiting()).toBe(0); // its confirmation and reminders no longer go out
  });

  it('cancelling a patient who already arrived (and left) emails nobody', async () => {
    const date = futureSaturday();
    const free = await http().get('/appointments/availability').query({ branchId: NASR, doctorId: MONA, serviceId: CONSULT, date }).set(as('receptionA')).expect(200);
    const booked = (await http().post('/appointments').set(as('receptionA'))
      .send({ patientId: OMAR, branchId: NASR, doctorId: MONA, serviceId: CONSULT, startsAt: pick(free.body.slots as string[]), source: 'walk_in' }).expect(201)).body;
    await http().post(`/appointments/${booked.id}/arrive`).set(as('receptionA')).send({}).expect(200);
    await http().post(`/appointments/${booked.id}/cancel`).set(as('receptionA')).send({ reason: 'patient left' }).expect(200);
    const { rows } = await sql<{ n: string }>`select count(*) as n from outbox_events
      where type = 'appointment.cancelled' and payload->>'appointmentId' = ${booked.id}`.execute(worker);
    expect(Number(rows[0].n)).toBe(0);
  });

  it('a payment queues one emailed receipt with the amount, the invoice number and what is left', async () => {
    const inv = (await http().post('/invoices').set(as('receptionA')).send({ patientId: OMAR, branchId: NASR, lines: [{ description: `خدمة ${run}`, unitPriceMinor: 20000 }] }).expect(201)).body;
    const issued = (await http().post(`/invoices/${inv.id}/issue`).set(as('receptionA')).expect(200)).body;
    const paid = (await http().post(`/invoices/${inv.id}/payments`).set(as('receptionA')).send({ amountMinor: 5000, method: 'cash', idempotencyKey: `n-${run}` }).expect(201)).body;
    const paymentId = paid.payments[0].id as string;
    await handle('payment.received', 'paymentId', paymentId, paymentReceived);
    await handle('payment.received', 'paymentId', paymentId, paymentReceived);
    const rows = await queued(`payment:${paymentId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient).toBe('omar@example.test');
    expect(rows[0].body).toContain('50 ج.م (نقدًا)');
    expect(rows[0].body).toContain(issued.number);
    expect(rows[0].body).toContain('المتبقي على الفاتورة');
    // tidy: the invoice back to nothing owed for the next run (reverse the payment, then void)
    await http().post(`/payments/${paymentId}/reverse`).set(as('receptionA')).send({ reason: 'e2e cleanup' }).expect(200);
    await http().post(`/invoices/${inv.id}/void`).set(as('ownerA')).send({ reason: 'e2e cleanup' }).expect(200);
  });

  it('a trial ending within three days warns its owners once; an activated clinic is not warned', async () => {
    // clinic B as another suite may have left it is put back on trial for this test, then restored exactly
    const { rows: [sub] } = await sql<{ id: string; status: string; trial_ends_at: Date | null }>`
      select id, status, trial_ends_at from subscriptions
      where tenant_id = ${CLINIC_B} and status <> 'cancelled'`.execute(worker);
    const { rows: [tenant] } = await sql<{ status: string; suspended_at: Date | null; suspension_reason: string | null; suspension_kind: string | null; status_before_suspension: string | null }>`
      select status, suspended_at, suspension_reason, suspension_kind, status_before_suspension from tenants where id = ${CLINIC_B}`.execute(worker);
    const ends = new Date(Date.now() + 2 * 86_400_000);
    const warnings = async () => (await sql<{ recipient: string; body: string }>`select recipient, body from notifications
      where tenant_id = ${CLINIC_B} and event = 'trial.ending' and related_id = ${sub.id}`.execute(worker)).rows;
    try {
      await sql`update subscriptions set status = 'trialing', trial_ends_at = ${ends} where id = ${sub.id}`.execute(worker);
      await sql`update tenants set status = 'trialing', suspended_at = null, suspension_reason = null, suspension_kind = null,
                status_before_suspension = null where id = ${CLINIC_B}`.execute(worker);
      expect(await queueTrialReminders(worker, 'https://landing.example.test', Date.now(), CLINIC_B)).toBeGreaterThan(0);
      expect(await queueTrialReminders(worker, 'https://landing.example.test', Date.now(), CLINIC_B)).toBe(0); // once
      const rows = await warnings();
      expect(rows.map((r) => r.recipient)).toContain('owner.b@demo.test');
      expect(rows[0].body).toContain('https://landing.example.test/#pricing');
      // activated (a new end, so it would otherwise be warned again): nothing
      await sql`update tenants set status = 'active' where id = ${CLINIC_B}`.execute(worker);
      await sql`update subscriptions set trial_ends_at = ${new Date(ends.getTime() + 3_600_000)} where id = ${sub.id}`.execute(worker);
      expect(await queueTrialReminders(worker, 'https://landing.example.test', Date.now(), CLINIC_B)).toBe(0);
    } finally {
      await sql`delete from notifications where tenant_id = ${CLINIC_B} and event = 'trial.ending' and related_id = ${sub.id}`.execute(worker);
      await sql`update subscriptions set status = ${sub.status}, trial_ends_at = ${sub.trial_ends_at} where id = ${sub.id}`.execute(worker);
      await sql`update tenants set status = ${tenant.status}, suspended_at = ${tenant.suspended_at}, suspension_reason = ${tenant.suspension_reason},
                suspension_kind = ${tenant.suspension_kind}, status_before_suspension = ${tenant.status_before_suspension} where id = ${CLINIC_B}`.execute(worker);
    }
  });
});
