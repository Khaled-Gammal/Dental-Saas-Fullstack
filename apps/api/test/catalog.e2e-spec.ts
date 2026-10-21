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
const AHMED = 'f0000000-0000-0000-0000-0000000000a1'; // seeded doctor, clinic A
const run = Date.now().toString().slice(-7); // seven digits: a valid mobile is 010 + 8

describe('Onboarding: doctors and services (e2e)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['doctorA', 'doctor.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
  });
  const made = { doctors: [] as string[], services: [] as string[] };
  afterAll(async () => {
    // doctors have no delete API, so test doctors are switched off; services are deleted (hidden when used)
    for (const id of made.doctors) await http().patch(`/doctors/${id}`).set(as('ownerA')).send({ isActive: false });
    for (const id of made.services) await http().delete(`/services/${id}`).set(as('ownerA'));
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
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
    const activeDoctors = async () => ids((await http().get('/doctors').set(as('ownerA')).expect(200)).body.filter((d: { is_active: boolean }) => d.is_active)).sort();
    let serviceId: string;

    it('there is no ready-made list: the clinic types its services', async () => {
      await http().get('/services/catalog').set(as('ownerA')).expect(404);
      await http().post('/services').set(as('ownerA')).send({ catalogCode: 'rct', priceMinor: 250000, durationMinutes: 90 }).expect(400);
    });

    it('adds a service with a price range; every active doctor performs it unless chosen', async () => {
      const res = await http().post('/services').set(as('ownerA'))
        .send({ nameAr: `تنظيف للأطفال ${run}`, priceMinor: 20000, priceMaxMinor: 40000, durationMinutes: 30 }).expect(201);
      serviceId = res.body.id;
      made.services.push(serviceId);
      expect(res.body).toMatchObject({ catalog_code: null, price_minor: 20000, price_max_minor: 40000, duration_minutes: 30 });
      expect(typeof res.body.price_minor).toBe('number');
      expect([...res.body.doctor_ids].sort()).toEqual(await activeDoctors());
      const chosen = await http().post('/services').set(as('ownerA')).send({ nameAr: `زراعة ${run}`, priceMinor: 900000, durationMinutes: 60, doctorIds: [AHMED, AHMED] }).expect(201);
      made.services.push(chosen.body.id);
      expect(chosen.body.doctor_ids).toEqual([AHMED]); // the same doctor twice is one
    });

    it('validates; only a member with settings:write may add or delete', async () => {
      await http().post('/services').set(as('ownerA')).send({ nameAr: 'بدون مدة', priceMinor: 100 }).expect(400); // no duration
      await http().post('/services').set(as('ownerA')).send({ nameAr: 'مقلوب', priceMinor: 500, priceMaxMinor: 100, durationMinutes: 30 }).expect(400);
      await http().post('/services').set(as('ownerA')).send({ priceMinor: 500, durationMinutes: 30 }).expect(400); // no name
      await http().post('/services').set(as('receptionA')).send({ nameAr: 'استقبال', durationMinutes: 30 }).expect(403);
      await http().delete(`/services/${serviceId}`).set(as('receptionA')).expect(403);
    });

    it('a PATCH is checked against the merged row, like a POST', async () => {
      expect((await http().patch(`/services/${serviceId}`).set(as('ownerA')).send({ priceMaxMinor: 100 }).expect(400)).body.code).toBe('validation_failed');
      expect((await http().patch(`/services/${serviceId}`).set(as('ownerA')).send({ nameAr: null, nameEn: null }).expect(400)).body.code).toBe('validation_failed');
      const ok = await http().patch(`/services/${serviceId}`).set(as('ownerA')).send({ priceMaxMinor: 30000 }).expect(200);
      expect(ok.body.price_max_minor).toBe(30000);
    });

    it('who performs it decides who can be booked for it; another clinic\'s doctor is refused', async () => {
      const res = await http().patch(`/services/${serviceId}`).set(as('ownerA')).send({ doctorIds: [AHMED] }).expect(200);
      expect(res.body.doctor_ids).toEqual([AHMED]);
      const options = (await http().get('/public/booking/options').query({ host: 'clinic-a.lvh.me' }).expect(200)).body;
      const performs = (id: string) => options.doctors.find((d: { id: string }) => d.id === id)?.service_ids ?? [];
      expect(performs(AHMED)).toContain(serviceId);
      for (const d of options.doctors.filter((x: { id: string }) => x.id !== AHMED)) expect(d.service_ids).not.toContain(serviceId);
      const bDoctor = (await http().get('/doctors').set(as('ownerB')).expect(200)).body[0]?.id;
      expect(bDoctor).toBeTruthy();
      expect((await http().patch(`/services/${serviceId}`).set(as('ownerA')).send({ doctorIds: [bDoctor] }).expect(400)).body.code).toBe('doctor_not_found');
    });

    it('a new doctor performs every service on the price list', async () => {
      const doc = (await http().post('/doctors').set(as('ownerA')).send({ nameAr: `د. جديد ${run}`, branchIds: [NASR] }).expect(201)).body;
      made.doctors.push(doc.id);
      const list = (await http().get('/services').set(as('ownerA')).expect(200)).body;
      expect(list.find((x: { id: string }) => x.id === serviceId).doctor_ids).toContain(doc.id);
    });

    it('hidden from the website = off the website', async () => {
      const hidden = await http().patch(`/services/${serviceId}`).set(as('ownerA')).send({ showOnWebsite: false }).expect(200);
      expect(hidden.body.show_on_website).toBe(false);
      const site = await http().get('/public/site?host=clinic-a.lvh.me').expect(200);
      expect(ids(site.body.services)).not.toContain(serviceId);
    });

    it('deletes a never-used service', async () => {
      const id = (await http().post('/services').set(as('ownerA')).send({ nameAr: `للحذف ${run}`, priceMinor: 1000, durationMinutes: 15 }).expect(201)).body.id;
      await http().delete(`/services/${id}`).set(as('ownerB')).expect(404); // another clinic's id is simply not found
      await http().delete(`/services/${id}`).set(as('ownerA')).expect(204);
      expect(ids((await http().get('/services').set(as('ownerA')).expect(200)).body)).not.toContain(id);
      await http().delete(`/services/${id}`).set(as('ownerA')).expect(404);
      await http().patch(`/services/${id}`).set(as('ownerA')).send({ priceMinor: 1 }).expect(404);
    });

    it('deleting a used service hides it everywhere and keeps the history', async () => {
      const name = `خدمة مستخدمة ${run}`;
      const id = (await http().post('/services').set(as('ownerA')).send({ nameAr: name, priceMinor: 5000, durationMinutes: 20 }).expect(201)).body.id;
      const patientId = (await http().post('/patients').set(as('receptionA')).send({ fullName: `مريض حذف خدمة ${run}`, phone: `0107${run}` }).expect(201)).body.id;
      const visitId = (await http().post('/visits').set(as('doctorA')).send({ patientId, branchId: NASR }).expect(201)).body.id;
      await http().post(`/visits/${visitId}/procedures`).set(as('doctorA')).send({ serviceId: id }).expect(201);
      const invoice = (await http().post('/invoices').set(as('receptionA')).send({ patientId, branchId: NASR, lines: [{ serviceId: id }] }).expect(201)).body;

      await http().delete(`/services/${id}`).set(as('ownerA')).expect(204);
      expect(ids((await http().get('/services').set(as('ownerA')).expect(200)).body)).not.toContain(id);
      expect(ids((await http().get('/public/site?host=clinic-a.lvh.me').expect(200)).body.services)).not.toContain(id);
      expect(ids((await http().get('/public/booking/options').query({ host: 'clinic-a.lvh.me' }).expect(200)).body.services)).not.toContain(id);
      // history keeps its name
      const visit = (await http().get(`/visits/${visitId}`).set(as('doctorA')).expect(200)).body;
      expect(visit.procedures.map((p: { service_ar: string }) => p.service_ar)).toContain(name);
      const inv = (await http().get(`/invoices/${invoice.id}`).set(as('receptionA')).expect(200)).body;
      expect(inv.lines.map((l: { description: string }) => l.description)).toContain(name);
      // nothing new can use it
      expect((await http().post(`/visits/${visitId}/procedures`).set(as('doctorA')).send({ serviceId: id }).expect(400)).body.code).toBe('service_not_found');
      expect((await http().post('/invoices').set(as('receptionA')).send({ patientId, branchId: NASR, lines: [{ serviceId: id }] }).expect(400)).body.code).toBe('service_not_found');
      await http().patch(`/services/${id}`).set(as('ownerA')).send({ isActive: true }).expect(404);
      await http().delete(`/services/${id}`).set(as('ownerA')).expect(404);
    });
  });
});
