import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
// Runs against the test database rebuilt by `pnpm db:test` (turbo runs it first in `pnpm test`).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.RATE_LIMIT_ENABLED = 'false'; // per-IP throttles off: every test request comes from 127.0.0.1
process.env.REFRESH_RACE_GRACE_MS = '1000'; // short two-tabs grace so the reuse test waits 1 s, not 10
// eslint-disable-next-line import/first
import { AppModule } from '../src/app.module';
// eslint-disable-next-line import/first
import type { DevSmsSender } from '../src/shared/notifications/dev-sms.sender';
// eslint-disable-next-line import/first
import { SMS_SENDER } from '../src/shared/notifications/ports';

const cookieOf = (res: request.Response) => {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith('rt='))?.split(';')[0];
};

describe('Identity: sign-up, verify, login, sessions (e2e)', () => {
  let app: INestApplication;
  let sms: DevSmsSender;
  const run = Date.now().toString().slice(-7);
  const phoneLocal = `0101${run}`; // Egyptian local format, normalised to +20...
  const phone = `+20101${run}`;
  const email = `owner.${run}@signup.test`;
  const slug = `clinic-${run}`;
  const lastCode = () => /(\d{6})/.exec(sms.outbox.get(phone) ?? '')?.[1] ?? '';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    sms = app.get(SMS_SENDER);
  });
  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('checks subdomain availability', async () => {
    expect((await http().get(`/auth/slug-available?slug=${slug}`).expect(200)).body.available).toBe(true);
    expect((await http().get('/auth/slug-available?slug=clinic-a').expect(200)).body.available).toBe(false);
    expect((await http().get('/auth/slug-available?slug=admin').expect(200)).body.available).toBe(false);
  });

  it('rejects a weak password and a bad phone', async () => {
    const base = { fullName: 'Dr Test', email, clinicNameAr: 'عيادة', slug };
    await http().post('/auth/signup').send({ ...base, phone: phoneLocal, password: 'onlyletters' }).expect(400);
    await http().post('/auth/signup').send({ ...base, phone: '12', password: 'Secret123' }).expect(400);
    // Arabic-Indic digits are digits, not letters: eight of them are still a weak password
    const arabicDigits = await http().post('/auth/signup').send({ ...base, phone: phoneLocal, password: '١٢٣٤٥٦٧٨' }).expect(400);
    expect(arabicDigits.body.code).toBe('weak_password');
  });

  it('signs up: creates the clinic and texts a code', async () => {
    const res = await http().post('/auth/signup').send({
      fullName: 'Dr Test Owner', email, phone: phoneLocal, password: 'Secret123',
      clinicNameAr: 'عيادة الاختبار', clinicNameEn: 'Test Clinic', slug,
    }).expect(201);
    expect(res.body.next).toBe('verify_phone');
    expect(res.body.website).toContain(`${slug}.`);
    expect(lastCode()).toMatch(/^\d{6}$/);
  });

  it('refuses a second account with the same email or a taken subdomain', async () => {
    const dup = await http().post('/auth/signup').send({
      fullName: 'Dr Duplicate', email, phone: '+201099999999', password: 'Secret123', clinicNameAr: 'عيادة', slug: `other-${run}`,
    }).expect(409);
    expect(dup.body.code).toBe('account_exists');
    const taken = await http().post('/auth/signup').send({
      fullName: 'Dr Duplicate', email: `x.${run}@signup.test`, phone: '+201088888888', password: 'Secret123', clinicNameAr: 'عيادة', slug,
    }).expect(409);
    expect(taken.body.code).toBe('slug_taken');
  });

  it('blocks login until the phone is verified', async () => {
    const res = await http().post('/auth/login').send({ identifier: email, password: 'Secret123' }).expect(403);
    expect(res.body.code).toBe('phone_not_verified');
    expect(res.body.phone).toBe(phone);
  });

  it('verifies the phone: a wrong code fails, the right one signs in', async () => {
    const wrong = lastCode() === '000000' ? '111111' : '000000';
    expect((await http().post('/auth/verify-phone').send({ phone, code: wrong }).expect(400)).body.code).toBe('otp_invalid');
    const res = await http().post('/auth/verify-phone').send({ phone, code: lastCode() }).expect(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeUndefined(); // only in the cookie
    expect(res.body.clinic).toMatchObject({ slug, role: 'owner', status: 'trialing' });
    expect(cookieOf(res)).toBeTruthy();
    // the code works only once, and every other open code for this phone is void too
    const again = await http().post('/auth/verify-phone').send({ phone, code: lastCode() }).expect(400);
    expect(again.body.code).toBe('otp_expired');
  });

  it('the new owner sees only their own clinic', async () => {
    const login = await http().post('/auth/login').send({ identifier: phoneLocal, password: 'Secret123' }).expect(200);
    const branches = await http().get('/branches').set('Authorization', `Bearer ${login.body.accessToken}`).expect(200);
    expect(branches.body.map((b: { slug: string }) => b.slug)).toEqual(['main']);
  });

  it('wrong password -> 401 with a generic message', async () => {
    const res = await http().post('/auth/login').send({ identifier: email, password: 'Wrong1234' }).expect(401);
    expect(res.body.code).toBe('invalid_credentials');
    await http().post('/auth/login').send({ identifier: `nobody.${run}@x.test`, password: 'Wrong1234' }).expect(401);
  });

  it('rotates refresh tokens and ends the session when an old one is reused', async () => {
    const login = await http().post('/auth/login').send({ identifier: email, password: 'Secret123' }).expect(200);
    const first = cookieOf(login)!;
    const r1 = await http().post('/auth/refresh').set('Cookie', first).expect(200);
    const second = cookieOf(r1)!;
    expect(second).not.toBe(first);
    expect(r1.body.accessToken).toBeTruthy();

    await new Promise((r) => setTimeout(r, 1_200)); // past the two-tabs grace window
    const reuse = await http().post('/auth/refresh').set('Cookie', first).expect(401);
    expect(reuse.body.code).toBe('session_revoked');
    // the whole family is gone, including the newer token
    await http().post('/auth/refresh').set('Cookie', second).expect(401);
  });

  it('logout ends the session, including older tokens of the same login', async () => {
    const login = await http().post('/auth/login').send({ identifier: email, password: 'Secret123' }).expect(200);
    const first = cookieOf(login)!;
    const second = cookieOf(await http().post('/auth/refresh').set('Cookie', first).expect(200))!;
    await http().post('/auth/logout').set('Cookie', second).expect(204);
    await http().post('/auth/refresh').set('Cookie', second).expect(401);
    await new Promise((r) => setTimeout(r, 1_200));
    expect((await http().post('/auth/refresh').set('Cookie', first).expect(401)).body.code).toBe('session_revoked');
  });

  it('a malformed session cookie is treated as signed out (401, not 500)', async () => {
    await http().post('/auth/refresh').set('Cookie', 'rt=%E0%A4%A').expect(401);
  });

  describe('limits on a second new clinic', () => {
    const run2 = (Number(run) + 1).toString().padStart(7, '0').slice(-7);
    const phone2 = `+20102${run2}`;
    const email2 = `owner2.${run2}@signup.test`;
    const code2 = () => /(\d{6})/.exec(sms.outbox.get(phone2) ?? '')?.[1] ?? '';

    it('signs up', async () => {
      await http().post('/auth/signup').send({
        fullName: 'Dr Second', email: email2, phone: phone2, password: 'Secret123', clinicNameAr: 'عيادة ثانية', slug: `second-${run2}`,
      }).expect(201);
    });

    it('locks a code after 5 wrong tries, even for the right code', async () => {
      const right = code2();
      const wrong = right === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) await http().post('/auth/verify-phone').send({ phone: phone2, code: wrong }).expect(400);
      expect((await http().post('/auth/verify-phone').send({ phone: phone2, code: right }).expect(429)).body.code).toBe('otp_locked');
    });

    it('a new code works, and Arabic-Indic digits are accepted', async () => {
      await http().post('/auth/otp/resend').send({ phone: phone2 }).expect(202);
      const arabic = code2().replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
      await http().post('/auth/verify-phone').send({ phone: phone2, code: arabic }).expect(200);
    });

    it('locks login after 10 attempts from the same device, even with the right password', async () => {
      for (let i = 0; i < 10; i++) {
        await http().post('/auth/login').send({ identifier: email2, password: 'Wrong1234' }).expect(401);
      }
      expect((await http().post('/auth/login').send({ identifier: email2, password: 'Secret123' }).expect(429)).body.code)
        .toBe('login_locked');
    });
  });

  it('limits code sends to 3 per 10 minutes per phone', async () => {
    const run3 = (Number(run) + 2).toString().padStart(7, '0').slice(-7);
    const phone3 = `+20106${run3}`;
    await http().post('/auth/signup').send({
      fullName: 'Dr Third', email: `owner3.${run3}@signup.test`, phone: phone3, password: 'Secret123',
      clinicNameAr: 'عيادة ثالثة', slug: `third-${run3}`,
    }).expect(201); // send 1
    await http().post('/auth/otp/resend').send({ phone: phone3 }).expect(202); // send 2
    await http().post('/auth/otp/resend').send({ phone: phone3 }).expect(202); // send 3
    expect((await http().post('/auth/otp/resend').send({ phone: phone3 }).expect(429)).body.code).toBe('otp_rate_limited');
  });

  it('an unknown clinic slug at login is an error, not a silent switch', async () => {
    const res = await http().post('/auth/login').send({ identifier: 'owner.a@demo.test', password: 'Demo@12345', clinic: 'clinic-b' }).expect(403);
    expect(res.body.code).toBe('clinic_not_found');
  });

  it('seeded demo accounts log in with Demo@12345', async () => {
    const res = await http().post('/auth/login').send({ identifier: 'reception.a@demo.test', password: 'Demo@12345' }).expect(200);
    expect(res.body.clinic).toMatchObject({ slug: 'clinic-a', role: 'receptionist' });
  });
});
