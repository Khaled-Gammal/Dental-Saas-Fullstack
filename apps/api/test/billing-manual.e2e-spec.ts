import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sql } from '@dental/db';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';
import type { DevEmailSender } from '../src/shared/notifications/dev-email.sender';
import { EMAIL_SENDER } from '../src/shared/notifications/ports';
import { queueRenewalReminders } from '../src/worker/renewal-reminders';
import { createTestAdmin, type TestAdmin } from './test-admin';

const CLINIC_B = '22222222-2222-2222-2222-222222222222';
const PASSWORD = 'Demo@12345';
const DAY = 86_400_000;

/**
 * Phase 2B (owner 2026-10-31): clinics pay outside the system and a platform admin records it. The payment renews the
 * subscription; a period that runs out makes the clinic past due, then (7 days later) suspended as unpaid; the clinic
 * sees its payments, the price and how to pay, and its owners are reminded.
 */
describe('Manual subscription payments (e2e, Phase 2B)', () => {
  let app: INestApplication;
  let mail: DevEmailSender;
  let adm: TestAdmin;
  let pt = '';
  let ownerB = '';
  let instructionsBefore: string | null = null;
  let sub: { id: string; status: string; billing_cycle: string | null; trial_ends_at: Date | null; current_period_start: Date | null; current_period_end: Date | null; grace_ends_at: Date | null };
  let tenant: { status: string; suspended_at: Date | null; suspension_reason: string | null; suspension_kind: string | null; status_before_suspension: string | null };
  const http = () => request(app.getHttpServer());
  const admin = () => ({ Cookie: pt.split(';')[0] });
  const pay = (body: object) => http().post(`/platform/clinics/${CLINIC_B}/payments`).set(admin()).send(body);
  const plan = async () => (await http().get('/clinic/plan').set({ Authorization: `Bearer ${ownerB}` }).expect(200)).body;
  const ref = () => `TX-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    mail = app.get(EMAIL_SENDER);
    adm = await createTestAdmin('billing', PASSWORD);
    // clinic B as another suite may have left it is put on a trial for this suite, then restored exactly
    sub = (await sql<typeof sub>`select id, status, billing_cycle, trial_ends_at, current_period_start, current_period_end, grace_ends_at from subscriptions
      where tenant_id = ${CLINIC_B} and status <> 'cancelled'`.execute(adm.db)).rows[0];
    tenant = (await sql<typeof tenant>`select status, suspended_at, suspension_reason, suspension_kind, status_before_suspension
      from tenants where id = ${CLINIC_B}`.execute(adm.db)).rows[0];
    await sql`update subscriptions set status = 'trialing', trial_ends_at = now() + interval '5 days', current_period_start = null, current_period_end = null,
              grace_ends_at = null where id = ${sub.id}`.execute(adm.db);
    await sql`update tenants set status = 'trialing', suspended_at = null, suspension_reason = null, suspension_kind = null,
              status_before_suspension = null where id = ${CLINIC_B}`.execute(adm.db);
    instructionsBefore = (await sql<{ text: string | null }>`select billing_instructions() as text`.execute(adm.db)).rows[0].text;
    await http().post('/platform/auth/login').send({ email: adm.email, password: PASSWORD }).expect(200);
    const code = /(\d{6})/.exec(mail.outbox.get(adm.email)?.text ?? '')?.[1] ?? '';
    const res = await http().post('/platform/auth/verify').send({ email: adm.email, code }).expect(200);
    pt = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('pt=')) ?? '';
    ownerB = (await http().post('/auth/dev-login').send({ email: 'owner.b@demo.test' }).expect(201)).body.accessToken;
  });

  afterAll(async () => {
    if (adm) {
      await http().put('/platform/billing-instructions').set(admin()).send({ text: instructionsBefore ?? '' });
      await sql`delete from notifications where tenant_id = ${CLINIC_B} and event = 'subscription.renewal'`.execute(adm.db);
      await sql`update subscriptions set status = ${sub.status}, billing_cycle = ${sub.billing_cycle}, trial_ends_at = ${sub.trial_ends_at},
                current_period_start = ${sub.current_period_start}, current_period_end = ${sub.current_period_end}, grace_ends_at = ${sub.grace_ends_at}
                where id = ${sub.id}`.execute(adm.db);
      await sql`update tenants set status = ${tenant.status}, suspended_at = ${tenant.suspended_at}, suspension_reason = ${tenant.suspension_reason},
                suspension_kind = ${tenant.suspension_kind}, status_before_suspension = ${tenant.status_before_suspension} where id = ${CLINIC_B}`.execute(adm.db);
      await adm.done();
    }
    await app.close();
  });

  it('the platform sets the payment instructions the clinics read', async () => {
    await http().put('/platform/billing-instructions').send({ text: 'x' }).expect(401);
    await http().put('/platform/billing-instructions').set(admin()).send({ text: 'x'.repeat(2001) }).expect(400);
    const set = (await http().put('/platform/billing-instructions').set(admin()).send({ text: '  InstaPay: dental@instapay\nفودافون كاش: 01000000000 ' }).expect(200)).body;
    expect(set.text).toBe('InstaPay: dental@instapay\nفودافون كاش: 01000000000');
    expect((await http().get('/platform/billing-instructions').set(admin()).expect(200)).body.text).toBe(set.text);
    expect((await plan()).paymentInstructions).toBe(set.text);
  });

  it('records a payment: the trial becomes a paid month, the invoice is listed, a repeated form records nothing more', async () => {
    const key = randomUUID();
    const reference = ref();
    expect((await pay({ amountMinor: 0, cycle: 'monthly', method: 'cash', idempotencyKey: key }).expect(400)).body.code).toBe('validation_failed');
    await pay({ amountMinor: 100, cycle: 'monthly', method: 'cheque', idempotencyKey: key }).expect(400);
    await pay({ amountMinor: 100, cycle: 'monthly', method: 'cash' }).expect(400); // the form's key is required
    await http().post(`/platform/clinics/${CLINIC_B}/payments`).send({ amountMinor: 100, cycle: 'monthly', method: 'cash', idempotencyKey: key }).expect(401);
    const c = (await pay({ amountMinor: 50000, cycle: 'monthly', method: 'instapay', reference, note: 'أول دفعة', idempotencyKey: key }).expect(200)).body;
    expect(c).toMatchObject({ status: 'active', subscription_status: 'active', billing_cycle: 'monthly', suspension_kind: null });
    expect(new Date(c.current_period_end).getTime()).toBeGreaterThan(Date.now() + 27 * DAY);
    expect(c.payments[0]).toMatchObject({ amount_minor: 50000, method: 'instapay', reference, note: 'أول دفعة', billing_cycle: 'monthly', recorded_by_name: 'Platform Admin' });
    expect(c.payments[0].number).toMatch(/^P\d{4}-\d{6}$/);
    expect(c.payments[0].period_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const again = (await pay({ amountMinor: 50000, cycle: 'monthly', method: 'instapay', reference, idempotencyKey: key }).expect(200)).body;
    expect(again.payments.length).toBe(c.payments.length);
    expect(again.current_period_end).toBe(c.current_period_end);
    expect((await pay({ amountMinor: 50000, cycle: 'monthly', method: 'instapay', reference: reference.toLowerCase(), idempotencyKey: randomUUID() }).expect(409)).body.code)
      .toBe('payment_reference_used');
    const history = c.history.map((h: { action: string }) => h.action);
    expect(history).toContain('tenant.payment_recorded');
  });

  it('the clinic sees its payments and what renewing costs', async () => {
    const p = await plan();
    expect(p).toMatchObject({ status: 'active', live: true, graceEndsAt: null });
    expect(p.price).toMatchObject({ monthlyMinor: expect.any(Number), yearlyMinor: expect.any(Number), currency: expect.any(String) });
    expect(p.payments[0]).toMatchObject({ amountMinor: 50000, method: 'instapay', billingCycle: 'monthly' });
    expect(Object.keys(p.payments[0])).not.toContain('note'); // the platform's note is the platform's
  });

  it('an early yearly renewal adds a year to the end of the paid month', async () => {
    const before = (await http().get(`/platform/clinics/${CLINIC_B}`).set(admin()).expect(200)).body.current_period_end;
    const c = (await pay({ amountMinor: 500000, cycle: 'yearly', method: 'bank_transfer', reference: ref(), idempotencyKey: randomUUID() }).expect(200)).body;
    const end = new Date(before);
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    expect(Math.abs(new Date(c.current_period_end).getTime() - end.getTime())).toBeLessThan(2 * 3_600_000); // a year (DST aside)
    expect(c.billing_cycle).toBe('yearly');
  });

  it('a period that runs out: past due (still working, reminded), then suspended as unpaid; paying brings it back', async () => {
    // ended long ago (a clinic activated before this phase): past due with its full grace from now, not suspended at once
    await sql`update subscriptions set current_period_end = now() - interval '40 days' where id = ${sub.id}`.execute(adm.db);
    await sql`select * from expire_subscriptions(7)`.execute(adm.db);
    const due = await plan();
    expect(due.status).toBe('past_due');
    expect(due.live).toBe(true);
    expect(new Date(due.graceEndsAt).getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    // the owner is told, once, with the instructions
    expect(await queueRenewalReminders(adm.db, Date.now(), CLINIC_B)).toBeGreaterThan(0);
    expect(await queueRenewalReminders(adm.db, Date.now(), CLINIC_B)).toBe(0);
    const { rows: mails } = await sql<{ recipient: string; subject: string; body: string }>`select recipient, subject, body from notifications
      where tenant_id = ${CLINIC_B} and event = 'subscription.renewal' and dedupe_key like '%:due@%'`.execute(adm.db);
    expect(mails.map((m) => m.recipient)).toContain('owner.b@demo.test');
    expect(mails[0].body).toContain('InstaPay: dental@instapay');

    // the grace (set by the worker when the period ran out) is over
    await sql`update subscriptions set grace_ends_at = now() - interval '1 minute' where id = ${sub.id}`.execute(adm.db);
    await sql`select * from expire_subscriptions(7)`.execute(adm.db);
    expect((await http().get('/clinic/plan').set({ Authorization: `Bearer ${ownerB}` }).expect(401)).body.code).toBe('clinic_suspended');
    const s = (await http().get(`/platform/clinics/${CLINIC_B}`).set(admin()).expect(200)).body;
    expect(s).toMatchObject({ status: 'suspended', suspension_kind: 'unpaid' });
    expect((await http().post(`/platform/clinics/${CLINIC_B}/reactivate`).set(admin()).expect(409)).body.code).toBe('subscription_unpaid');

    const back = (await pay({ amountMinor: 50000, cycle: 'monthly', method: 'vodafone_cash', idempotencyKey: randomUUID() }).expect(200)).body;
    expect(back).toMatchObject({ status: 'active', suspension_kind: null, subscription_status: 'active' });
    expect(new Date(back.current_period_end).getTime()).toBeGreaterThan(Date.now() + 27 * DAY); // from now, not from the old end
    ownerB = (await http().post('/auth/dev-login').send({ email: 'owner.b@demo.test' }).expect(201)).body.accessToken;
    expect((await plan()).status).toBe('active');
  });
});
