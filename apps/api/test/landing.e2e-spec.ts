import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';
import type { DevEmailSender } from '../src/shared/notifications/dev-email.sender';
import { EMAIL_SENDER } from '../src/shared/notifications/ports';

const ADMIN = 'admin@demo.test';
const PASSWORD = 'Demo@12345';
// a fresh number per run: the test database keeps the requests of earlier runs
const local = `010${String(Date.now()).slice(-8)}`;
const e164 = `+20${local.slice(1)}`;

describe('Landing page: plans and the contact form (e2e, Phase H7)', () => {
  let app: INestApplication;
  let mail: DevEmailSender;
  let pt = '';
  const http = () => request(app.getHttpServer());
  const admin = () => ({ Cookie: pt.split(';')[0] });
  const codeFor = (email: string) => /(\d{6})/.exec(mail.outbox.get(email)?.text ?? '')?.[1] ?? '';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    mail = app.get(EMAIL_SENDER);
    await http().post('/platform/auth/login').send({ email: ADMIN, password: PASSWORD }).expect(200);
    const res = await http().post('/platform/auth/verify').send({ email: ADMIN, code: codeFor(ADMIN) }).expect(200);
    pt = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('pt=')) ?? '';
  });
  afterAll(async () => { await app.close(); });

  it('lists the public plans for the pricing table, cached, without features or internal fields', async () => {
    const res = await http().get('/public/plans').expect(200);
    expect(res.headers['cache-control']).toMatch(/s-maxage=300/);
    expect(res.body.map((p: { code: string }) => p.code)).toEqual(['basic', 'pro']);
    expect(res.body[0]).toMatchObject({ name_ar: 'الأساسية', price_monthly_minor: 50000, price_yearly_minor: 500000, currency: 'EGP', limits: expect.any(Object) });
    expect(Object.keys(res.body[0]).sort()).toEqual(['code', 'currency', 'id', 'limits', 'name_ar', 'price_monthly_minor', 'price_yearly_minor', 'trial_days']);
  });

  it('a plan hidden in the panel leaves the pricing table', async () => {
    const plans = (await http().get('/platform/plans').set(admin()).expect(200)).body as { id: string; code: string }[];
    const basic = plans.find((p) => p.code === 'basic')!;
    await http().patch(`/platform/plans/${basic.id}`).set(admin()).send({ isPublic: false }).expect(200);
    try {
      expect((await http().get('/public/plans').expect(200)).body.map((p: { code: string }) => p.code)).toEqual(['pro']);
    } finally {
      await http().patch(`/platform/plans/${basic.id}`).set(admin()).send({ isPublic: true }).expect(200);
    }
  });

  it('a clinic asks for a call: stored with a normalised phone, the admins get an email without the person\'s details', async () => {
    mail.outbox.delete(ADMIN);
    await http().post('/public/leads').send({
      fullName: 'د. منى حسن', phone: local, email: '', clinicName: 'عيادة النور', city: 'طنطا', message: 'نريد موعدًا للعرض', planCode: 'pro',
    }).expect(204);
    const sent = mail.outbox.get(ADMIN);
    expect(sent?.subject).toBe('طلب تواصل جديد من عيادة');
    expect(sent?.text).toContain('عيادة النور');
    expect(sent?.text).toContain('الاحترافية');
    expect(sent?.text).not.toContain(local.slice(-6));
    expect(sent?.text).not.toContain('منى');
    const lead = ((await http().get('/platform/leads').set(admin()).expect(200)).body as { phone: string }[]).find((l) => l.phone === e164);
    expect(lead).toMatchObject({ full_name: 'د. منى حسن', email: null, clinic_name: 'عيادة النور', status: 'new', plan_code: 'pro', source: 'landing' });
  });

  it('refuses a bad phone or a missing name, and ignores what a bot sends', async () => {
    expect((await http().post('/public/leads').send({ fullName: 'سارة', phone: '12' }).expect(400)).body.code).toBe('validation_failed');
    expect((await http().post('/public/leads').send({ phone: local }).expect(400)).body.code).toBe('validation_failed');
    expect((await http().post('/public/leads').send({ fullName: 'سارة', phone: local, status: 'converted' }).expect(400)).body.code).toBe('validation_failed');
    const before = ((await http().get('/platform/leads').set(admin()).expect(200)).body as unknown[]).length;
    await http().post('/public/leads').send({ fullName: 'Bot', phone: '01099999999', website: 'http://spam.example' }).expect(204);
    expect(((await http().get('/platform/leads').set(admin()).expect(200)).body as unknown[]).length).toBe(before);
  });

  it('only the platform panel reads requests and moves them along', async () => {
    const owner = (await http().post('/auth/dev-login').send({ email: 'owner.a@demo.test' }).expect(201)).body.accessToken;
    await http().get('/platform/leads').set({ Authorization: `Bearer ${owner}` }).expect(401);
    const lead = ((await http().get('/platform/leads').set(admin()).expect(200)).body as { id: string; phone: string }[]).find((l) => l.phone === e164)!;
    const after = (await http().post(`/platform/leads/${lead.id}/status`).set(admin()).send({ status: 'contacted' }).expect(200)).body as { id: string; status: string; updated_by_name: string }[];
    expect(after.find((l) => l.id === lead.id)).toMatchObject({ status: 'contacted', updated_by_name: 'Platform Admin' });
    expect((await http().post(`/platform/leads/${lead.id}/status`).set(admin()).send({ status: 'archived' }).expect(400)).body.code).toBe('validation_failed');
    expect((await http().post('/platform/leads/00000000-0000-0000-0000-000000000000/status').set(admin()).send({ status: 'lost' }).expect(404)).body.code).toBe('lead_not_found');
  });
});
