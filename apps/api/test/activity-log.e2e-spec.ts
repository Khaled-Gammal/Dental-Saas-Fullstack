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

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const RECEPTION_ROLE = 'a0000000-0000-0000-0000-0000000000a2'; // reception.a (all branches) and reception.maadi (Maadi only)
/** a past day of rows written by this suite (removed after it) */
const PROBE_DAY = '2025-02-11';
const mobile = () => `010${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
type Item = { id: number; at: string; action: string; entityType: string; entityId: string | null; entityLabel: string | null; patientId: string | null; actorName: string | null; changes: Record<string, unknown> | null };

/** Phase 2D (DSH-15): the clinic's activity log — who changed or opened what, when — for whoever holds audit:read. */
describe('Activity log (e2e, Phase 2D)', () => {
  let app: INestApplication;
  let worker: Db;
  const token: Record<string, string> = {};
  let patientId = '';
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const login = async (who: string, email: string) => { token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken; };
  const log = async (who: string, query: Record<string, string | number> = {}) => (await http().get('/activity-log').query(query).set(as(who)).expect(200)).body as { items: Item[]; nextCursor: string | null; from: string; to: string };
  const clearProbe = () => sql`delete from audit_log where tenant_id = ${CLINIC_A} and created_at >= ${PROBE_DAY}::date - 1 and created_at < ${PROBE_DAY}::date + 2`.execute(worker);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    worker = createDb(workerUrl(), { max: 2, applicationName: 'dental-worker-test' });
    await clearProbe();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) await login(who, email);
    patientId = (await http().post('/patients').set(as('ownerA')).send({ fullName: 'سجل العمليات تجربة', phone: mobile() }).expect(201)).body.id;
    await http().get(`/patients/${patientId}`).set(as('ownerA')).expect(200); // a view
  });
  afterAll(async () => {
    await sql`update roles set permissions = array_remove(permissions, 'audit:read') where id = ${RECEPTION_ROLE}`.execute(worker);
    await clearProbe();
    await worker.destroy();
    await app.close();
  });

  it('shows the last 7 days by default, newest first, naming the record and who acted', async () => {
    const r = await log('ownerA', { entity: 'patient' });
    expect(r.from <= r.to).toBe(true);
    const mine = r.items.filter((i) => i.entityId === patientId);
    expect(mine.map((i) => i.action)).toEqual(expect.arrayContaining(['patient.create', 'patient.view']));
    expect(mine[0].entityLabel).toContain('سجل العمليات تجربة');
    expect(mine[0].patientId).toBe(patientId);
    expect(mine[0].actorName).toBeTruthy();
    const times = r.items.map((i) => Date.parse(i.at));
    expect(times.every((t, i) => i === 0 || t <= times[i - 1])).toBe(true);
  });

  it('changes only, or views only', async () => {
    expect((await log('ownerA', { kind: 'changes' })).items.some((i) => i.action.endsWith('.view'))).toBe(false);
    const views = (await log('ownerA', { kind: 'views' })).items;
    expect(views.length).toBeGreaterThan(0);
    expect(views.every((i) => i.action.endsWith('.view'))).toBe(true);
  });

  it('pages with a cursor, missing nothing written in the same instant', async () => {
    // one transaction writes many rows at the same time (an import, an invoice with its items)
    await sql`insert into audit_log (tenant_id, actor_type, action, entity_type, entity_id, changes, created_at)
              select ${CLINIC_A}, 'system', 'probe_entity.update', 'probe_entity', gen_random_uuid(), null, ${`${PROBE_DAY} 09:00:00.123456+00`}::timestamptz
                from generate_series(1, 4)`.execute(worker);
    const q = { from: PROBE_DAY, to: PROBE_DAY, entity: 'probe_entity' };
    const all = (await log('ownerA', { ...q, limit: 100 })).items.map((i) => i.id);
    expect(all).toHaveLength(4);
    const paged: number[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof log>> = await log('ownerA', { ...q, limit: 1, ...(cursor ? { cursor } : {}) });
      paged.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor && paged.length < 10);
    expect(paged).toEqual(all);
  });

  it('a record group takes in its parts; text people typed is never returned', async () => {
    await sql`insert into audit_log (tenant_id, actor_type, action, entity_type, entity_id, changes, created_at) values
              (${CLINIC_A}, 'system', 'patient_medical_history.view', 'patient_medical_history', ${patientId}, null, ${`${PROBE_DAY} 10:00:00+00`}::timestamptz),
              (${CLINIC_A}, 'system', 'refund.create', 'refund', gen_random_uuid(), ${JSON.stringify({ reason: [null, 'المريض غير راضٍ عن التركيبة'], amount_minor: [null, 5000] })}::jsonb, ${`${PROBE_DAY} 11:00:00+00`}::timestamptz)`.execute(worker);
    const patient = (await log('ownerA', { from: PROBE_DAY, to: PROBE_DAY, entity: 'patient' })).items;
    expect(patient.map((i) => i.entityType)).toContain('patient_medical_history');
    const [refund] = (await log('ownerA', { from: PROBE_DAY, to: PROBE_DAY, entity: 'refund' })).items;
    expect(refund.changes).toEqual({ reason: true, amount_minor: [null, 5000] });
  });

  it('refuses a bad range; a year at most', async () => {
    await http().get('/activity-log').query({ from: '2026-11-10', to: '2026-11-01' }).set(as('ownerA')).expect(400);
    expect((await http().get('/activity-log').query({ from: '2024-01-01', to: '2026-01-01' }).set(as('ownerA')).expect(400)).body.code).toBe('range_too_long');
  });

  it('is for audit:read holders, and each clinic sees its own', async () => {
    await http().get('/activity-log').set(as('receptionA')).expect(403);
    expect((await log('ownerB', { entity: 'patient' })).items.some((i) => i.entityId === patientId)).toBe(false);
    const actors = (await http().get('/activity-log/actors').set(as('ownerA')).expect(200)).body as { name: string }[];
    expect(actors.length).toBeGreaterThan(0);
  });

  it('the details follow the reader\'s other permissions; members limited to some branches cannot open it', async () => {
    await sql`update roles set permissions = array_append(permissions, 'audit:read') where id = ${RECEPTION_ROLE}`.execute(worker);
    try {
      await login('receptionA', 'reception.a@demo.test');
      await login('receptionMaadi', 'reception.maadi@demo.test');
      // reception: patient files yes, clinical records no
      const items = (await log('receptionA', { from: PROBE_DAY, to: PROBE_DAY, entity: 'patient' })).items;
      const history = items.find((i) => i.entityType === 'patient_medical_history');
      expect(history).toMatchObject({ changes: null, entityLabel: null, patientId: null });
      const mine = (await log('receptionA', { entity: 'patient' })).items.find((i) => i.entityId === patientId && i.action === 'patient.view');
      expect(mine?.entityLabel).toContain('سجل العمليات تجربة');
      expect((await http().get('/activity-log').set(as('receptionMaadi')).expect(403)).body.code).toBe('branch_scoped');
      expect((await http().get('/activity-log/actors').set(as('receptionMaadi')).expect(403)).body.code).toBe('branch_scoped');
    } finally {
      await sql`update roles set permissions = array_remove(permissions, 'audit:read') where id = ${RECEPTION_ROLE}`.execute(worker);
    }
  });
});
