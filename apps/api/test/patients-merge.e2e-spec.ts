import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';

const NASR = 'd0000000-0000-0000-0000-0000000000a1';
const MONA = 'f0000000-0000-0000-0000-0000000000a2';

/** A Saturday 10–40 weeks ahead (doctors work Sat 17:00–22:00), random so reruns rarely collide with their leftovers. */
function farSaturday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7) + 7 * (10 + Math.floor(Math.random() * 30)));
  return d.toISOString().slice(0, 10);
}

describe('Patients: merging duplicates (e2e, Phase D5, PATIENT-003)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const run = `${Date.now()}`.slice(-7);
  let survivor: string;
  let duplicate: string;
  let apptId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['doctorA', 'doctor.a@demo.test'],
      ['accountantA', 'accountant.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
    const phone = `0107${run}`;
    survivor = (await http().post('/patients').set(as('receptionA')).send({ fullName: `هالة سمير ${run}`, phone, dateOfBirth: '1990-01-01', email: `hala${run}@x.test` }).expect(201)).body.id;
    duplicate = (await http().post('/patients').set(as('receptionA')).send({ fullName: `هاله سمير ${run}`, phone, dateOfBirth: '1990-01-01', city: 'الجيزة' }).expect(201)).body.id;
    await http().put(`/patients/${survivor}/medical-history`).set(as('doctorA')).send({ allergies: ['Penicillin'], conditions: [], medications: [], isPregnant: null, isSmoker: false, notes: null }).expect(200);
    await http().put(`/patients/${duplicate}/medical-history`).set(as('doctorA')).send({ allergies: ['penicillin', 'Latex'], conditions: ['سكري'], medications: [], isPregnant: null, isSmoker: true, notes: null }).expect(200);
    const date = farSaturday();
    const slots: string[] = (await http().get('/appointments/availability').query({ branchId: NASR, doctorId: MONA, date }).set(as('receptionA')).expect(200)).body.slots;
    apptId = (await http().post('/appointments').set(as('receptionA')).send({ patientId: duplicate, branchId: NASR, doctorId: MONA, startsAt: slots[Math.floor(Math.random() * slots.length)], source: 'phone' }).expect(201)).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('previews what moves, the fields that differ and the combined medical lists', async () => {
    const p = (await http().get(`/patients/${survivor}/merge-preview`).query({ other: duplicate }).set(as('ownerA')).expect(200)).body;
    expect(p.moves).toMatchObject({ appointments: 1, patient_medical_history_versions: 1 });
    expect(p.conflicts.map((c: { field: string }) => c.field)).toEqual(['full_name']); // email and city exist on one side only
    expect(p.medicalHistory).toMatchObject({ allergies: ['Penicillin', 'Latex'], conditions: ['سكري'] });
    expect(p.medicalHistory.conflicts).toEqual([{ field: 'is_smoker', survivor: false, merged: true }]);
  });

  it('needs patients:merge; refuses merging a record into itself and another clinic\'s record', async () => {
    expect((await http().get(`/patients/${survivor}/merge-preview`).query({ other: duplicate }).set(as('accountantA')).expect(403)).body.code).toBe('missing_permission');
    expect((await http().post(`/patients/${survivor}/merge`).set(as('ownerA')).send({ mergedId: survivor }).expect(400)).body.code).toBe('merge_self');
    await http().post(`/patients/${survivor}/merge`).set(as('ownerB')).send({ mergedId: duplicate }).expect(404);
  });

  it('moves everything to the survivor; the old link points at it; a second merge is refused', async () => {
    const after = (await http().post(`/patients/${survivor}/merge`).set(as('ownerA')).send({ mergedId: duplicate }).expect(200)).body;
    expect(after.id).toBe(survivor);
    expect(after.medicalHistory.allergies).toEqual(['Penicillin', 'Latex']);
    expect(after.medicalHistory.is_smoker).toBe(false); // the survivor's flag is kept (CLR-15)
    expect((await http().get(`/appointments/${apptId}`).set(as('receptionA')).expect(200)).body.patient.id).toBe(survivor);
    const gone = (await http().get(`/patients/${duplicate}`).set(as('receptionA')).expect(404)).body;
    expect(gone).toMatchObject({ code: 'patient_merged', mergedInto: survivor });
    const list = (await http().get('/patients').query({ q: `سمير ${run}` }).set(as('receptionA')).expect(200)).body.items.map((x: { id: string }) => x.id);
    expect(list).toEqual([survivor]);
    expect((await http().post(`/patients/${survivor}/merge`).set(as('ownerA')).send({ mergedId: duplicate }).expect(409)).body.code).toBe('already_merged');
    const activity = (await http().get(`/patients/${survivor}/activity`).set(as('ownerA')).expect(200)).body.map((x: { action: string }) => x.action);
    expect(activity).toContain('patient.merge');
  });
});
