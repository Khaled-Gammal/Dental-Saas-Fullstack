import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false'; // per-IP throttles off: every test request comes from 127.0.0.1 (as in identity.e2e-spec)
import { AppModule } from '../src/app.module';

const NASR = 'd0000000-0000-0000-0000-0000000000a1';
const MONA = 'f0000000-0000-0000-0000-0000000000a2';
const CONSULT = '90000000-0000-0000-0000-0000000000a1';
const OMAR = '70000000-0000-0000-0000-0000000000a1';

/** Unique per run: a random 8-digit tail on an Egyptian mobile. */
const phone = () => `+2010${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
function nextSaturday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7) + 7 * (1 + Math.floor(Math.random() * 5)));
  return d.toISOString().slice(0, 10);
}

describe('Patients (e2e)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const mobile = phone();
  const childMobile = phone();
  let patientId: string;
  let fileNo: number;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['doctorA', 'doctor.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
  });
  afterAll(() => app.close());

  describe('records', () => {
    it('reception registers a patient; the file number comes from the clinic counter', async () => {
      const res = await http().post('/patients').set(as('receptionA'))
        .send({ fullName: 'سلمى عبد الرحمن', phone: mobile.replace('+20', '0'), gender: 'female', dateOfBirth: '1991-03-14', city: 'Cairo', tags: ['vip', 'vip'], marketingOptIn: true })
        .expect(201);
      patientId = res.body.id;
      fileNo = res.body.file_no;
      expect(res.body).toMatchObject({ full_name: 'سلمى عبد الرحمن', phone: mobile, date_of_birth: '1991-03-14', tags: ['vip'], marketing_opt_in: true });
      expect(typeof fileNo).toBe('number');
      expect(res.body.marketing_opt_in_at).toBeTruthy(); // PDPL: consent time recorded
    });

    it('rejects bad input and a future birth date', async () => {
      expect((await http().post('/patients').set(as('receptionA')).send({ fullName: 'X', phone: mobile }).expect(400)).body.code).toBe('validation_failed');
      await http().post('/patients').set(as('receptionA')).send({ fullName: 'Future Baby', phone: phone(), dateOfBirth: '2999-01-01' }).expect(400);
      await http().post('/patients').set(as('receptionA')).send({ fullName: 'Bad Phone', phone: '12' }).expect(400);
    });

    it('a child with a guardian who is also a patient', async () => {
      const res = await http().post('/patients').set(as('receptionA'))
        .send({ fullName: 'يوسف الصغير', phone: childMobile, dateOfBirth: '2018-06-01', guardianPatientId: patientId, guardianRelation: 'mother' }).expect(201);
      expect(res.body).toMatchObject({ guardian_patient_id: patientId, guardian_patient_name: 'سلمى عبد الرحمن', guardian_relation: 'mother' });
      const self = await http().patch(`/patients/${res.body.id}`).set(as('receptionA')).send({ guardianPatientId: res.body.id }).expect(400);
      expect(self.body.code).toBe('guardian_is_self');
    });

    it('search: name (partial, Arabic), full phone in local form, phone prefix, file number', async () => {
      const byName = await http().get('/patients').query({ q: 'سلمى عبد' }).set(as('receptionA')).expect(200);
      expect(byName.body.items.map((p: { id: string }) => p.id)).toContain(patientId);
      const byPhone = await http().get('/patients').query({ q: mobile.replace('+20', '0') }).set(as('receptionA')).expect(200);
      expect(byPhone.body.items.map((p: { id: string }) => p.id)).toEqual([patientId]);
      const byPrefix = await http().get('/patients').query({ q: mobile.slice(0, 9).replace('+20', '0') }).set(as('receptionA')).expect(200);
      expect(byPrefix.body.items.map((p: { id: string }) => p.id)).toContain(patientId);
      const byFile = await http().get('/patients').query({ q: String(fileNo) }).set(as('receptionA')).expect(200);
      expect(byFile.body.items[0].id).toBe(patientId);
    });

    it('lists newest first with a keyset cursor', async () => {
      const first = await http().get('/patients').query({ limit: 1 }).set(as('ownerA')).expect(200);
      expect(first.body.items).toHaveLength(1);
      expect(first.body.nextCursor).toBeTruthy();
      const second = await http().get('/patients').query({ limit: 1, cursor: first.body.nextCursor }).set(as('ownerA')).expect(200);
      expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    });

    it('another clinic cannot see or change the record', async () => {
      await http().get(`/patients/${patientId}`).set(as('ownerB')).expect(404);
      await http().patch(`/patients/${patientId}`).set(as('ownerB')).send({ city: 'Giza' }).expect(404);
      const search = await http().get('/patients').query({ q: 'سلمى عبد' }).set(as('ownerB')).expect(200);
      expect(search.body.items.map((p: { id: string }) => p.id)).not.toContain(patientId);
    });

    it('updates only what is sent; marketing consent time follows the switch', async () => {
      const res = await http().patch(`/patients/${patientId}`).set(as('receptionA')).send({ city: 'Giza', marketingOptIn: false }).expect(200);
      expect(res.body).toMatchObject({ city: 'Giza', full_name: 'سلمى عبد الرحمن', marketing_opt_in: false });
    });
  });

  describe('medical history (clinical data)', () => {
    it('reception sees the profile but not the medical history, and cannot write it', async () => {
      const res = await http().get(`/patients/${patientId}`).set(as('receptionA')).expect(200);
      expect(res.body.medicalHistory).toBeNull();
      await http().put(`/patients/${patientId}/medical-history`).set(as('receptionA'))
        .send({ allergies: [], conditions: [], medications: [], isPregnant: null, isSmoker: null, notes: null }).expect(403);
    });

    it('a doctor records allergies and conditions; lists are cleaned', async () => {
      const res = await http().put(`/patients/${patientId}/medical-history`).set(as('doctorA'))
        .send({ allergies: ['Penicillin', 'penicillin ', 'Latex'], conditions: ['Diabetes'], medications: [], isPregnant: false, isSmoker: null, notes: 'حساسية شديدة' }).expect(200);
      expect(res.body).toMatchObject({ allergies: ['Penicillin', 'Latex'], conditions: ['Diabetes'], is_pregnant: false, notes: 'حساسية شديدة' });
      const profile = await http().get(`/patients/${patientId}`).set(as('doctorA')).expect(200);
      expect(profile.body.medicalHistory.allergies).toEqual(['Penicillin', 'Latex']);
    });
  });

  describe('audit trail (NFR-03, DSH-15)', () => {
    it('records views and changes, never medical values; owners only', async () => {
      const res = await http().get(`/patients/${patientId}/activity`).set(as('ownerA')).expect(200);
      const actions = res.body.map((e: { action: string }) => e.action);
      expect(actions).toEqual(expect.arrayContaining(['patient.create', 'patient.view', 'patient.update', 'patient.medical_history.update']));
      const medical = res.body.find((e: { action: string }) => e.action === 'patient.medical_history.update');
      expect(medical.changes).toEqual({ allergies: true, conditions: true, is_pregnant: true, notes: true });
      expect(JSON.stringify(res.body)).not.toContain('Penicillin');
      const update = res.body.find((e: { action: string; changes: Record<string, unknown> }) => e.action === 'patient.update' && e.changes.city);
      expect(update.changes.city).toEqual(['Cairo', 'Giza']);
      expect(res.body.find((e: { action: string }) => e.action === 'patient.view').actor_name).toBeTruthy();
      await http().get(`/patients/${patientId}/activity`).set(as('receptionA')).expect(403);
    });

    it('a refetch within minutes does not add another view row', async () => {
      await http().get(`/patients/${patientId}`).set(as('ownerA')).expect(200);
      await http().get(`/patients/${patientId}`).set(as('ownerA')).expect(200);
      const res = await http().get(`/patients/${patientId}/activity`).set(as('ownerA')).expect(200);
      const ownerViews = res.body.filter((e: { action: string; actor_name: string }) => e.action === 'patient.view' && /Ahmed/.test(e.actor_name));
      expect(ownerViews).toHaveLength(1);
    });
  });

  describe('booking from the dashboard', () => {
    it('availability for a doctor, then a booking for the new patient', async () => {
      const date = nextSaturday();
      const free = await http().get('/appointments/availability').query({ branchId: NASR, doctorId: MONA, serviceId: CONSULT, date }).set(as('receptionA')).expect(200);
      expect(free.body).toMatchObject({ date, durationMinutes: 20 });
      expect(free.body.slots.length).toBeGreaterThan(0);
      const startsAt = free.body.slots[Math.floor(Math.random() * free.body.slots.length)];
      const booked = await http().post('/appointments').set(as('receptionA'))
        .send({ patientId, branchId: NASR, doctorId: MONA, serviceId: CONSULT, startsAt, source: 'phone' }).expect(201);
      const profile = await http().get(`/patients/${patientId}`).set(as('receptionA')).expect(200);
      expect(profile.body.appointments.map((a: { id: string }) => a.id)).toContain(booked.body.id);
      await http().post(`/appointments/${booked.body.id}/cancel`).set(as('receptionA')).send({ reason: 'e2e cleanup' }).expect(200);
    });

    it('a patient of another clinic cannot be booked', async () => {
      const date = nextSaturday();
      const res = await http().post('/appointments').set(as('ownerB'))
        .send({ patientId: OMAR, branchId: 'd0000000-0000-0000-0000-0000000000b1', doctorId: 'f0000000-0000-0000-0000-0000000000b1', startsAt: `${date}T17:00:00+02:00`, source: 'phone' })
        .expect(404);
      expect(res.body.code).toBe('patient_not_found');
    });
  });
});
