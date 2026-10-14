import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
// The e2e suite runs against the test database that `pnpm db:test` rebuilds and seeds.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
// eslint-disable-next-line import/first
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
    expect(a.body.map((x: { slug: string }) => x.slug).sort()).toEqual(['maadi', 'nasr-city']);
    expect(b.body.map((x: { slug: string }) => x.slug)).toEqual(['heliopolis']);
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

  it('public site resolves a clinic by hostname', async () => {
    const res = await request(app.getHttpServer()).get('/public/site?host=clinic-a.lvh.me:3000').expect(200);
    expect(res.body.clinic.slug).toBe('clinic-a');
    expect(res.body.services.length).toBeGreaterThan(0);
    await request(app.getHttpServer()).get('/public/site?host=nobody.lvh.me').expect(404);
  });
});
