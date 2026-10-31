import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sql, type Db } from '@dental/db';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';
import type { DevEmailSender } from '../src/shared/notifications/dev-email.sender';
import { EMAIL_SENDER } from '../src/shared/notifications/ports';
import { createTestAdmin, type TestAdmin } from './test-admin';

const CLINIC_B = '22222222-2222-2222-2222-222222222222';
const PASSWORD = 'Demo@12345';
/**
 * Clinic B as the seed left it: on a 14-day trial, not suspended. The suite activates it at the end, and the test
 * database keeps what tests change, so without this a second run finds it active ("not_trialing", "already_active").
 */
async function resetClinicB(db: Db): Promise<void> {
  await sql`update subscriptions set status = 'trialing', billing_cycle = 'monthly', trial_ends_at = now() + interval '14 days',
            current_period_start = null, current_period_end = null, updated_at = now()
            where tenant_id = ${CLINIC_B} and status <> 'cancelled'`.execute(db);
  await sql`update tenants set status = 'trialing', suspended_at = null, suspension_reason = null, suspension_kind = null,
            status_before_suspension = null, updated_at = now() where id = ${CLINIC_B}`.execute(db);
}
const cookieOf = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith('pt='));

describe('Platform admin panel (e2e, Phase H5)', () => {
  let app: INestApplication;
  let mail: DevEmailSender;
  let adm: TestAdmin;
  let ADMIN = '';
  let pt = '';
  let ownerB = '';
  let originalPlan = '';
  const http = () => request(app.getHttpServer());
  const admin = () => ({ Cookie: pt.split(';')[0] });
  const codeFor = (email: string) => /(\d{6})/.exec(mail.outbox.get(email)?.text ?? '')?.[1] ?? '';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    mail = app.get(EMAIL_SENDER);
    adm = await createTestAdmin('platform', PASSWORD);
    ADMIN = adm.email;
    await resetClinicB(adm.db);
    ownerB = (await http().post('/auth/dev-login').send({ email: 'owner.b@demo.test' }).expect(201)).body.accessToken;
  });
  afterAll(async () => {
    // clinic B back as it was, whatever happened above
    if (pt) {
      await http().post(`/platform/clinics/${CLINIC_B}/reactivate`).set(admin());
      if (originalPlan) await http().post(`/platform/clinics/${CLINIC_B}/plan`).set(admin()).send({ planId: originalPlan });
    }
    if (adm) { await resetClinicB(adm.db); await adm.done(); }
    await app.close();
  });

  it('signs in with the password and then the emailed code; clinic users and wrong passwords get the same answer', async () => {
    expect((await http().post('/platform/auth/login').send({ email: 'owner.a@demo.test', password: PASSWORD }).expect(401)).body.code).toBe('invalid_credentials');
    expect((await http().post('/platform/auth/login').send({ email: ADMIN, password: 'wrong-pass' }).expect(401)).body.code).toBe('invalid_credentials');
    expect((await http().post('/platform/auth/login').send({ email: ADMIN, password: PASSWORD }).expect(200)).body).toMatchObject({ codeSent: true });
    expect((await http().post('/platform/auth/verify').send({ email: ADMIN, code: '000000' }).expect(400)).body.code).toBe('otp_invalid');
    const res = await http().post('/platform/auth/verify').send({ email: ADMIN, code: codeFor(ADMIN) }).expect(200);
    expect(res.body).toMatchObject({ name: 'Platform Admin', email: ADMIN });
    pt = cookieOf(res) ?? '';
    expect(pt).toMatch(/HttpOnly/i);
    expect(pt).toMatch(/SameSite=Strict/i);
    expect(pt).toMatch(/Path=\/platform/i);
  });

  it('the panel needs the platform session; clinic and platform tokens never open each other\'s routes', async () => {
    expect((await http().get('/platform/clinics').expect(401)).body.code).toBe('platform_session_required');
    await http().get('/platform/clinics').set({ Authorization: `Bearer ${ownerB}` }).expect(401);
    const token = pt.split(';')[0].slice('pt='.length);
    await http().get('/clinic/profile').set({ Authorization: `Bearer ${decodeURIComponent(token)}` }).expect(401);
    await http().get('/platform/me').set(admin()).expect(200);
  });

  it('lists every clinic with its plan and figures (no patient records)', async () => {
    const list = (await http().get('/platform/clinics').set(admin()).expect(200)).body;
    const a = list.find((c: { slug: string }) => c.slug === 'clinic-a');
    expect(a).toMatchObject({ owner_email: 'owner.a@demo.test' });
    expect(a.patients).toBeGreaterThan(0);
    expect(Object.keys(a)).not.toContain('full_name');
    const b = (await http().get(`/platform/clinics/${CLINIC_B}`).set(admin()).expect(200)).body;
    expect(b).toMatchObject({ slug: 'clinic-b', notes: expect.any(Array), history: expect.any(Array) });
  });

  it('suspends a clinic: its staff are cut off at once, it cannot sign in, its website is offline; reactivation restores it', async () => {
    await http().get('/clinic/profile').set({ Authorization: `Bearer ${ownerB}` }).expect(200);
    expect((await http().post(`/platform/clinics/${CLINIC_B}/suspend`).set(admin()).send({ reason: 'x' }).expect(400)).body.code).toBe('validation_failed');
    const s = (await http().post(`/platform/clinics/${CLINIC_B}/suspend`).set(admin()).send({ reason: 'الاشتراك غير مدفوع' }).expect(200)).body;
    expect(s).toMatchObject({ status: 'suspended' });
    expect((await http().get('/clinic/profile').set({ Authorization: `Bearer ${ownerB}` }).expect(401)).body.code).toBe('clinic_suspended');
    expect((await http().post('/auth/dev-login').send({ email: 'owner.b@demo.test' }).expect(403)).body.code).toBe('clinic_suspended');
    await http().get('/public/site?host=clinic-b.lvh.me').expect(404);
    expect((await http().post(`/platform/clinics/${CLINIC_B}/suspend`).set(admin()).send({ reason: 'مرة ثانية' }).expect(409)).body.code).toBe('clinic_status');
    const r = (await http().post(`/platform/clinics/${CLINIC_B}/reactivate`).set(admin()).expect(200)).body;
    expect(r.status).not.toBe('suspended');
    ownerB = (await http().post('/auth/dev-login').send({ email: 'owner.b@demo.test' }).expect(201)).body.accessToken;
    await http().get('/clinic/profile').set({ Authorization: `Bearer ${ownerB}` }).expect(200);
    await http().get('/public/site?host=clinic-b.lvh.me').expect(200);
  });

  it('extends a trial, changes the plan, keeps notes; every action is in the platform audit log', async () => {
    expect((await http().post(`/platform/clinics/${CLINIC_B}/trial`).set(admin()).send({ until: '2020-01-01' }).expect(400)).body.code).toBe('trial_out_of_range');
    const until = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const t = (await http().post(`/platform/clinics/${CLINIC_B}/trial`).set(admin()).send({ until }).expect(200)).body;
    expect(new Date(t.trial_ends_at).getTime()).toBeGreaterThan(Date.now() + 39 * 86_400_000);
    const plans = (await http().get('/platform/plans').set(admin()).expect(200)).body as { id: string; code: string }[];
    originalPlan = plans.find((p) => p.code === t.plan_code)!.id;
    const other = plans.find((p) => p.code !== t.plan_code)!;
    expect((await http().post(`/platform/clinics/${CLINIC_B}/plan`).set(admin()).send({ planId: other.id }).expect(200)).body.plan_code).toBe(other.code);
    const notes = (await http().post(`/platform/clinics/${CLINIC_B}/notes`).set(admin()).send({ body: 'اتصل المالك بخصوص الدفع' }).expect(201)).body;
    expect(notes[0]).toMatchObject({ body: 'اتصل المالك بخصوص الدفع', author: 'Platform Admin' });
    const history = (await http().get(`/platform/clinics/${CLINIC_B}`).set(admin()).expect(200)).body.history.map((h: { action: string }) => h.action);
    expect(history).toEqual(expect.arrayContaining(['tenant.suspended', 'tenant.reactivated', 'tenant.trial_extended', 'tenant.plan_changed']));
  });

  it('edits a plan: prices, trial days, limits and features (merged), and refuses unknown keys', async () => {
    const plans = (await http().get('/platform/plans').set(admin()).expect(200)).body as { id: string; trial_days: number; limits: Record<string, number>; clinics: number }[];
    // every seeded clinic is on a plan: the counts see past row-level security (they all read 0 before)
    expect(plans.reduce((n, x) => n + x.clinics, 0)).toBeGreaterThanOrEqual(2);
    const p = plans[0];
    const edited = (await http().patch(`/platform/plans/${p.id}`).set(admin()).send({ trialDays: 21, limits: { staff: 99 } }).expect(200)).body;
    expect(edited).toMatchObject({ trial_days: 21, limits: { ...p.limits, staff: 99 } });
    await http().patch(`/platform/plans/${p.id}`).set(admin()).send({ limits: { rockets: 1 } }).expect(400);
    await http().patch(`/platform/plans/${p.id}`).set(admin()).send({ trialDays: p.trial_days, limits: { staff: p.limits.staff } }).expect(200);
    const audit = (await http().get('/platform/audit').set(admin()).expect(200)).body.map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['plan.updated', 'platform.sign_in']));
  });

  it('adds a plan after the others with a free code (owner 2026-10-24)', async () => {
    // the test database keeps what tests add and plans are never deleted: a fresh code, hidden from the landing page
    const code = `e2e-${Date.now().toString(36)}`;
    const body = { code, nameAr: 'المؤسسات', priceMonthlyMinor: 250000, priceYearlyMinor: 2500000, trialDays: 30, isPublic: false, limits: { branches: null } };
    const before = (await http().get('/platform/plans').set(admin()).expect(200)).body as { sort_order: number }[];
    const p = (await http().post('/platform/plans').set(admin()).send(body).expect(201)).body;
    expect(p).toMatchObject({ code, name_ar: 'المؤسسات', price_monthly_minor: 250000, trial_days: 30, is_public: false, clinics: 0 });
    expect(p.sort_order).toBeGreaterThan(Math.max(...before.map((x) => x.sort_order)));
    expect((await http().post('/platform/plans').set(admin()).send(body).expect(409)).body.code).toBe('plan_code_taken');
    await http().post('/platform/plans').set(admin()).send({ ...body, code: 'مؤسسات' }).expect(400);
    await http().post('/platform/plans').set(admin()).send({ code: `${code}-x`, nameAr: 'ناقصة' }).expect(400);
    await http().post('/platform/plans').send({ ...body, code: `${code}-y` }).expect(401);
    const audit = (await http().get('/platform/audit').set(admin()).expect(200)).body.map((a: { action: string }) => a.action);
    expect(audit).toContain('plan.created');
  });

  it('activates a paid clinic for a month or a year (owner 2026-10-20: trials end in suspension otherwise)', async () => {
    expect((await http().post(`/platform/clinics/${CLINIC_B}/activate`).set(admin()).send({ cycle: 'weekly' }).expect(400)).body.code).toBe('validation_failed');
    const a = (await http().post(`/platform/clinics/${CLINIC_B}/activate`).set(admin()).send({ cycle: 'monthly' }).expect(200)).body;
    expect(a).toMatchObject({ status: 'active', subscription_status: 'active', billing_cycle: 'monthly', suspension_kind: null });
    expect(new Date(a.current_period_end).getTime()).toBeGreaterThan(Date.now() + 27 * 86_400_000);
    expect((await http().post(`/platform/clinics/${CLINIC_B}/activate`).set(admin()).send({ cycle: 'yearly' }).expect(409)).body.code).toBe('already_active');
    expect((await http().post(`/platform/clinics/${CLINIC_B}/trial`).set(admin()).send({ until: new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10) }).expect(409)).body.code)
      .toBe('not_trialing');
    const history = (await http().get(`/platform/clinics/${CLINIC_B}`).set(admin()).expect(200)).body.history.map((h: { action: string }) => h.action);
    expect(history).toContain('tenant.activated');
  });

  it('signs out', async () => {
    await http().post('/platform/auth/logout').expect(204);
  });
});
