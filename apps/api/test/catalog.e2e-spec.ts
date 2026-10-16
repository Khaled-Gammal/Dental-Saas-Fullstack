import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
import { AppModule } from '../src/app.module';

const NASR = 'd0000000-0000-0000-0000-0000000000a1';
const MAADI = 'd0000000-0000-0000-0000-0000000000a2';
const HELIOPOLIS_B = 'd0000000-0000-0000-0000-0000000000b1';

describe('Onboarding: doctors and services (e2e)', () => {
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
  const made = { doctors: [] as string[], services: [] as string[] };
  afterAll(async () => {
    // there is no delete API (the price list is history for invoices), so what the tests created is switched off
    for (const id of made.doctors) await http().patch(`/doctors/${id}`).set(as('ownerA')).send({ isActive: false });
    for (const id of made.services) await http().patch(`/services/${id}`).set(as('ownerA')).send({ isActive: false, showOnWebsite: false });
    await app.close();
  });

  describe('doctors', () => {
    let doctorId: string;

    it('creates a doctor assigned to branches', async () => {
      const res = await http().post('/doctors').set(as('ownerA'))
        .send({ nameAr: 'د. سارة علي', titleAr: 'أخصائية تقويم', specialties: ['orthodontics'], branchIds: [NASR, MAADI] }).expect(201);
      doctorId = res.body.id;
      made.doctors.push(doctorId);
      expect(res.body).toMatchObject({ name_ar: 'د. سارة علي', branch_ids: expect.arrayContaining([NASR, MAADI]), schedule: [], is_active: true });
    });

    it('the same branch twice is one branch; lists are per clinic', async () => {
      const res = await http().patch(`/doctors/${doctorId}`).set(as('ownerA')).send({ branchIds: [NASR, NASR, MAADI] }).expect(200);
      expect(res.body.branch_ids).toEqual([NASR, MAADI]); // sorted, deduplicated
      const mine = await http().get('/doctors').set(as('ownerB')).expect(200);
      expect(mine.body.map((d: { id: string }) => d.id)).not.toContain(doctorId);
    });

    it('refuses another clinic\'s branch and a nameless doctor', async () => {
      expect((await http().post('/doctors').set(as('ownerA')).send({ nameAr: 'د. خطأ', branchIds: [HELIOPOLIS_B] }).expect(400)).body.code).toBe('branch_not_found');
      await http().post('/doctors').set(as('ownerA')).send({ titleAr: 'بدون اسم' }).expect(400);
      await http().post('/doctors').set(as('receptionA')).send({ nameAr: 'د. استقبال' }).expect(403);
    });

    it('saves a weekly schedule across branches; overlaps are rejected', async () => {
      const ok = await http().put(`/doctors/${doctorId}/schedule`).set(as('ownerA')).send({ slots: [
        { branchId: NASR, weekday: 6, starts: '10:00', ends: '14:00' },
        { branchId: MAADI, weekday: 6, starts: '14:00', ends: '20:00' }, // back-to-back at another branch is fine
        { branchId: NASR, weekday: 1, starts: '10:00', ends: '14:00' },
      ] }).expect(200);
      expect(ok.body.schedule).toHaveLength(3);
      expect(ok.body.schedule[0]).toEqual({ branch_id: NASR, weekday: 1, starts_at: '10:00', ends_at: '14:00' });

      const overlap = await http().put(`/doctors/${doctorId}/schedule`).set(as('ownerA')).send({ slots: [
        { branchId: NASR, weekday: 6, starts: '10:00', ends: '14:00' },
        { branchId: MAADI, weekday: 6, starts: '13:00', ends: '16:00' }, // in two places at once
      ] }).expect(400);
      expect(overlap.body.code).toBe('validation_failed');
      const unassigned = await http().put(`/doctors/${doctorId}/schedule`).set(as('ownerA'))
        .send({ slots: [{ branchId: HELIOPOLIS_B, weekday: 2, starts: '10:00', ends: '12:00' }] }).expect(400);
      expect(unassigned.body.code).toBe('branch_not_assigned');
      expect((await http().get(`/doctors/${doctorId}`).set(as('ownerA')).expect(200)).body.schedule).toHaveLength(3); // untouched
    });

    it('removing a branch from a doctor also drops that branch\'s schedule', async () => {
      const res = await http().patch(`/doctors/${doctorId}`).set(as('ownerA')).send({ branchIds: [NASR] }).expect(200);
      expect(res.body.branch_ids).toEqual([NASR]);
      expect(res.body.schedule.every((s: { branch_id: string }) => s.branch_id === NASR)).toBe(true);
      expect(res.body.schedule).toHaveLength(2);
    });

    it('is invisible to other clinics', async () => {
      await http().get(`/doctors/${doctorId}`).set(as('ownerB')).expect(404);
      await http().patch(`/doctors/${doctorId}`).set(as('ownerB')).send({ isActive: false }).expect(404);
    });

    it('a deactivated doctor leaves the public website', async () => {
      await http().patch(`/doctors/${doctorId}`).set(as('ownerA')).send({ isActive: false }).expect(200);
      const site = await http().get('/public/site?host=clinic-a.lvh.me').expect(200);
      expect(site.body.doctors.map((d: { id: string }) => d.id)).not.toContain(doctorId);
    });
  });

  describe('services', () => {
    it('lists the dental catalogue', async () => {
      const res = await http().get('/services/catalog').set(as('receptionA')).expect(200);
      expect(res.body.map((c: { code: string }) => c.code)).toEqual(expect.arrayContaining(['consultation', 'scaling', 'rct']));
    });

    it('adds a service from the catalogue with just a price; once', async () => {
      const res = await http().post('/services').set(as('ownerA')).send({ catalogCode: 'rct', priceMinor: 250000 }).expect(201);
      made.services.push(res.body.id);
      expect(res.body).toMatchObject({ catalog_code: 'rct', name_ar: 'علاج عصب', duration_minutes: 90, price_minor: 250000, price_max_minor: null });
      expect(typeof res.body.price_minor).toBe('number');
      const again = await http().post('/services').set(as('ownerA')).send({ catalogCode: 'rct', priceMinor: 250000 }).expect(409);
      expect(again.body.code).toBe('service_already_added');
    });

    it('a PATCH is checked against the merged row, like a POST', async () => {
      const id = made.services[0];
      expect((await http().patch(`/services/${id}`).set(as('ownerA')).send({ priceMaxMinor: 100 }).expect(400)).body.code).toBe('validation_failed');
      expect((await http().patch(`/services/${id}`).set(as('ownerA')).send({ nameAr: null, nameEn: null }).expect(400)).body.code).toBe('validation_failed');
      const ok = await http().patch(`/services/${id}`).set(as('ownerA')).send({ priceMaxMinor: 300000 }).expect(200);
      expect(ok.body.price_max_minor).toBe(300000);
    });

    it('adds a custom service with a price range, and validates', async () => {
      const res = await http().post('/services').set(as('ownerA'))
        .send({ nameAr: 'تنظيف للأطفال', priceMinor: 20000, priceMaxMinor: 40000, durationMinutes: 30 }).expect(201);
      made.services.push(res.body.id);
      expect(res.body.price_max_minor).toBe(40000);
      await http().post('/services').set(as('ownerA')).send({ nameAr: 'بدون مدة', priceMinor: 100 }).expect(400); // no duration
      await http().post('/services').set(as('ownerA')).send({ nameAr: 'مقلوب', priceMinor: 500, priceMaxMinor: 100, durationMinutes: 30 }).expect(400);
      expect((await http().post('/services').set(as('ownerA')).send({ catalogCode: 'nope_x', priceMinor: 1 }).expect(400)).body.code).toBe('catalog_code_unknown');
      await http().post('/services').set(as('receptionA')).send({ catalogCode: 'rct', priceMinor: 1 }).expect(403);
      const hidden = await http().patch(`/services/${res.body.id}`).set(as('ownerA')).send({ showOnWebsite: false }).expect(200);
      expect(hidden.body.show_on_website).toBe(false);
      const site = await http().get('/public/site?host=clinic-a.lvh.me').expect(200);
      expect(site.body.services.map((x: { id: string }) => x.id)).not.toContain(res.body.id); // hidden = off the website
    });
  });
});
