import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';
import { Accounts } from '../src/modules/identity/accounts.service';
import { TenantDb } from '../src/shared/database/tenant-db.service';
import type { DevEmailSender } from '../src/shared/notifications/dev-email.sender';
import { EMAIL_SENDER } from '../src/shared/notifications/ports';

const CLINIC_B = '22222222-2222-2222-2222-222222222222';

describe('Legal documents (e2e, Phase H6)', () => {
  let app: INestApplication;
  let mail: DevEmailSender;
  const run = `${Date.now()}`.slice(-7);
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (email: string) => (await http().post('/auth/dev-login').send({ email }).expect(201)).body;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    mail = app.get(EMAIL_SENDER);
  });
  afterAll(async () => { await app.close(); });

  it('anyone reads the current documents (sign-up and invitation pages link to them)', async () => {
    const list = (await http().get('/public/legal').expect(200)).body;
    expect(list.map((d: { kind: string }) => d.kind)).toEqual(['terms', 'privacy', 'dpa']);
    const terms = (await http().get('/public/legal/terms').expect(200)).body;
    expect(terms).toMatchObject({ kind: 'terms', title_ar: expect.any(String), body_ar: expect.any(String) });
    await http().get('/public/legal/cookies').expect(400);
  });

  it('a member who never accepted is stopped until they accept, then works as usual', async () => {
    // a new staff member of clinic B, created without accepting anything (as members from before H6 were)
    const owner = await login('owner.b@demo.test');
    const role = (await http().post('/staff/roles').set(bearer(owner.accessToken)).send({ nameAr: `قراءة ${run}`, permissions: ['patients:read'] }).expect(201)).body;
    const email = `legal.${run}@demo.test`;
    await app.get(TenantDb).runAs(CLINIC_B, async (tx) => {
      const userId = await app.get(Accounts).createVerifiedUser(tx, { email, fullName: 'Legal Tester', password: 'Secret123' });
      await tx.insertInto('tenant_members').values({ tenant_id: CLINIC_B, user_id: userId, role_id: role.id }).execute();
    });

    const s = await login(email);
    expect(s.legalPending.map((d: { kind: string }) => d.kind)).toEqual(['terms', 'privacy']); // staff: no DPA
    expect((await http().get('/patients').set(bearer(s.accessToken)).expect(403)).body.code).toBe('legal_acceptance_required');
    expect((await http().post('/legal/accept').set(bearer(s.accessToken)).send({ documentIds: [s.legalPending[0].id] }).expect(400)).body.code)
      .toBe('legal_acceptance_required');
    await http().post('/legal/accept').set(bearer(s.accessToken)).send({ documentIds: s.legalPending.map((d: { id: string }) => d.id) }).expect(204);
    const again = await login(email);
    expect(again.legalPending).toEqual([]);
    await http().get('/patients').set(bearer(again.accessToken)).expect(200);
    // the owners of the seed accepted everything at sign-up
    expect(owner.legalPending).toEqual([]);
  });

  it('the platform panel publishes a new version; one that does not ask to be accepted again stops nobody', async () => {
    await http().post('/platform/auth/login').send({ email: 'admin@demo.test', password: 'Demo@12345' }).expect(200);
    const code = /(\d{6})/.exec(mail.outbox.get('admin@demo.test')?.text ?? '')?.[1] ?? '';
    const res = await http().post('/platform/auth/verify').send({ email: 'admin@demo.test', code }).expect(200);
    const pt = ((res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('pt=')) ?? '').split(';')[0];
    await http().post('/platform/legal').set({ Cookie: pt }).send({ kind: 'privacy', titleAr: 'سياسة الخصوصية', bodyAr: 'قصير', requiresReacceptance: false }).expect(400);
    const versions = (await http().post('/platform/legal').set({ Cookie: pt })
      .send({ kind: 'privacy', titleAr: 'سياسة الخصوصية', bodyAr: `نص تجريبي لإصدار جديد من سياسة الخصوصية ${run}`, requiresReacceptance: false }).expect(201)).body;
    const latest = versions.find((v: { kind: string }) => v.kind === 'privacy');
    expect(latest).toMatchObject({ requires_reacceptance: false, published_by: 'Platform Admin' });
    expect((await http().get('/public/legal/privacy').expect(200)).body.version).toBe(latest.version);
    expect((await login('owner.a@demo.test')).legalPending).toEqual([]);
    await http().get('/platform/legal').expect(401); // the panel's session only
  });
});
