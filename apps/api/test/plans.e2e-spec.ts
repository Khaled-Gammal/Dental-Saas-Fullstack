import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createDb, sql, type Db } from '@dental/db';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';
import { workerUrl } from './test-admin';

const CLINIC_A = '11111111-1111-1111-1111-111111111111'; // seeded on Pro (remove_badge)
const CLINIC_B = '22222222-2222-2222-2222-222222222222'; // seeded on Basic

/**
 * Phase 1D (BIL-01, WEB-10): the plan summary the dashboard shows, and the "powered by" badge, which a clinic may hide
 * only on a plan that includes `remove_badge` — and which comes back by itself on a plan that does not.
 */
describe('Plans: summary and the website badge (e2e, Phase 1D)', () => {
  let app: INestApplication;
  let worker: Db;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const saved: Record<string, boolean> = {};
  let subB: { id: string; plan_id: string; status: string; trial_ends_at: Date | null };
  let tenantB: { status: string; suspended_at: Date | null; suspension_reason: string | null; suspension_kind: string | null; status_before_suspension: string | null };
  const badge = async (host: string) => (await http().get('/public/site').query({ host }).expect(200)).body.showPoweredBy as boolean;
  const column = async (tenant: string) =>
    (await sql<{ show: boolean }>`select show_powered_by as show from sites where tenant_id = ${tenant}`.execute(worker)).rows[0].show;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    worker = createDb(workerUrl(), { max: 2, applicationName: 'dental-worker-test' });
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
    saved.a = await column(CLINIC_A);
    saved.b = await column(CLINIC_B);
    // clinic B as another suite may have left it (another plan, suspended) is put on Basic, on trial, for this suite,
    // then restored exactly
    subB = (await sql<typeof subB>`select id, plan_id, status, trial_ends_at from subscriptions
      where tenant_id = ${CLINIC_B} and status <> 'cancelled'`.execute(worker)).rows[0];
    tenantB = (await sql<typeof tenantB>`select status, suspended_at, suspension_reason, suspension_kind, status_before_suspension
      from tenants where id = ${CLINIC_B}`.execute(worker)).rows[0];
    await sql`update subscriptions set plan_id = (select id from plans where code = 'basic'), status = 'trialing',
              trial_ends_at = now() + interval '7 days' where id = ${subB.id}`.execute(worker);
    await sql`update tenants set status = 'trialing', suspended_at = null, suspension_reason = null, suspension_kind = null,
              status_before_suspension = null where id = ${CLINIC_B}`.execute(worker);
    token.ownerB = (await http().post('/auth/dev-login').send({ email: 'owner.b@demo.test' }).expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await sql`update subscriptions set plan_id = ${subB.plan_id}, status = ${subB.status}, trial_ends_at = ${subB.trial_ends_at} where id = ${subB.id}`.execute(worker);
    await sql`update tenants set status = ${tenantB.status}, suspended_at = ${tenantB.suspended_at}, suspension_reason = ${tenantB.suspension_reason},
              suspension_kind = ${tenantB.suspension_kind}, status_before_suspension = ${tenantB.status_before_suspension} where id = ${CLINIC_B}`.execute(worker);
    await sql`update sites set show_powered_by = ${saved.a} where tenant_id = ${CLINIC_A}`.execute(worker);
    await sql`update sites set show_powered_by = ${saved.b} where tenant_id = ${CLINIC_B}`.execute(worker);
    await worker.destroy();
    await app.close();
  });

  it('the plan summary: plan, status, limits, features and usage counted as the limits count them', async () => {
    const res = await http().get('/clinic/plan').set(as('ownerB')).expect(200);
    expect(res.body).toMatchObject({ plan: { code: 'basic' }, status: 'trialing', live: true, features: { remove_badge: false } });
    expect(res.body.limits.branches).toBe(1);
    const branches = (await http().get('/branches').set(as('ownerB')).expect(200)).body.filter((b: { is_active: boolean }) => b.is_active).length;
    expect(res.body.usage.branches).toBe(branches);
    const doctors = (await http().get('/doctors').set(as('ownerB')).expect(200)).body.filter((d: { is_active: boolean }) => d.is_active).length;
    expect(res.body.usage.doctors).toBe(doctors);
    for (const k of ['staff', 'patients', 'storageMb']) expect(typeof res.body.usage[k]).toBe('number');
    expect(res.body.usage.storageMb).toBe(Math.ceil(res.body.storageBytes / 1024 / 1024));
    // settings managers only
    await http().get('/clinic/plan').set(as('receptionA')).expect(403);
  });

  it('a plan without remove_badge cannot hide the badge; showing it is always allowed', async () => {
    const off = await http().patch('/clinic/website').set(as('ownerB')).send({ showPoweredBy: false }).expect(403);
    expect(off.body).toMatchObject({ code: 'plan_feature_unavailable', feature: 'remove_badge' });
    const on = await http().patch('/clinic/website').set(as('ownerB')).send({ showPoweredBy: true }).expect(200);
    expect(on.body).toMatchObject({ showPoweredBy: true, canRemoveBadge: false });
    await http().patch('/clinic/website').set(as('ownerB')).send({ showPoweredBy: 'no' }).expect(400);
    await http().patch('/clinic/website').set(as('receptionA')).send({ showPoweredBy: true }).expect(403);
  });

  it('on a plan with remove_badge the owner hides it, and the public site follows at once', async () => {
    const plan = (await http().get('/clinic/plan').set(as('ownerA')).expect(200)).body;
    expect(plan.features.remove_badge).toBe(true);
    const off = await http().patch('/clinic/website').set(as('ownerA')).send({ showPoweredBy: false }).expect(200);
    expect(off.body).toMatchObject({ showPoweredBy: false, canRemoveBadge: true });
    expect(await badge('clinic-a.lvh.me')).toBe(false);
    await http().patch('/clinic/website').set(as('ownerA')).send({ showPoweredBy: true }).expect(200);
    expect(await badge('clinic-a.lvh.me')).toBe(true);
  });

  it('a suspended clinic: not live, every limit 0 and no feature (what is enforced then)', async () => {
    await sql`update subscriptions set status = 'suspended' where id = ${subB.id}`.execute(worker);
    try {
      const res = await http().get('/clinic/plan').set(as('ownerB')).expect(200);
      expect(res.body).toMatchObject({ plan: { code: 'basic' }, status: 'suspended', live: false, limits: { branches: 0, doctors: 0 }, features: { remove_badge: false } });
    } finally {
      await sql`update subscriptions set status = 'trialing' where id = ${subB.id}`.execute(worker);
    }
  });

  it('a hidden badge comes back on a plan that does not include remove_badge (e.g. after a downgrade)', async () => {
    // set behind the API's back, as a downgrade leaves it
    await sql`update sites set show_powered_by = false where tenant_id = ${CLINIC_B}`.execute(worker);
    expect(await badge('clinic-b.lvh.me')).toBe(true);
    expect((await http().get('/clinic/website').set(as('ownerB')).expect(200)).body).toMatchObject({ showPoweredBy: false, canRemoveBadge: false });
  });
});
