import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createDb, sql, type Db } from '@dental/db';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';
import { fillManageLink, MANAGE_LINK_SLOT, manageToken, manageTokenHash } from '../src/shared/manage-link';
import type { OutboxEvent, OutboxHandler } from '../src/worker/outbox-relay';
import { appointmentCancelled, appointmentConfirmed, appointmentCreated, appointmentRescheduled } from '../src/worker/appointment-notifications';
import { workerUrl } from './test-admin';

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const HOST_A = 'clinic-a.lvh.me';
const HOST_B = 'clinic-b.lvh.me';
const NASR = 'd0000000-0000-0000-0000-0000000000a1';
const MONA = 'f0000000-0000-0000-0000-0000000000a2';
const CONSULT = '90000000-0000-0000-0000-0000000000a1';
const OMAR = '70000000-0000-0000-0000-0000000000a1'; // seeded patient with an email (omar@example.test)
const OMAR_PHONE = '+201011111111';

/** A Saturday 2 to 7 weeks ahead (Mona works Saturday evenings at Nasr City; inside the 60-day website horizon). */
function saturday(weeksAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7) + 7 * weeksAhead);
  return d.toISOString().slice(0, 10);
}
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
type View = { status: string; startsAt: string; cancel: { allowed: boolean; block: string | null }; reschedule: { allowed: boolean; block: string | null; left: number }; doctor: string | null; patientFirstName: string | null };

/**
 * Phase 2E: the patient's own link to their booking (from the confirmation and reminder emails) — see it, move it to
 * another free time with the same doctor (twice at most), or cancel it, up to the clinic's deadline; the clinic and the
 * patient are emailed about each change.
 */
describe('The patient\'s own booking link (e2e, Phase 2E)', () => {
  let app: INestApplication;
  let worker: Db;
  const token: Record<string, string> = {};
  const made: string[] = [];
  let clinicEmail: string | null = null;
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const link = (id: string) => manageToken(process.env.BOOKING_CODE_SECRET!, id);
  const post = (path: string, body: object) => http().post(`/public/appointment/${path}`).send(body);
  const view = async (t: string) => (await post('view', { host: HOST_A, token: t }).expect(200)).body as View;
  const settings = (patch: { booking_auto_confirm?: boolean; booking_cancel_window_hours?: number }) =>
    sql`update tenant_settings set booking_auto_confirm = coalesce(${patch.booking_auto_confirm ?? null}, booking_auto_confirm),
        booking_cancel_window_hours = coalesce(${patch.booking_cancel_window_hours ?? null}, booking_cancel_window_hours) where tenant_id = ${CLINIC_A}`.execute(worker);

  async function book(weeksAhead: number): Promise<string> {
    const date = saturday(weeksAhead);
    const free = await http().get('/appointments/availability').query({ branchId: NASR, doctorId: MONA, serviceId: CONSULT, date }).set(as('receptionA')).expect(200);
    const id = (await http().post('/appointments').set(as('receptionA'))
      .send({ patientId: OMAR, branchId: NASR, doctorId: MONA, serviceId: CONSULT, startsAt: pick(free.body.slots as string[]), source: 'phone' }).expect(201)).body.id as string;
    made.push(id);
    return id;
  }
  /** The newest event of this type for the appointment, run through the worker's handler (as the worker would). */
  async function handle(type: string, id: string, handler: OutboxHandler): Promise<OutboxEvent> {
    const { rows } = await sql<{ id: string; tenant_id: string; payload: Record<string, unknown>; attempts: number }>`
      select id, tenant_id, payload, attempts from outbox_events where type = ${type} and payload->>'appointmentId' = ${id} order by id desc limit 1`.execute(worker);
    expect(rows).toHaveLength(1);
    const event: OutboxEvent = { id: Number(rows[0].id), tenant_id: rows[0].tenant_id, type, payload: rows[0].payload, attempts: rows[0].attempts };
    await worker.transaction().execute((tx) => handler(tx, event));
    return event;
  }
  const queued = async (dedupe: string) => (await sql<{ recipient: string; body: string }>`select recipient, body from notifications where dedupe_key = ${dedupe}`.execute(worker)).rows;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    worker = createDb(workerUrl(), { max: 2, applicationName: 'dental-worker-test' });
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
    // the clinic is emailed about the patient's own changes only when it has an address; the seed gives it none
    clinicEmail = (await http().get('/clinic/profile').set(as('ownerA')).expect(200)).body.email ?? null;
    await http().patch('/clinic/profile').set(as('ownerA')).send({ email: 'clinic.a@demo.test' }).expect(200);
  });
  afterAll(async () => {
    await http().patch('/clinic/profile').set(as('ownerA')).send({ email: clinicEmail });
    await settings({ booking_auto_confirm: true, booking_cancel_window_hours: 12 });
    for (const id of made) await http().post(`/appointments/${id}/cancel`).set(as('receptionA')).send({});
    await worker.destroy();
    await app.close();
  });

  it('every booking gets its link; only its hash is stored, and the queued email holds a placeholder the sender fills', async () => {
    const id = await book(2);
    const { rows } = await sql<{ h: string }>`select manage_token_hash as h from appointments where id = ${id}`.execute(worker);
    expect(rows[0].h).toBe(manageTokenHash(link(id)));
    await handle('appointment.created', id, appointmentCreated);
    const [mail] = await queued(`booking:${id}:patient:email`);
    expect(mail.body).toContain(MANAGE_LINK_SLOT);
    expect(mail.body).not.toContain(link(id)); // never a working link in the notifications table (or a data export)
    expect(fillManageLink(mail.body, `http://${HOST_A}/appointment/${link(id)}`)).toContain(`/appointment/${link(id)}`);
  });

  it('the page: the booking, what may be done, nothing private; a wrong link or another clinic\'s site finds nothing', async () => {
    const id = await book(3);
    const res = await post('view', { host: HOST_A, token: link(id) }).expect(200);
    expect(res.body).toMatchObject({ status: 'confirmed', cancel: { allowed: true }, reschedule: { allowed: true, left: 2 }, patientFirstName: expect.any(String) });
    expect(res.body.doctor).toContain('منى');
    expect(JSON.stringify(res.body)).not.toContain(OMAR_PHONE); // no phone, file number or clinic notes
    expect((await post('view', { host: HOST_A, token: 'a'.repeat(43) }).expect(404)).body.code).toBe('manage_link_invalid');
    expect((await post('view', { host: HOST_A, token: 'short' }).expect(404)).body.code).toBe('manage_link_invalid');
    await post('view', { host: HOST_B, token: link(id) }).expect(404);
  });

  it('moving: a free time with the same doctor; twice at most; a clinic confirming by hand confirms the new time', async () => {
    await settings({ booking_auto_confirm: false });
    try {
      const id = await book(4);
      const t = link(id);
      const date = saturday(5);
      // not a time the website offers
      expect((await post('reschedule', { host: HOST_A, token: t, startsAt: `${date}T03:07:00.000Z` }).expect(409)).body.code).toBe('slot_unavailable');
      const free = (await post('slots', { host: HOST_A, token: t, date }).expect(200)).body.slots as { startsAt: string }[];
      expect(free.length).toBeGreaterThan(0);
      const moved = (await post('reschedule', { host: HOST_A, token: t, startsAt: free[0].startsAt }).expect(200)).body as View;
      expect(moved).toMatchObject({ startsAt: free[0].startsAt, status: 'pending', reschedule: { left: 1 } });
      const db = (await sql<{ n: number; confirmed_at: Date | null; room_id: string | null }>`select patient_reschedules as n, confirmed_at, room_id from appointments where id = ${id}`.execute(worker)).rows[0];
      expect(db).toMatchObject({ n: 1, confirmed_at: null });
      // the patient is told (with the link again), and so is the clinic
      const ev = await handle('appointment.rescheduled', id, appointmentRescheduled);
      expect(ev.payload.by).toBe('patient');
      const [toPatient] = await queued(`moved:${id}:m${ev.id}`);
      expect(toPatient.body).toContain(MANAGE_LINK_SLOT);
      expect(toPatient.body).toContain('سنؤكد');
      const [toClinic] = await queued(`moved:${id}:m${ev.id}:clinic`);
      expect(toClinic.body).toContain(OMAR_PHONE);
      // the dashboard shows it was the patient
      const seen = (await http().get(`/appointments/${id}`).set(as('receptionA')).expect(200)).body;
      expect(seen.patient_reschedules).toBe(1);
      // the clinic confirms the new time: the patient is told, even if an earlier confirmation was already sent
      await http().post(`/appointments/${id}/confirm`).set(as('receptionA')).expect(200);
      const conf = await handle('appointment.confirmed', id, appointmentConfirmed);
      expect(await queued(`confirmed:${id}:c${conf.id}`)).toHaveLength(1);

      const again = (await post('slots', { host: HOST_A, token: t, date: saturday(6) }).expect(200)).body.slots as { startsAt: string }[];
      await post('reschedule', { host: HOST_A, token: t, startsAt: again[0].startsAt }).expect(200);
      const free3 = (await post('slots', { host: HOST_A, token: t, date: saturday(4) }).expect(409)).body;
      expect(free3.code).toBe('reschedule_limit');
      const v = await view(t);
      expect(v).toMatchObject({ reschedule: { allowed: false, block: 'limit', left: 0 }, cancel: { allowed: true } });
    } finally {
      await settings({ booking_auto_confirm: true });
    }
  });

  it('too close to the visit: no change from the link (the clinic\'s window)', async () => {
    const id = await book(2);
    await settings({ booking_cancel_window_hours: 24 * 400 });
    try {
      expect((await view(link(id))).cancel).toEqual({ allowed: false, block: 'too_late' });
      expect((await post('cancel', { host: HOST_A, token: link(id) }).expect(409)).body.code).toBe('too_late_to_change');
    } finally {
      await settings({ booking_cancel_window_hours: 12 });
    }
  });

  it('cancelling: once, as the patient; the clinic is told and the time is free again', async () => {
    const id = await book(3);
    const startsAt = (await view(link(id))).startsAt;
    const after = (await post('cancel', { host: HOST_A, token: link(id) }).expect(200)).body as View;
    expect(after).toMatchObject({ status: 'cancelled', cancel: { allowed: false, block: 'not_active' } });
    const db = (await sql<{ by: string; actor: string }>`
      select a.cancelled_by as by, (select l.actor_type from audit_log l where l.entity_id = a.id order by l.id desc limit 1) as actor
        from appointments a where a.id = ${id}`.execute(worker)).rows[0];
    expect(db).toEqual({ by: 'patient', actor: 'patient' }); // the activity log names the patient
    await handle('appointment.cancelled', id, appointmentCancelled);
    expect((await queued(`cancelled:${id}`))[0].body).toContain('بناءً على طلبك');
    expect((await queued(`cancelled:${id}:clinic`))[0].body).toContain(OMAR_PHONE);
    expect((await post('cancel', { host: HOST_A, token: link(id) }).expect(409)).body.code).toBe('appointment_not_active');
    // the slot is offered again
    const date = startsAt.slice(0, 10);
    const free = await http().get('/appointments/availability').query({ branchId: NASR, doctorId: MONA, serviceId: CONSULT, date }).set(as('receptionA')).expect(200);
    expect((free.body.slots as string[]).map((s) => new Date(s).toISOString())).toContain(new Date(startsAt).toISOString());
  });
});
