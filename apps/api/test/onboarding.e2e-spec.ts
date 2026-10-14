import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
// eslint-disable-next-line import/first
import { AppModule } from '../src/app.module';

const NASR = 'd0000000-0000-0000-0000-0000000000a1';
const MAADI = 'd0000000-0000-0000-0000-0000000000a2';
const HELIOPOLIS_B = 'd0000000-0000-0000-0000-0000000000b1'; // clinic B's branch

describe('Onboarding: profile, branches, hours (e2e)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
  });

  afterAll(async () => {
    // leave the seed as we found it: Nasr City is the main branch
    await http().post(`/branches/${NASR}/main`).set(as('ownerA'));
    await app.close();
  });

  describe('clinic profile', () => {
    it('reads the clinic profile', async () => {
      const res = await http().get('/clinic/profile').set(as('receptionA')).expect(200);
      expect(res.body).toMatchObject({ slug: 'clinic-a' });
      expect(res.body.brandColor).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('owner updates it; phones are stored as E.164; brand colour is saved', async () => {
      const res = await http().patch('/clinic/profile').set(as('ownerA'))
        .send({ aboutAr: 'رعاية متكاملة للأسنان', whatsapp: '٠١٠١٢٣٤٥٦٧٨', brandColor: '#0E9AA7' }).expect(200);
      expect(res.body).toMatchObject({ aboutAr: 'رعاية متكاملة للأسنان', whatsapp: '+201012345678', brandColor: '#0e9aa7' });
      const site = await http().get('/public/site?host=clinic-a.lvh.me').expect(200);
      expect(site.body.clinic.about_ar).toBe('رعاية متكاملة للأسنان');
    });

    it('rejects a colour that is not #rrggbb, unknown fields, and receptionists', async () => {
      expect((await http().patch('/clinic/profile').set(as('ownerA')).send({ brandColor: 'red;x' }).expect(400)).body.code).toBe('validation_failed');
      await http().patch('/clinic/profile').set(as('ownerA')).send({ status: 'active' }).expect(400); // .strict(): no mass assignment
      expect((await http().patch('/clinic/profile').set(as('receptionA')).send({ aboutAr: 'x x' }).expect(403)).body.code).toBe('missing_permission');
    });

    it('a clinic must keep at least one name', async () => {
      const res = await http().patch('/clinic/profile').set(as('ownerB')).send({ nameAr: null, nameEn: null }).expect(422);
      expect(res.body.code).toBe('rule_violation');
    });
  });

  describe('website publish', () => {
    it('a draft colour is not live until published; publish makes it live and clears pendingChanges', async () => {
      await http().patch('/clinic/profile').set(as('ownerA')).send({ brandColor: '#123456' }).expect(200);
      expect((await http().get('/clinic/website').set(as('ownerA')).expect(200)).body.pendingChanges).toBe(true);
      expect((await http().get('/clinic/onboarding').set(as('ownerA')).expect(200)).body.pendingChanges).toBe(true);
      expect((await http().get('/public/site?host=clinic-a.lvh.me').expect(200)).body.theme.primary).not.toBe('#123456');

      await http().post('/clinic/website/publish').set(as('receptionA')).expect(403);
      const pub = await http().post('/clinic/website/publish').set(as('ownerA')).expect(200);
      expect(pub.body).toMatchObject({ status: 'published', pendingChanges: false });
      expect(pub.body.version).toBeGreaterThan(1);
      expect((await http().get('/public/site?host=clinic-a.lvh.me').expect(200)).body.theme.primary).toBe('#123456');
    });
  });

  describe('onboarding checklist', () => {
    it('is derived from the data', async () => {
      const res = await http().get('/clinic/onboarding').set(as('ownerA')).expect(200);
      expect(res.body).toEqual({
        profile: expect.any(Boolean), branches: true, hours: true, doctors: expect.any(Boolean),
        services: expect.any(Boolean), published: expect.any(Boolean), pendingChanges: expect.any(Boolean),
      });
    });
  });

  describe('branches and hours', () => {
    it('lists branches with their hours, main first', async () => {
      const res = await http().get('/branches').set(as('ownerA')).expect(200);
      expect(res.body[0].is_main).toBe(true);
      expect(res.body[0].hours[0]).toEqual({ weekday: expect.any(Number), opens_at: expect.stringMatching(/^\d\d:\d\d$/), closes_at: expect.any(String) });
    });

    it('replaces the whole week in one save (split shifts, closed days)', async () => {
      const week = { days: [
        { weekday: 6, shifts: [{ opens: '09:00', closes: '13:00' }, { opens: '13:00', closes: '17:00' }] },
        { weekday: 0, shifts: [{ opens: '16:00', closes: '22:00' }] },
        { weekday: 5, shifts: [] },
      ] };
      const res = await http().put(`/branches/${MAADI}/hours`).set(as('ownerA')).send(week).expect(200);
      expect(res.body.hours).toEqual([
        { weekday: 0, opens_at: '16:00', closes_at: '22:00' },
        { weekday: 6, opens_at: '09:00', closes_at: '13:00' },
        { weekday: 6, opens_at: '13:00', closes_at: '17:00' },
      ]);
    });

    it('rejects overlapping or inverted shifts and leaves the old week untouched', async () => {
      const bad = await http().put(`/branches/${MAADI}/hours`).set(as('ownerA'))
        .send({ days: [{ weekday: 1, shifts: [{ opens: '10:00', closes: '14:00' }, { opens: '13:00', closes: '15:00' }] }] }).expect(400);
      expect(bad.body.code).toBe('validation_failed');
      await http().put(`/branches/${MAADI}/hours`).set(as('ownerA'))
        .send({ days: [{ weekday: 1, shifts: [{ opens: '18:00', closes: '09:00' }] }] }).expect(400);
      await http().put(`/branches/${MAADI}/hours`).set(as('ownerA'))
        .send({ days: [{ weekday: 1, shifts: [] }, { weekday: 1, shifts: [] }] }).expect(400); // a day twice
      const now = await http().get(`/branches/${MAADI}`).set(as('ownerA')).expect(200);
      expect(now.body.hours).toHaveLength(3);
    });

    it('another clinic\'s branch does not exist for you (404, not 403)', async () => {
      await http().get(`/branches/${HELIOPOLIS_B}`).set(as('ownerA')).expect(404);
      await http().put(`/branches/${HELIOPOLIS_B}/hours`).set(as('ownerA')).send({ days: [] }).expect(404);
      await http().patch(`/branches/${HELIOPOLIS_B}`).set(as('ownerA')).send({ city: 'Hacked' }).expect(404);
      await http().get('/branches/not-a-uuid').set(as('ownerA')).expect(400);
    });

    it('edits a branch and switches the main branch atomically', async () => {
      const edited = await http().patch(`/branches/${MAADI}`).set(as('ownerA')).send({ addressAr: '9 شارع 9، المعادي', whatsapp: '01098765432' }).expect(200);
      expect(edited.body).toMatchObject({ address_ar: '9 شارع 9، المعادي', whatsapp: '+201098765432' });
      const list = await http().post(`/branches/${MAADI}/main`).set(as('ownerA')).expect(200);
      expect(list.body.filter((b: { is_main: boolean }) => b.is_main).map((b: { id: string }) => b.id)).toEqual([MAADI]);
    });

    it('the main branch cannot be switched off', async () => {
      const res = await http().patch(`/branches/${MAADI}`).set(as('ownerA')).send({ isActive: false }).expect(409);
      expect(res.body.code).toBe('main_branch_inactive');
    });

    it('blank text clears a field instead of counting as filled in', async () => {
      const res = await http().patch('/clinic/profile').set(as('ownerB')).send({ aboutEn: '   ' }).expect(200);
      expect(res.body.aboutEn).toBeNull();
    });

    it('the session tells the dashboard what the member may do', async () => {
      const res = await http().post('/auth/dev-login').send({ email: 'reception.a@demo.test' }).expect(201);
      expect(res.body.clinic.permissions).toEqual(expect.arrayContaining(['branches:read']));
      expect(res.body.clinic.permissions).not.toContain('branches:write');
    });

    it('receptionists can read but not change branches', async () => {
      await http().get(`/branches/${NASR}`).set(as('receptionA')).expect(200);
      await http().put(`/branches/${NASR}/hours`).set(as('receptionA')).send({ days: [] }).expect(403);
    });
  });
});
