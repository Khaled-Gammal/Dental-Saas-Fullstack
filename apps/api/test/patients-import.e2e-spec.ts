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

const CLINIC_B = '22222222-2222-2222-2222-222222222222';
/** A fresh Egyptian mobile per call, so reruns never collide with earlier imports. */
const mobile = () => `010${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

/**
 * Phase 2A (SRS ONB-03): importing patients from the clinic's Excel/CSV file. The dashboard maps the columns and sends
 * the rows as typed; the API reports per row (dry run) and creates the new ones (import).
 */
describe('Patient import (e2e, Phase 2A)', () => {
  let app: INestApplication;
  let worker: Db;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const imp = (who: string, body: object) => http().post('/patients/import').set(as(who)).send(body);
  const search = async (who: string, q: string) => (await http().get('/patients').query({ q }).set(as(who)).expect(200)).body.items as { file_no: number; full_name: string; phone: string; date_of_birth?: string }[];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    worker = createDb(workerUrl(), { max: 2, applicationName: 'dental-worker-test' });
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
  });

  afterAll(async () => {
    await worker.destroy();
    await app.close();
  });

  it('a dry run reports each row (new, duplicate of a record or of an earlier row, invalid with every problem) and writes nothing', async () => {
    const p1 = mobile();
    const p2 = mobile();
    const res = await imp('ownerA', { dryRun: true, rows: [
      { row: 2, fullName: 'سارة محمود', phone: p1, gender: 'أنثى', dateOfBirth: '15/3/1990' },
      { row: 3, fullName: 'OMAR KHALED', phone: '1011111111' }, // the seeded Omar Khaled (file 1), phone without its 0
      { row: 4, fullName: 'سارة  محمود', phone: p1 }, // row 2 again
      { row: 5, fullName: 'كريم سامي', phone: p1 }, // same phone, another person: a family member, new
      { row: 6, fullName: 'x', phone: '123', email: 'nope', dateOfBirth: '31/2/1990' },
      { row: 7, fullName: 'منى فاروق', phone: p2, phoneAlt: '', email: null },
    ] }).expect(200);
    expect(res.body).toMatchObject({ dryRun: true, created: 0, counts: { new: 3, duplicate: 2, invalid: 1 } });
    const byRow = Object.fromEntries(res.body.rows.map((r: { row: number }) => [r.row, r]));
    expect(byRow[2]).toMatchObject({ status: 'new' });
    expect(byRow[3]).toMatchObject({ status: 'duplicate', fileNo: 1, sameAsRow: null });
    expect(byRow[4]).toMatchObject({ status: 'duplicate', fileNo: null, sameAsRow: 2 });
    expect(byRow[5]).toMatchObject({ status: 'new' });
    expect(byRow[6].errors.map((e: { field: string }) => e.field)).toEqual(['fullName', 'phone', 'email', 'dateOfBirth']);
    expect(typeof res.body.room === 'number' || res.body.room === null).toBe(true);
    expect(await search('ownerA', p1)).toEqual([]); // nothing written
  });

  it('the import creates the new ones with file numbers; sending the same rows again creates nothing', async () => {
    const p = mobile();
    const rows = [
      { row: 2, fullName: 'هالة سعيد', phone: p, gender: 'F', dateOfBirth: '1988-07-01', city: 'الجيزة' },
      { row: 3, fullName: 'هالة سعيد', phone: p }, // the same person twice in the file
      { row: 4, fullName: 'يوسف هاني', phone: p, gender: 'ذكر' },
    ];
    const first = await imp('ownerA', { dryRun: false, rows }).expect(200);
    expect(first.body).toMatchObject({ dryRun: false, created: 2, counts: { new: 2, duplicate: 1, invalid: 0 } });
    const found = await search('ownerA', p);
    expect(found.map((x) => x.full_name).sort()).toEqual(['هالة سعيد', 'يوسف هاني']);
    expect(new Set(found.map((x) => x.file_no)).size).toBe(2);
    const again = await imp('ownerA', { dryRun: false, rows }).expect(200);
    expect(again.body).toMatchObject({ created: 0, counts: { new: 0, duplicate: 3 } });
    expect(again.body.rows.every((r: { fileNo?: number | null; sameAsRow?: number | null }) => r.fileNo || r.sameAsRow)).toBe(true);
    expect(await search('ownerA', p)).toHaveLength(2);
    // each created record has its audit row, and the batch one on the clinic
    const { rows: audit } = await sql<{ n: string }>`select count(*) as n from audit_log where action = 'patient.import' and changes->>'created' = '2'`.execute(worker);
    expect(Number(audit[0].n)).toBeGreaterThan(0);
  });

  it('another clinic\'s patient is not a duplicate (each clinic sees its own records)', async () => {
    // Youssef Samir is clinic B's file 1; for clinic A he is new (dry run)
    const res = await imp('ownerA', { dryRun: true, rows: [{ row: 2, fullName: 'Youssef Samir', phone: '01033333333' }] }).expect(200);
    expect(res.body.rows[0].status).toBe('new');
  });

  it('the plan\'s patient limit is checked for the whole batch at once', async () => {
    const { rows: [before] } = await sql<{ limits: Record<string, number> }>`select limits from plans where code = 'basic'`.execute(worker);
    const { rows: [{ n }] } = await sql<{ n: string }>`select count(*) as n from patients where tenant_id = ${CLINIC_B} and deleted_at is null and merged_into_id is null`.execute(worker);
    // clinic B's plan (Basic) for this test: room for exactly one more
    await sql`update plans set limits = limits || jsonb_build_object('patients', ${Number(n) + 1}::int) where code = 'basic'`.execute(worker);
    const { rows: [sub] } = await sql<{ id: string; plan_id: string; status: string }>`select id, plan_id, status from subscriptions where tenant_id = ${CLINIC_B} and status <> 'cancelled'`.execute(worker);
    await sql`update subscriptions set plan_id = (select id from plans where code = 'basic'), status = 'trialing' where id = ${sub.id}`.execute(worker);
    try {
      const rows = [{ row: 2, fullName: 'مريض أول', phone: mobile() }, { row: 3, fullName: 'مريض ثان', phone: mobile() }];
      const dry = await imp('ownerB', { dryRun: true, rows }).expect(200);
      expect(dry.body).toMatchObject({ room: 1, counts: { new: 2 } });
      const over = await imp('ownerB', { dryRun: false, rows }).expect(403);
      expect(over.body).toMatchObject({ code: 'plan_limit_reached', resource: 'patients', adding: 2, room: 1 });
      expect(await search('ownerB', rows[0].phone)).toEqual([]); // all or nothing
    } finally {
      await sql`update plans set limits = ${JSON.stringify(before.limits)}::jsonb where code = 'basic'`.execute(worker);
      await sql`update subscriptions set plan_id = ${sub.plan_id}, status = ${sub.status} where id = ${sub.id}`.execute(worker);
    }
  });

  it('refuses a malformed request: no rows, too many, unknown columns, no token', async () => {
    await imp('ownerA', { dryRun: true, rows: [] }).expect(400);
    await imp('ownerA', { dryRun: true, rows: Array.from({ length: 1001 }, (_, i) => ({ row: i + 2, fullName: 'اسم', phone: mobile() })) }).expect(400);
    await imp('ownerA', { dryRun: true, rows: [{ row: 2, fullName: 'اسم', phone: mobile(), salary: '1' }] }).expect(400);
    await http().post('/patients/import').send({ dryRun: true, rows: [{ row: 2, fullName: 'اسم', phone: mobile() }] }).expect(401);
  });

  it('is for whoever runs the clinic\'s settings: reception adds patients at the desk but does not bulk-import', async () => {
    await imp('receptionA', { dryRun: true, rows: [{ row: 2, fullName: 'اسم', phone: mobile() }] }).expect(403);
  });

  it('notes keep their line breaks; a date with a time is read as the date', async () => {
    const p = mobile();
    await imp('ownerA', { dryRun: false, rows: [{ row: 2, fullName: 'ريم عادل', phone: p, notes: 'سطر أول\nسطر ثان', dateOfBirth: '1992-06-30 00:00:00' }] }).expect(200);
    const [found] = await search('ownerA', p);
    const one = (await http().get(`/patients/${(found as unknown as { id: string }).id}`).set(as('ownerA')).expect(200)).body;
    expect(one).toMatchObject({ notes: 'سطر أول\nسطر ثان', date_of_birth: '1992-06-30' });
  });
});
