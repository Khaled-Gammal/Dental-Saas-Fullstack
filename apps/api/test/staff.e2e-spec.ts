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

const NASR = 'd0000000-0000-0000-0000-0000000000a1';
const MAADI = 'd0000000-0000-0000-0000-0000000000a2';
const today = () => new Date().toISOString().slice(0, 10);
const cookieOf = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith('rt='))?.split(';')[0];

describe('Staff: invitations, members, access changes, password reset (e2e, Phase D1)', () => {
  let app: INestApplication;
  let mail: DevEmailSender;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const as = (who: string) => bearer(token[who]);
  const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const linkTo = (email: string) => /#\/invite\/([A-Za-z0-9_-]+)/.exec(mail.outbox.get(email)?.text ?? '')?.[1] ?? '';
  const codeFor = (email: string) => /(\d{6})/.exec(mail.outbox.get(email)?.text ?? '')?.[1] ?? '';
  let roles: Record<string, string> = {};
  let legalIds: string[] = []; // H6: staff accept the Terms and Privacy when they join (an invited owner the DPA too)

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    mail = app.get(EMAIL_SENDER);
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
    legalIds = (await http().get('/public/legal').expect(200)).body.map((d: { id: string }) => d.id);
    roles = Object.fromEntries((await http().get('/staff/roles').set(as('ownerA')).expect(200)).body.map((r: { key: string; id: string }) => [r.key, r.id]));
  });
  afterAll(async () => { await app.close(); });

  it('staff management is the owner\'s: reception is refused', async () => {
    expect((await http().get('/staff/members').set(as('receptionA')).expect(403)).body.code).toBe('missing_permission');
    const members = (await http().get('/staff/members').set(as('ownerA')).expect(200)).body;
    expect(members.find((m: { user: { email: string } }) => m.user.email === 'reception.maadi@demo.test'))
      .toMatchObject({ all_branches: false, branch_ids: [MAADI], role: { key: 'receptionist' } });
  });

  describe('a new receptionist for Maadi', () => {
    const email = `maadi.${run}@staff.test`;
    let link: string;
    let session: { token: string; cookie: string };
    let memberId: string;
    // frees clinic B's staff seat (the Basic plan allows 5): the test database keeps members, and repeated runs filled it
    afterAll(async () => {
      const inB = (await http().get('/staff/members').set(as('ownerB')).expect(200)).body.find((m: { user: { email: string } }) => m.user.email === email);
      if (inB) await http().patch(`/staff/members/${inB.id}`).set(as('ownerB')).send({ status: 'disabled' }).expect(200);
    });

    it('is invited by email; the same email cannot be invited twice, nor an existing member', async () => {
      const inv = await http().post('/staff/invitations').set(as('ownerA'))
        .send({ email, roleId: roles.receptionist, allBranches: false, branchIds: [MAADI], jobTitle: 'استقبال' }).expect(201);
      expect(inv.body).toMatchObject({ email, branch_ids: [MAADI], role: { key: 'receptionist' }, expired: false });
      expect(mail.outbox.get(email)?.subject).toContain('دعوة للانضمام');
      link = linkTo(email);
      expect(link).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect((await http().post('/staff/invitations').set(as('ownerA')).send({ email, roleId: roles.receptionist }).expect(409)).body.code)
        .toBe('invitation_pending');
      expect((await http().post('/staff/invitations').set(as('ownerA')).send({ email: 'reception.a@demo.test', roleId: roles.receptionist }).expect(409)).body.code)
        .toBe('already_member');
    });

    it('the link shows the clinic and role, nothing else; a bad link is refused', async () => {
      const p = (await http().get(`/public/invitations/${link}`).expect(200)).body;
      expect(p).toMatchObject({ clinic: { slug: 'clinic-a' }, role: { key: 'receptionist' }, email, accountExists: false, allBranches: false });
      expect((await http().get(`/public/invitations/${'x'.repeat(43)}`).expect(404)).body.code).toBe('invitation_invalid');
    });

    it('accepting with a weak password changes nothing; then joins once, signed in', async () => {
      expect((await http().post(`/public/invitations/${link}/accept`).send({ fullName: 'Rana Adel', password: 'short', acceptedDocuments: legalIds }).expect(400)).body.code)
        .toBe('weak_password');
      const res = await http().post(`/public/invitations/${link}/accept`).send({ fullName: 'Rana Adel', password: 'Secret123', acceptedDocuments: legalIds }).expect(200);
      expect(res.body.clinic).toMatchObject({ slug: 'clinic-a', role: 'receptionist' });
      session = { token: res.body.accessToken, cookie: cookieOf(res)! };
      expect((await http().post(`/public/invitations/${link}/accept`).send({ fullName: 'Rana Adel', password: 'Secret123', acceptedDocuments: legalIds }).expect(404)).body.code)
        .toBe('invitation_invalid');
      await http().post('/auth/login').send({ identifier: email, password: 'Secret123' }).expect(200); // email proven by the link
      memberId = (await http().get('/staff/members').set(as('ownerA')).expect(200)).body.find((m: { user: { email: string } }) => m.user.email === email).id;
    });

    it('works at Maadi only', async () => {
      expect((await http().get('/appointments').query({ date: today(), branchId: NASR }).set(bearer(session.token)).expect(403)).body.code).toBe('branch_forbidden');
      await http().get('/appointments').query({ date: today(), branchId: MAADI }).set(bearer(session.token)).expect(200);
    });

    it('a change by the owner applies on her next request; a refresh brings the new rights', async () => {
      await http().patch(`/staff/members/${memberId}`).set(as('ownerA')).send({ allBranches: true }).expect(200);
      expect((await http().get('/appointments').query({ date: today() }).set(bearer(session.token)).expect(401)).body.code).toBe('access_changed');
      const fresh = await http().post('/auth/refresh').set('Cookie', session.cookie).expect(200);
      session = { token: fresh.body.accessToken, cookie: cookieOf(fresh)! };
      await http().get('/appointments').query({ date: today(), branchId: NASR }).set(bearer(session.token)).expect(200);
    });

    it('once disabled she is out at once, and cannot refresh back in', async () => {
      await http().patch(`/staff/members/${memberId}`).set(as('ownerA')).send({ status: 'disabled' }).expect(200);
      expect((await http().get('/patients').set(bearer(session.token)).expect(401)).body.code).toBe('access_revoked');
      await http().post('/auth/refresh').set('Cookie', session.cookie).expect(401);
    });

    it('an existing account joins a second clinic with its own password', async () => {
      const ownerRoleB = await roleOf('ownerB', 'owner'); // the Basic demo clinic seeds only the owner role
      await http().post('/staff/invitations').set(as('ownerB')).send({ email, roleId: ownerRoleB }).expect(201);
      const link2 = linkTo(email);
      expect((await http().get(`/public/invitations/${link2}`).expect(200)).body).toMatchObject({ accountExists: true, clinic: { slug: 'clinic-b' } });
      expect((await http().post(`/public/invitations/${link2}/accept`).send({ password: 'Wrong1234', acceptedDocuments: legalIds }).expect(401)).body.code).toBe('invalid_credentials');
      const ok = await http().post(`/public/invitations/${link2}/accept`).send({ password: 'Secret123', acceptedDocuments: legalIds }).expect(200); // a wrong password did not use the link
      expect(ok.body.clinic).toMatchObject({ slug: 'clinic-b', role: 'owner' }); // the Basic demo clinic seeds only the owner role
    });

    it('resets a forgotten password by email; old sessions end', async () => {
      const signedIn = await http().post('/auth/login').send({ identifier: email, password: 'Secret123', clinic: 'clinic-b' }).expect(200);
      const before = cookieOf(signedIn)!;
      expect((await http().get('/patients').set(bearer(signedIn.body.accessToken))).status).not.toBe(401); // 200, or 403 while a document waits
      await new Promise((r) => setTimeout(r, 1100)); // token times are in seconds: the reset must come a second later
      await http().post('/auth/password/forgot').send({ email }).expect(202);
      expect(mail.outbox.get(email)?.subject).toBe('رمز إعادة تعيين كلمة المرور');
      const code = codeFor(email);
      const wrong = code === '000000' ? '111111' : '000000';
      await http().post('/auth/password/reset').send({ email, code: wrong, password: 'NewSecret456' }).expect(400);
      await http().post('/auth/password/reset').send({ email, code, password: 'NewSecret456' }).expect(204);
      await http().post('/auth/refresh').set('Cookie', before).expect(401);
      // review R11: the access token handed out before the reset stops at once, not when it expires
      expect((await http().get('/patients').set(bearer(signedIn.body.accessToken)).expect(401)).body.code).toBe('session_revoked');
      await http().post('/auth/login').send({ identifier: email, password: 'Secret123', clinic: 'clinic-b' }).expect(401);
      const after = await http().post('/auth/login').send({ identifier: email, password: 'NewSecret456', clinic: 'clinic-b' }).expect(200);
      expect((await http().get('/patients').set(bearer(after.body.accessToken))).status).not.toBe(401); // a new sign-in works
      const ghost = `nobody.${run}@staff.test`;
      await http().post('/auth/password/forgot').send({ email: ghost }).expect(202);
      expect(mail.outbox.get(ghost)).toBeUndefined();
    });
  });

  async function roleOf(who: string, key: string): Promise<string> {
    return (await http().get('/staff/roles').set(as(who)).expect(200)).body.find((r: { key: string }) => r.key === key).id;
  }

  it('the clinic always keeps an active owner', async () => {
    const owner = (await http().get('/staff/members').set(as('ownerA')).expect(200)).body.find((m: { role: { key: string } }) => m.role.key === 'owner');
    expect((await http().patch(`/staff/members/${owner.id}`).set(as('ownerA')).send({ status: 'disabled' }).expect(409)).body.code).toBe('last_owner');
    expect((await http().patch(`/staff/members/${owner.id}`).set(as('ownerA')).send({ roleId: roles.receptionist }).expect(409)).body.code).toBe('last_owner');
  });

  it('a revoked or re-sent invitation link stops working', async () => {
    const email = `revoke.${run}@staff.test`;
    const inv = (await http().post('/staff/invitations').set(as('ownerA')).send({ email, roleId: roles.receptionist }).expect(201)).body;
    const first = linkTo(email);
    await http().post(`/staff/invitations/${inv.id}/resend`).set(as('ownerA')).expect(200);
    const second = linkTo(email);
    expect(second).not.toBe(first);
    await http().get(`/public/invitations/${first}`).expect(404);
    await http().get(`/public/invitations/${second}`).expect(200);
    await http().post(`/staff/invitations/${inv.id}/revoke`).set(as('ownerA')).expect(204);
    await http().get(`/public/invitations/${second}`).expect(404);
    await http().post(`/staff/invitations/${inv.id}/resend`).set(as('ownerA')).expect(404);
    expect((await http().get('/staff/invitations').set(as('ownerA')).expect(200)).body.map((i: { id: string }) => i.id)).not.toContain(inv.id);
  });

  it('an invitation can give a doctor record its login, once', async () => {
    const doctor = (await http().post('/doctors').set(as('ownerA')).send({ nameAr: `د. ${run}`, branchIds: [NASR] }).expect(201)).body;
    const email = `doctor.${run}@staff.test`;
    await http().post('/staff/invitations').set(as('ownerA')).send({ email, roleId: roles.doctor, doctorId: doctor.id }).expect(201);
    await http().post(`/public/invitations/${linkTo(email)}/accept`).send({ fullName: 'Dr Invited', password: 'Secret123', acceptedDocuments: legalIds }).expect(200);
    const m = (await http().get('/staff/members').set(as('ownerA')).expect(200)).body.find((x: { user: { email: string } }) => x.user.email === email);
    expect(m.doctor).toMatchObject({ id: doctor.id });
    expect((await http().post('/staff/invitations').set(as('ownerA')).send({ email: `other.${run}@staff.test`, roleId: roles.doctor, doctorId: doctor.id }).expect(409)).body.code)
      .toBe('doctor_already_linked');
    await http().patch(`/doctors/${doctor.id}`).set(as('ownerA')).send({ isActive: false }).expect(200); // leave the doctor seats free
    await http().patch(`/staff/members/${m.id}`).set(as('ownerA')).send({ status: 'disabled' }).expect(200);
  });

  it('invitations count against the plan\'s staff seats (clinic B is on Basic: 5)', async () => {
    const accountant = await roleOf('ownerB', 'owner'); // the only seeded role in clinic B
    const used = (await http().get('/staff/members').set(as('ownerB')).expect(200)).body.filter((m: { status: string }) => m.status === 'active').length
      + (await http().get('/staff/invitations').set(as('ownerB')).expect(200)).body.filter((i: { expired: boolean }) => !i.expired).length;
    for (let i = used; i < 5; i++) await http().post('/staff/invitations').set(as('ownerB')).send({ email: `seat${i}.${run}@staff.test`, roleId: accountant }).expect(201);
    const over = await http().post('/staff/invitations').set(as('ownerB')).send({ email: `over.${run}@staff.test`, roleId: accountant }).expect(403);
    expect(over.body).toMatchObject({ code: 'plan_limit_reached', resource: 'staff', limit: 5 });
    for (const i of (await http().get('/staff/invitations').set(as('ownerB')).expect(200)).body) {
      await http().post(`/staff/invitations/${i.id}/revoke`).set(as('ownerB')).expect(204); // free the seats for reruns
    }
  });

  it('another clinic\'s members and invitations are out of reach', async () => {
    const member = (await http().get('/staff/members').set(as('ownerA')).expect(200)).body[0];
    await http().get(`/staff/members/${member.id}`).set(as('ownerB')).expect(404);
    await http().patch(`/staff/members/${member.id}`).set(as('ownerB')).send({ jobTitle: 'x' }).expect(404);
  });
});
