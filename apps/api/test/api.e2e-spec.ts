import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
// The e2e suite runs against the test database that `pnpm db:test` rebuilds and seeds.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
import { AppModule } from '../src/app.module';

describe('API (e2e)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};

  const login = async (email: string) => {
    const res = await request(app.getHttpServer()).post('/auth/dev-login').send({ email }).expect(201);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    token.ownerA = await login('owner.a@demo.test');
    token.receptionA = await login('reception.a@demo.test');
    token.ownerB = await login('owner.b@demo.test');
  });

  afterAll(async () => {
    await app.close();
  });

  it('health reports database and redis up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.checks).toEqual({ database: 'up', redis: 'up' });
  });

  it('rejects calls without a token as problem+json', async () => {
    const res = await request(app.getHttpServer()).get('/branches').expect(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.status).toBe(401);
  });

  it('each clinic sees only its own branches', async () => {
    const a = await request(app.getHttpServer()).get('/branches').set('Authorization', `Bearer ${token.ownerA}`).expect(200);
    const b = await request(app.getHttpServer()).get('/branches').set('Authorization', `Bearer ${token.ownerB}`).expect(200);
    const slugsA = a.body.map((x: { slug: string }) => x.slug);
    const slugsB = b.body.map((x: { slug: string }) => x.slug);
    // contains, not equals: later tests add branches, and the suite must pass on repeated runs
    expect(slugsA).toEqual(expect.arrayContaining(['maadi', 'nasr-city']));
    expect(slugsA).not.toContain('heliopolis');
    expect(slugsB).toContain('heliopolis');
    expect(slugsB).not.toContain('nasr-city');
  });

  it('receptionist cannot create branches (permission check)', async () => {
    await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${token.receptionA}`)
      .send({ nameEn: 'Zamalek', slug: 'zamalek' })
      .expect(403);
  });

  it('validates input and maps duplicate slugs to 409', async () => {
    await request(app.getHttpServer()).post('/branches').set('Authorization', `Bearer ${token.ownerA}`).send({ slug: 'Bad Slug' }).expect(400);
    await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${token.ownerA}`)
      .send({ nameEn: 'Nasr City 2', slug: 'nasr-city' })
      .expect(409);
  });

  it('ignores a tenant_id in the body: a branch is always created in the caller\'s own clinic', async () => {
    const slug = `ext-${Date.now().toString().slice(-6)}`;
    const made = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${token.ownerA}`)
      .send({ nameEn: 'Sneaky', slug, tenant_id: '22222222-2222-2222-2222-222222222222', tenantId: '22222222-2222-2222-2222-222222222222' })
      .expect(201);
    const b = await request(app.getHttpServer()).get('/branches').set('Authorization', `Bearer ${token.ownerB}`).expect(200);
    expect(b.body.map((x: { slug: string }) => x.slug)).not.toContain(slug);
    // frees the plan's branch seat: the test database keeps it, and repeated runs would fill clinic A's limit
    await request(app.getHttpServer()).patch(`/branches/${made.body.id}`).set('Authorization', `Bearer ${token.ownerA}`).send({ isActive: false }).expect(200);
  });

  it('database errors never leak table or constraint names', async () => {
    const res = await request(app.getHttpServer())
      .post('/branches').set('Authorization', `Bearer ${token.ownerA}`).send({ nameEn: 'Dup', slug: 'nasr-city' }).expect(409);
    expect(JSON.stringify(res.body)).not.toMatch(/branches_|constraint|duplicate key/i);
  });

  it('public site resolves a clinic by hostname', async () => {
    const res = await request(app.getHttpServer()).get('/public/site?host=clinic-a.lvh.me:3000').expect(200);
    expect(res.body.clinic.slug).toBe('clinic-a');
    expect(res.body.services.length).toBeGreaterThan(0);
    expect(typeof res.body.services[0].price_minor).toBe('number');
    expect(res.headers['cache-control']).toContain('s-maxage=60');
    await request(app.getHttpServer()).get('/public/site?host=clinic-a.lvh.me&host=x').expect(404);
    await request(app.getHttpServer()).get('/public/site?host=nobody.lvh.me').expect(404);
  });

  it('dev-login goes through the normal session (cookie + member checks)', async () => {
    const res = await request(app.getHttpServer()).post('/auth/dev-login').send({ email: 'owner.a@demo.test' }).expect(201);
    expect(res.body.refreshToken).toBeUndefined(); // only in the httpOnly cookie
    expect(String(res.headers['set-cookie'])).toContain('rt=');
    const wrong = await request(app.getHttpServer()).post('/auth/dev-login').send({ email: 'owner.a@demo.test', clinic: 'clinic-b' }).expect(403);
    expect(wrong.body.code).toBe('clinic_not_found');
  });
});
