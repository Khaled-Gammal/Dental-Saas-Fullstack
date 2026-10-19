import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';

const NASR = 'd0000000-0000-0000-0000-0000000000a1';
const MAADI = 'd0000000-0000-0000-0000-0000000000a2';
const AHMED = 'f0000000-0000-0000-0000-0000000000a1'; // works at Nasr City only
const MONA = 'f0000000-0000-0000-0000-0000000000a2'; // works at Nasr City + Maadi (scheduled at Nasr City only)
const OMAR = '70000000-0000-0000-0000-0000000000a1';
const NOUR = '70000000-0000-0000-0000-0000000000a2';

/** A far-future Saturday morning (before the 17:00 shifts), random so reruns rarely meet their own leftovers. */
function morning(hour: number): { date: string; at: string } {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 70 + ((6 - d.getUTCDay() + 7) % 7) + 7 * Math.floor(Math.random() * 30));
  const date = d.toISOString().slice(0, 10);
  return { date, at: `${date}T${String(hour).padStart(2, '0')}:00:00+02:00` };
}

describe('Access rules: branches, bookings, patient blocking (e2e, Phase C)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const made: string[] = [];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['maadi', 'reception.maadi@demo.test'], ['doctorA', 'doctor.a@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
  });
  afterAll(async () => {
    for (const id of made) await http().post(`/appointments/${id}/cancel`).set(as('ownerA')).send({ reason: 'e2e cleanup' });
    await app.close();
  });

  describe('a receptionist limited to the Maadi branch (ACCESS-003)', () => {
    const slot = morning(9);
    let nasrId: string;
    let maadiId: string;

    it('books at Maadi, but is refused Nasr City with branch_forbidden', async () => {
      const nasr = await http().post('/appointments').set(as('receptionA'))
        .send({ patientId: OMAR, branchId: NASR, doctorId: MONA, startsAt: slot.at, source: 'phone', overrideReason: 'early opening' }).expect(201);
      nasrId = nasr.body.id; made.push(nasrId);

      const later = `${slot.date}T11:00:00+02:00`;
      const maadi = await http().post('/appointments').set(as('maadi'))
        .send({ patientId: OMAR, branchId: MAADI, doctorId: MONA, startsAt: later, source: 'phone', overrideReason: 'extra clinic day' }).expect(201);
      maadiId = maadi.body.id; made.push(maadiId);

      const refused = await http().post('/appointments').set(as('maadi'))
        .send({ patientId: OMAR, branchId: NASR, doctorId: MONA, startsAt: `${slot.date}T12:00:00+02:00`, source: 'phone', overrideReason: 'x x x' }).expect(403);
      expect(refused.body.code).toBe('branch_forbidden');
      expect((await http().get('/appointments').query({ date: slot.date, branchId: NASR }).set(as('maadi')).expect(403)).body.code).toBe('branch_forbidden');
      expect((await http().get('/appointments/availability').query({ branchId: NASR, doctorId: MONA, date: slot.date }).set(as('maadi')).expect(403)).body.code)
        .toBe('branch_forbidden');
    });

    it('sees only Maadi bookings in the day list; an all-branch receptionist sees both', async () => {
      const mine = (await http().get('/appointments').query({ date: slot.date }).set(as('maadi')).expect(200)).body.appointments.map((a: { id: string }) => a.id);
      expect(mine).toContain(maadiId);
      expect(mine).not.toContain(nasrId);
      const all = (await http().get('/appointments').query({ date: slot.date }).set(as('receptionA')).expect(200)).body.appointments.map((a: { id: string }) => a.id);
      expect(all).toEqual(expect.arrayContaining([maadiId, nasrId]));
    });

    it('cannot open or move a Nasr City booking (it does not exist for her)', async () => {
      await http().get(`/appointments/${nasrId}`).set(as('maadi')).expect(404);
      await http().post(`/appointments/${nasrId}/cancel`).set(as('maadi')).send({ reason: 'not mine' }).expect(404);
    });

    it('cannot double-book the doctor at Maadi while she is busy at Nasr City', async () => {
      const clash = await http().post('/appointments').set(as('maadi'))
        .send({ patientId: NOUR, branchId: MAADI, doctorId: MONA, startsAt: slot.at, source: 'phone', overrideReason: 'same time elsewhere' }).expect(409);
      expect(clash.body.code).toBe('slot_taken');
    });

    it('finds every patient of the clinic, but sees only Maadi visits on the profile', async () => {
      const profile = (await http().get(`/patients/${OMAR}`).set(as('maadi')).expect(200)).body;
      const ids = profile.appointments.map((a: { id: string }) => a.id);
      expect(ids).toContain(maadiId);
      expect(ids).not.toContain(nasrId);
    });
  });

  describe('staff bookings name an active doctor of that branch (APPT-002)', () => {
    it('an override reason does not let reception book a doctor at a branch they do not work at', async () => {
      const { at } = morning(10);
      const res = await http().post('/appointments').set(as('receptionA'))
        .send({ patientId: OMAR, branchId: MAADI, doctorId: AHMED, startsAt: at, source: 'phone', overrideReason: 'covering for a colleague' }).expect(409);
      expect(res.body.code).toBe('doctor_not_at_branch');
    });

    it('nor book a deactivated doctor', async () => {
      const created = await http().post('/doctors').set(as('ownerA')).send({ nameAr: 'د. مؤقت', branchIds: [NASR] }).expect(201);
      await http().patch(`/doctors/${created.body.id}`).set(as('ownerA')).send({ isActive: false }).expect(200);
      const { at } = morning(10);
      const res = await http().post('/appointments').set(as('receptionA'))
        .send({ patientId: OMAR, branchId: NASR, doctorId: created.body.id, startsAt: at, source: 'phone', overrideReason: 'covering for a colleague' }).expect(409);
      expect(res.body.code).toBe('doctor_inactive');
    });
  });

  describe('blocking a patient needs patients:block', () => {
    it('a doctor can edit a patient but not block them; reception can', async () => {
      const res = await http().patch(`/patients/${NOUR}`).set(as('doctorA')).send({ isBlocked: true }).expect(403);
      expect(res.body.code).toBe('missing_permission');
      await http().patch(`/patients/${NOUR}`).set(as('doctorA')).send({ occupation: 'Engineer' }).expect(200);
      await http().patch(`/patients/${NOUR}`).set(as('receptionA')).send({ isBlocked: true }).expect(200);
      await http().patch(`/patients/${NOUR}`).set(as('receptionA')).send({ isBlocked: false }).expect(200);
    });
  });
});
