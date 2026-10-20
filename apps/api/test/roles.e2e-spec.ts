import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { sql } from '@dental/db';
import { AppModule } from '../src/app.module';
import { GRANTABLE } from '../src/auth/permission-catalogue';
import { TenantDb } from '../src/shared/database/tenant-db.service';

const ACCOUNTANT_MEMBER = 'c0000000-0000-0000-0000-0000000000a5';
const OWNER_MEMBER = 'c0000000-0000-0000-0000-0000000000a1';

describe('Roles the owner creates (e2e, Phase H4)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const login = async (who: string, email: string) => { token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken; };
  const run = `${Date.now()}`.slice(-6);
  let builtIn: Record<string, string> = {};
  let manager = '';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    await login('ownerA', 'owner.a@demo.test');
    await login('acct', 'accountant.a@demo.test');
    builtIn = Object.fromEntries((await http().get('/staff/roles').set(as('ownerA')).expect(200)).body.map((r: { key: string; id: string }) => [r.key, r.id]));
  });
  afterAll(async () => {
    // the accountant gets their role back, whatever happened above
    await http().patch(`/staff/members/${ACCOUNTANT_MEMBER}`).set(as('ownerA')).send({ roleId: builtIn.accountant });
    await app.close();
  });

  it('the API and the database offer the same permissions; never "*"', async () => {
    const groups = (await http().get('/staff/permissions').set(as('ownerA')).expect(200)).body;
    const offered = groups.flatMap((g: { permissions: { key: string }[] }) => g.permissions.map((p) => p.key));
    const { rows } = await sql<{ p: string[] }>`select grantable_permissions() as p`.execute(app.get(TenantDb).platform());
    expect([...offered].sort()).toEqual([...rows[0].p].sort());
    expect([...offered].sort()).toEqual([...GRANTABLE].sort());
    expect(offered).not.toContain('*');
    await http().get('/staff/permissions').set(as('acct')).expect(403); // staff:manage
  });

  it('the owner creates a role from the catalogue; only the owner role is fixed', async () => {
    const r = (await http().post('/staff/roles').set(as('ownerA'))
      .send({ nameAr: `مدير الفرع ${run}`, permissions: ['staff:manage', 'patients:read', 'appointments:read', 'patients:read'] }).expect(201)).body;
    manager = r.id;
    expect(r).toMatchObject({ is_system: false, permissions: ['appointments:read', 'patients:read', 'staff:manage'], members: 0, can: { edit: true, remove: true } });
    expect(r.key).toMatch(/^custom-/);
    const bad = (body: object) => http().post('/staff/roles').set(as('ownerA')).send(body);
    expect((await bad({ nameAr: `كل شيء ${run}`, permissions: ['*'] }).expect(400)).body).toMatchObject({ code: 'permission_unknown', permission: '*' });
    expect((await bad({ nameAr: `كاتب ${run}`, permissions: ['patients:write'] }).expect(400)).body).toMatchObject({ code: 'permission_requires', requires: 'patients:read' });
    expect((await bad({ nameAr: `مدير الفرع ${run}`, permissions: [] }).expect(409)).body.code).toBe('role_name_taken');
    expect((await http().patch(`/staff/roles/${builtIn.owner}`).set(as('ownerA')).send({ permissions: ['patients:read'] }).expect(409)).body.code).toBe('owner_role_fixed');
    expect((await http().delete(`/staff/roles/${builtIn.owner}`).set(as('ownerA')).expect(409)).body.code).toBe('owner_role_fixed');
    // the old starter roles are the clinic's own: the owner edits them, and deletes them once nobody holds them
    const rec = (await http().get('/staff/roles').set(as('ownerA')).expect(200)).body.find((x: { id: string }) => x.id === builtIn.receptionist);
    expect(rec).toMatchObject({ is_system: false, can: { edit: true, remove: true } });
    await http().patch(`/staff/roles/${builtIn.receptionist}`).set(as('ownerA')).send({ nameAr: rec.name_ar }).expect(200);
    expect((await http().delete(`/staff/roles/${builtIn.doctor}`).set(as('ownerA')).expect(409)).body.code).toBe('role_in_use');
    // mixing clinical and money writing is allowed with a warning (owner 2026-10-20)
    const mixed = (await bad({ nameAr: `طبيب ومحصل ${run}`, permissions: ['patients:read', 'clinical:read', 'clinical:write', 'invoices:read', 'payments:write'] }).expect(201)).body;
    expect(mixed.mixes_clinical_and_money).toBe(true);
    expect((await http().delete(`/staff/roles/${mixed.id}`).set(as('ownerA')).expect(200)).body).toEqual({ archived: false }); // nobody ever held it
  });

  it('a member given the role gets exactly its permissions, from the next request on', async () => {
    await http().patch(`/staff/members/${ACCOUNTANT_MEMBER}`).set(as('ownerA')).send({ roleId: manager }).expect(200);
    expect((await http().get('/invoices').set(as('acct')).expect(401)).body.code).toBe('access_changed'); // the old token stops at once
    await login('acct', 'accountant.a@demo.test');
    await http().get('/invoices').set(as('acct')).expect(403);
    await http().get('/expenses').set(as('acct')).expect(403);
    await http().get('/patients').set(as('acct')).expect(200);
    await http().get('/staff/roles').set(as('acct')).expect(200);
    expect((await http().delete(`/staff/roles/${manager}`).set(as('ownerA')).expect(409)).body.code).toBe('role_in_use');
  });

  it('a manager who is not the owner cannot raise anyone\'s rights, their own included', async () => {
    const tryRole = (perms: string[]) => http().post('/staff/roles').set(as('acct')).send({ nameAr: `دور ${perms.length} ${run}`, permissions: perms });
    expect((await tryRole(['patients:read', 'invoices:read']).expect(403)).body).toMatchObject({ code: 'permission_not_held', permission: 'invoices:read' });
    const small = (await tryRole(['patients:read']).expect(201)).body;
    expect((await http().patch(`/staff/roles/${small.id}`).set(as('acct')).send({ permissions: ['patients:read', 'cash:operate'] }).expect(403)).body.code)
      .toBe('permission_not_held');
    // not their own role, not their own membership, not an owner, not a role with more than they hold
    expect((await http().patch(`/staff/roles/${manager}`).set(as('acct')).send({ permissions: ['staff:manage'] }).expect(403)).body.code).toBe('own_role');
    expect((await http().patch(`/staff/members/${ACCOUNTANT_MEMBER}`).set(as('acct')).send({ roleId: small.id }).expect(403)).body.code).toBe('own_role');
    expect((await http().patch(`/staff/members/${OWNER_MEMBER}`).set(as('acct')).send({ status: 'disabled' }).expect(403)).body.code).toBe('owner_role_only');
    expect((await http().post('/staff/invitations').set(as('acct')).send({ email: `boss${run}@demo.test`, roleId: builtIn.owner }).expect(403)).body.code)
      .toBe('owner_role_only');
    expect((await http().post('/staff/invitations').set(as('acct')).send({ email: `rec${run}@demo.test`, roleId: builtIn.receptionist }).expect(403)).body.code)
      .toBe('permission_not_held');
    const listed = (await http().get('/staff/roles').set(as('acct')).expect(200)).body;
    expect(listed.find((r: { id: string }) => r.id === manager).can).toEqual({ edit: false, remove: false });
    expect((await http().delete(`/staff/roles/${small.id}`).set(as('acct')).expect(200)).body).toEqual({ archived: false });
  });

  it('the owner widens the role: it applies on the member\'s next request', async () => {
    await http().patch(`/staff/roles/${manager}`).set(as('ownerA')).send({ permissions: ['staff:manage', 'patients:read', 'appointments:read', 'invoices:read'] }).expect(200);
    expect((await http().get('/patients').set(as('acct')).expect(401)).body.code).toBe('access_changed');
    await login('acct', 'accountant.a@demo.test');
    await http().get('/invoices').set(as('acct')).expect(200);
  });

  it('a role past invitations or members still refer to is archived, not deleted, and given to nobody new', async () => {
    await http().patch(`/staff/members/${ACCOUNTANT_MEMBER}`).set(as('ownerA')).send({ roleId: builtIn.accountant }).expect(200);
    const inv = (await http().post('/staff/invitations').set(as('ownerA')).send({ email: `mgr${run}@demo.test`, roleId: manager }).expect(201)).body;
    expect((await http().delete(`/staff/roles/${manager}`).set(as('ownerA')).expect(409)).body).toMatchObject({ code: 'role_in_use', invitations: 1 });
    await http().post(`/staff/invitations/${inv.id}/revoke`).set(as('ownerA')).expect(204);
    expect((await http().delete(`/staff/roles/${manager}`).set(as('ownerA')).expect(200)).body).toEqual({ archived: true });
    const r = (await http().get('/staff/roles').set(as('ownerA')).expect(200)).body.find((x: { id: string }) => x.id === manager);
    expect(r.archived_at).not.toBeNull();
    expect((await http().patch(`/staff/members/${ACCOUNTANT_MEMBER}`).set(as('ownerA')).send({ roleId: manager }).expect(409)).body.code).toBe('role_archived');
    expect((await http().patch(`/staff/roles/${manager}`).set(as('ownerA')).send({ nameAr: 'اسم جديد' }).expect(409)).body.code).toBe('role_archived');
  });
});
