import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createDb, sql, type Db } from '@dental/db';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';
import type { DevEmailSender } from '../src/shared/notifications/dev-email.sender';
import { EMAIL_SENDER } from '../src/shared/notifications/ports';
import { OBJECT_STORAGE, type ObjectStorage } from '../src/shared/storage/ports';
import { hashPassword } from '../src/modules/identity/crypto';
import { buildNextExport, purgeDeletedClinics } from '../src/worker/data-exports';

const PASSWORD = 'Demo@12345';
/** This suite's own platform admin: emailed sign-in codes are limited per address (3 in 10 minutes, always on), and
 * the seed admin's allowance belongs to the platform, landing and legal suites. */
const ADMIN = `admin.h8.${String(Date.now()).slice(-8)}@demo.test`;
/** The worker's role on the database these tests use (the worker URL with the test database's name). */
function workerUrl(): string {
  const target = new URL(process.env.DATABASE_URL!);
  const w = new URL(process.env.DATABASE_WORKER_URL!);
  w.pathname = target.pathname;
  return w.toString();
}

describe('Clinic data: export and deletion (e2e, Phase H8)', () => {
  let app: INestApplication;
  let mail: DevEmailSender;
  let storage: ObjectStorage;
  let worker: Db;
  let ownerB = '';
  let reception = '';
  const log = () => undefined;
  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const codeFor = (to: string) => /(\d{6})/.exec(mail.outbox.get(to)?.text ?? '')?.[1] ?? '';
  /** downloads a signed link's body through the test server */
  const download = (url: string) => http().get(new URL(url).pathname + new URL(url).search)
    .buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    mail = app.get(EMAIL_SENDER);
    storage = app.get(OBJECT_STORAGE);
    worker = createDb(workerUrl(), { max: 2, applicationName: 'dental-worker-test' });
    ownerB = (await http().post('/auth/dev-login').send({ email: 'owner.b@demo.test' }).expect(201)).body.accessToken;
    reception = (await http().post('/auth/dev-login').send({ email: 'reception.a@demo.test' }).expect(201)).body.accessToken;
    await sql`insert into users (email, full_name, locale, email_verified_at, password_hash, platform_role)
              values (${ADMIN}, 'H8 Test Admin', 'ar', now(), ${await hashPassword(PASSWORD)}, 'super_admin')`.execute(worker);
  });
  afterAll(async () => {
    await worker.destroy();
    await app.close();
  });

  it('is the owner\'s only: staff are refused, and the password is asked again', async () => {
    expect((await http().get('/clinic/data/exports').set(as(reception)).expect(403)).body.code).toBe('owner_only');
    expect((await http().post('/clinic/data/exports').set(as(reception)).send({ password: PASSWORD }).expect(403)).body.code).toBe('owner_only');
    expect((await http().post('/clinic/data/delete').set(as(reception)).send({ password: PASSWORD, confirmName: 'x' }).expect(403)).body.code).toBe('owner_only');
    expect((await http().post('/clinic/data/exports').set(as(ownerB)).send({ password: 'wrong-pass' }).expect(401)).body.code).toBe('invalid_credentials');
  });

  it('exports everything into one ZIP: tables as CSV and JSON, a README, no secrets; downloaded through a short signed link', async () => {
    const list = (await http().post('/clinic/data/exports').set(as(ownerB)).send({ password: PASSWORD }).expect(201)).body;
    expect(list[0]).toMatchObject({ status: 'queued' });
    expect((await http().post('/clinic/data/exports').set(as(ownerB)).send({ password: PASSWORD }).expect(409)).body.code).toBe('export_in_progress');

    mail.outbox.delete('owner.b@demo.test');
    expect(await buildNextExport(worker, storage, mail, 'http://dashboard.test', log)).toBe(list[0].id);
    const ready = (await http().get('/clinic/data/exports').set(as(ownerB)).expect(200)).body[0];
    expect(ready).toMatchObject({ id: list[0].id, status: 'ready', size_bytes: expect.any(Number), expires_at: expect.any(String) });
    expect(mail.outbox.get('owner.b@demo.test')?.subject).toBe('نسخة بيانات عيادتك جاهزة');
    expect(mail.outbox.get('owner.b@demo.test')?.text).toContain('http://dashboard.test/#/data');

    const { url } = (await http().post(`/clinic/data/exports/${ready.id}/link`).set(as(ownerB)).expect(200)).body;
    const res = await download(url).expect(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="clinic-data-clinic-b-\d{4}-\d{2}-\d{2}\.zip"/);
    const zip = res.body as Buffer;
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    const names = zip.toString('latin1');
    for (const n of ['README.txt', 'csv/patients.csv', 'json/patients.json', 'csv/appointments.csv', 'csv/staff.csv', 'csv/files_index.csv']) expect(names).toContain(n);
    for (const n of ['refresh_tokens', 'platform_tenant_notes', 'password_hash', 'scrypt$']) expect(names).not.toContain(n);

    const bad = new URL(url);
    bad.searchParams.set('sig', 'A'.repeat(43));
    expect((await http().get(bad.pathname + bad.search).expect(403)).body.code).toBe('link_expired');
    // another clinic's owner cannot ask for a link to it
    const ownerA = (await http().post('/auth/dev-login').send({ email: 'owner.a@demo.test' }).expect(201)).body.accessToken;
    expect((await http().post(`/clinic/data/exports/${ready.id}/link`).set(as(ownerA)).expect(404)).body.code).toBe('export_not_ready');
  });

  it('deletion: the owner confirms with the password and the clinic name; the clinic closes at once; the platform restores it; after 90 days it is erased', async () => {
    const stamp = String(Date.now()).slice(-8);
    const email = `delete.${stamp}@demo.test`;
    const slug = `del-${stamp}`;
    const legalIds = (await http().get('/public/legal').expect(200)).body.map((d: { id: string }) => d.id);
    await http().post('/auth/signup').send({ fullName: 'د. مالك', email, phone: `012${stamp}`, password: 'Secret123', clinicNameAr: 'عيادة للحذف', slug, acceptedDocuments: legalIds }).expect(201);
    const owner = (await http().post('/auth/verify-email').send({ email, code: codeFor(email) }).expect(200)).body.accessToken;

    expect((await http().post('/clinic/data/delete').set(as(owner)).send({ password: 'Secret123', confirmName: 'عيادة أخرى' }).expect(400)).body.code).toBe('confirm_name_mismatch');
    expect((await http().post('/clinic/data/delete').set(as(owner)).send({ password: 'wrong-pass', confirmName: 'عيادة للحذف' }).expect(401)).body.code).toBe('invalid_credentials');
    const done = (await http().post('/clinic/data/delete').set(as(owner)).send({ password: 'Secret123', confirmName: '  عيادة   للحذف ' }).expect(200)).body;
    expect(new Date(done.deleteAfter).getTime() - Date.now()).toBeGreaterThan(89 * 86_400_000);
    expect(mail.outbox.get(email)?.subject).toBe('طلب حذف العيادة');

    expect((await http().get('/clinic/profile').set(as(owner)).expect(401)).body.code).toBe('clinic_deleted');
    expect((await http().post('/auth/login').send({ identifier: email, password: 'Secret123' }).expect(403)).body.code).toBe('clinic_deleted');
    await http().get(`/public/site?host=${slug}.lvh.me`).expect(404);

    // the platform sees it waiting, and restores it
    await http().post('/platform/auth/login').send({ email: ADMIN, password: PASSWORD }).expect(200);
    const pt = ((await http().post('/platform/auth/verify').send({ email: ADMIN, code: codeFor(ADMIN) }).expect(200)).headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('pt='))!.split(';')[0];
    const clinic = ((await http().get('/platform/clinics').set({ Cookie: pt }).expect(200)).body as { id: string; slug: string; status: string; deletion: unknown }[])
      .find((c) => c.slug === slug)!;
    expect(clinic).toMatchObject({ status: 'cancelled', deletion: { delete_after: expect.any(String) } });
    expect((await http().post(`/platform/clinics/${clinic.id}/restore`).set({ Cookie: pt }).expect(200)).body).toMatchObject({ status: 'trialing', deletion: null });
    const again = (await http().post('/auth/login').send({ identifier: email, password: 'Secret123' }).expect(200)).body.accessToken;

    // deleted again, and 90 days later the worker erases it: data, account and all
    await http().post('/clinic/data/delete').set(as(again)).send({ password: 'Secret123', confirmName: slug }).expect(200);
    await sql`update tenants set delete_after = now() - interval '1 minute' where id = ${clinic.id}`.execute(worker);
    expect(await purgeDeletedClinics(worker, storage, log)).toBe(1);
    expect((await http().post('/auth/login').send({ identifier: email, password: 'Secret123' }).expect(401)).body.code).toBe('invalid_credentials');
    expect(((await http().get('/platform/clinics').set({ Cookie: pt }).expect(200)).body as { slug: string }[]).some((c) => c.slug === slug)).toBe(false);
  });
});
