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

const HOST = 'clinic-a.lvh.me';
const NASR = 'd0000000-0000-0000-0000-0000000000a1';
const MAADI = 'd0000000-0000-0000-0000-0000000000a2';
const AHMED = 'f0000000-0000-0000-0000-0000000000a1'; // Nasr City, member of owner.a
const MONA = 'f0000000-0000-0000-0000-0000000000a2'; // Nasr City + Maadi, member of doctor.a
const CONSULT = '90000000-0000-0000-0000-0000000000a1';
const OMAR = '70000000-0000-0000-0000-0000000000a1';
const NOUR = '70000000-0000-0000-0000-0000000000a2';
const MAADI_CHAIR = 'e0000000-0000-0000-0000-0000000000a3';

/** A Saturday 10–40 weeks ahead (doctors work Sat 17:00–22:00), random so reruns rarely collide with their leftovers. */
function farSaturday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7) + 7 * (10 + Math.floor(Math.random() * 30)));
  return d.toISOString().slice(0, 10);
}
/** A Saturday 1–6 weeks ahead: inside the website's 60-day booking horizon (the move adds one more week). */
function nearSaturday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7) + 7 * Math.floor(Math.random() * 6));
  return d.toISOString().slice(0, 10);
}
const plusDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe('Calendar: moves, rooms, holidays, time off, booking rules, my day (e2e, Phase D2)', () => {
  let app: INestApplication;
  let mail: DevEmailSender;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  let date = farSaturday(); // re-picked in beforeAll until both doctors have a mostly free day
  const made: string[] = [];
  const run = `${Date.now()}`.slice(-6);

  const slots = async (doctorId: string, d = date, branchId = NASR): Promise<string[]> =>
    (await http().get('/appointments/availability').query({ branchId, doctorId, date: d }).set(as('receptionA')).expect(200)).body.slots;
  const book = async (patientId: string, doctorId: string, startsAt: string, extra: Record<string, unknown> = {}) => {
    const r = await http().post('/appointments').set(as('receptionA')).send({ patientId, branchId: NASR, doctorId, startsAt, source: 'phone', ...extra }).expect(201);
    made.push(r.body.id);
    return r.body as { id: string; starts_at: string; ends_at: string; room_id: string | null };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    mail = app.get(EMAIL_SENDER);
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['doctorA', 'doctor.a@demo.test'], ['maadi', 'reception.maadi@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
    // Other suites book the same seeded doctors on random far Saturdays too; when one lands on ours first (it
    // depends on the order jest runs files in), the tests below would find too few free slots. Pick a free day.
    for (let i = 0; i < 20 && ((await slots(MONA)).length < 15 || (await slots(AHMED)).length < 15); i++) date = farSaturday();
  });
  afterAll(async () => {
    for (const id of made) await http().post(`/appointments/${id}/cancel`).set(as('ownerA')).send({ reason: 'e2e cleanup' });
    await http().patch('/clinic/booking-settings').set(as('ownerA')).send({ slotStepMinutes: 15, reminderOffsetsMinutes: [1440, 120] }); // the seed's rules
    await app.close();
  });

  describe('moving a booking (APPT-001)', () => {
    it('moves to another free time the same day, keeping the same record', async () => {
      const free = await slots(MONA);
      const a = await book(OMAR, MONA, free[0]);
      const target = free[free.length - 1];
      const moved = await http().post(`/appointments/${a.id}/move`).set(as('receptionA')).send({ startsAt: target }).expect(200);
      expect(moved.body).toMatchObject({ id: a.id, status: 'confirmed', starts_at: target });
      const length = new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime(); // a staff booking without a service: 30 minutes
      expect(new Date(moved.body.ends_at).getTime() - new Date(target).getTime()).toBe(length); // keeps its length
      expect((await slots(MONA))).not.toContain(target);
      expect((await slots(MONA))).toContain(free[0]); // the old time is free again
    });

    it('can shift onto part of its own old time; a taken time is refused', async () => {
      const free = await slots(MONA);
      const a = await book(OMAR, MONA, free[1]);
      const b = await book(NOUR, MONA, free[6]); // 30-minute bookings: a at +15 min still ends before b
      const quarterLater = new Date(new Date(free[1]).getTime() + 15 * 60_000).toISOString();
      await http().post(`/appointments/${a.id}/move`).set(as('receptionA')).send({ startsAt: quarterLater }).expect(200);
      const taken = await http().post(`/appointments/${a.id}/move`).set(as('receptionA')).send({ startsAt: b.starts_at }).expect(409);
      expect(['outside_schedule', 'slot_taken']).toContain(taken.body.code);
      const forced = await http().post(`/appointments/${a.id}/move`).set(as('receptionA')).send({ startsAt: b.starts_at, overrideReason: 'squeeze in' }).expect(409);
      expect(forced.body.code).toBe('slot_taken'); // an override relaxes the schedule, never double booking
    });

    it('refuses final bookings, empty moves, doctors, and another branch', async () => {
      const free = await slots(MONA);
      const a = await book(NOUR, MONA, free[5]);
      expect((await http().post(`/appointments/${a.id}/move`).set(as('receptionA')).send({}).expect(400)).body.code).toBe('nothing_to_change');
      expect((await http().post(`/appointments/${a.id}/move`).set(as('doctorA')).send({ startsAt: free[6] }).expect(403)).body.code).toBe('missing_permission');
      expect((await http().post(`/appointments/${a.id}/move`).set(as('receptionA')).send({ branchId: MAADI, doctorId: AHMED, overrideReason: 'x x x' }).expect(409)).body.code)
        .toBe('doctor_not_at_branch');
      await http().post(`/appointments/${a.id}/cancel`).set(as('receptionA')).send({ reason: 'test' }).expect(200);
      expect((await http().post(`/appointments/${a.id}/move`).set(as('receptionA')).send({ startsAt: free[6] }).expect(409)).body.code).toBe('invalid_transition');
      await http().post(`/appointments/${a.id}/move`).set(as('maadi')).send({ startsAt: free[6] }).expect(404); // a Nasr City booking does not exist for her
    });

    it('a website booking moved to another day gets a new reception code by email; the old one stops working', async () => {
      const email = `moved.${run}@example.test`;
      const near = nearSaturday();
      const free = (await http().get('/public/booking/slots').query({ host: HOST, branchId: NASR, serviceId: CONSULT, doctorId: AHMED, date: near }).expect(200)).body.slots;
      const hold = await http().post('/public/booking/holds').send({ host: HOST, branchId: NASR, serviceId: CONSULT, doctorId: AHMED, startsAt: free[2].startsAt }).expect(201);
      made.push(hold.body.holdId);
      await http().post(`/public/booking/holds/${hold.body.holdId}/details`).send({ host: HOST, fullName: 'Moved Patient', phone: `+20101${run}11`, email }).expect(201);
      const otp = /(\d{6})/.exec(mail.outbox.get(email)?.text ?? '')?.[1] ?? '';
      const booked = await http().post(`/public/booking/holds/${hold.body.holdId}/confirm`).send({ host: HOST, code: otp }).expect(201);
      const oldCode = booked.body.code as string;

      const nextWeek = plusDays(near, 7);
      const target = (await slots(AHMED, nextWeek))[0];
      await http().post(`/appointments/${hold.body.holdId}/move`).set(as('receptionA')).send({ startsAt: target }).expect(200);
      const msg = mail.outbox.get(email);
      expect(msg?.subject).toContain('تغيّر موعدك');
      const newCode = /رمز الحضور الجديد: (\d{6})/.exec(msg?.text ?? '')?.[1];
      expect(newCode).toMatch(/^\d{6}$/);
      expect(newCode).not.toBe(oldCode);
      await http().post('/appointments/check-in').set(as('receptionA')).send({ code: oldCode, branchId: NASR }).expect(404);
      await http().post('/appointments/check-in').set(as('receptionA')).send({ code: newCode, branchId: NASR }).expect(200);
    });
  });

  describe('rooms (APPT-006)', () => {
    let chair: string;
    it('the owner adds a room; names are unique per branch; reception cannot', async () => {
      const r = await http().post(`/branches/${NASR}/rooms`).set(as('ownerA')).send({ name: `كرسي ${run}` }).expect(201);
      chair = r.body.id;
      expect((await http().post(`/branches/${NASR}/rooms`).set(as('ownerA')).send({ name: `كرسي ${run}` }).expect(409)).body.code).toBe('room_name_taken');
      await http().post(`/branches/${NASR}/rooms`).set(as('receptionA')).send({ name: 'x' }).expect(403);
      expect((await http().get(`/branches/${NASR}/rooms`).set(as('receptionA')).expect(200)).body.map((x: { id: string }) => x.id)).toContain(chair);
    });

    it('a booking gets a room of its own branch; the same room cannot be double-booked', async () => {
      const free = await slots(AHMED);
      const a = await book(OMAR, AHMED, free[0]);
      expect((await http().post(`/appointments/${a.id}/move`).set(as('receptionA')).send({ roomId: chair }).expect(200)).body.room_id).toBe(chair);
      expect((await http().post(`/appointments/${a.id}/move`).set(as('receptionA')).send({ roomId: MAADI_CHAIR }).expect(400)).body.code).toBe('room_not_in_branch');
      // another doctor at the very same time, then the same chair
      const b = await book(NOUR, MONA, a.starts_at, { overrideReason: 'same time, other doctor' });
      expect(b.starts_at).toBe(a.starts_at);
      expect((await http().post(`/appointments/${b.id}/move`).set(as('receptionA')).send({ roomId: chair }).expect(409)).body.code).toBe('room_taken');
      await http().patch(`/rooms/${chair}`).set(as('ownerA')).send({ isActive: false }).expect(200);
      expect((await http().post(`/appointments/${b.id}/move`).set(as('receptionA')).send({ roomId: chair }).expect(400)).body.code).toBe('room_not_in_branch');
      await http().post(`/appointments/${a.id}/move`).set(as('receptionA')).send({ roomId: null }).expect(200);
    });
  });

  describe('holidays and time off (APPT-005)', () => {
    const closed = plusDays(date, 14);
    it('a closed day removes its slots and lists the bookings it falls on; nothing is cancelled', async () => {
      const a = await book(OMAR, MONA, (await slots(MONA, closed))[0]);
      const h = await http().post('/holidays').set(as('ownerA')).send({ branchId: NASR, date: closed, name: 'إجازة رسمية' }).expect(201);
      // other suites book on random far Saturdays too: the day's list holds ours, maybe beside theirs
      expect(h.body.conflicts.map((c: { id: string }) => c.id)).toContain(a.id);
      expect(await slots(MONA, closed)).toEqual([]);
      expect((await http().get(`/appointments/${a.id}`).set(as('receptionA')).expect(200)).body.status).toBe('confirmed');
      expect((await http().post('/holidays').set(as('ownerA')).send({ branchId: NASR, date: closed, name: 'again' }).expect(409)).body.code).toBe('holiday_exists');
      await http().post('/holidays').set(as('receptionA')).send({ branchId: NASR, date: plusDays(closed, 1), name: 'x' }).expect(403);
      expect((await http().get('/holidays').query({ from: closed }).set(as('receptionA')).expect(200)).body.map((x: { id: string }) => x.id)).toContain(h.body.holiday.id);
      await http().delete(`/holidays/${h.body.holiday.id}`).set(as('ownerA')).expect(204);
      expect((await slots(MONA, closed)).length).toBeGreaterThan(0);
    });

    it('a doctor\'s time off removes their slots and lists the bookings it covers', async () => {
      const day = plusDays(date, 21);
      const a = await book(NOUR, AHMED, (await slots(AHMED, day))[0]);
      const t = await http().post(`/doctors/${AHMED}/time-off`).set(as('ownerA'))
        .send({ startsAt: `${day}T00:00:00+02:00`, endsAt: `${day}T23:59:00+02:00`, reason: 'مؤتمر' }).expect(201);
      expect(t.body.conflicts.map((c: { id: string }) => c.id)).toContain(a.id); // as above: other suites may book that day
      expect(await slots(AHMED, day)).toEqual([]);
      expect((await http().post(`/doctors/${AHMED}/time-off`).set(as('ownerA')).send({ startsAt: `${day}T10:00:00+02:00`, endsAt: `${day}T09:00:00+02:00` }).expect(400)).body.code)
        .toBe('invalid_range');
      expect((await http().get(`/doctors/${AHMED}/time-off`).set(as('receptionA')).expect(200)).body.map((x: { id: string }) => x.id)).toContain(t.body.timeOff.id);
      await http().delete(`/doctors/${AHMED}/time-off/${t.body.timeOff.id}`).set(as('ownerA')).expect(204);
      expect((await slots(AHMED, day)).length).toBeGreaterThan(0);
    });
  });

  describe('booking rules (APPT-009)', () => {
    it('the owner changes the slot step and reminders; the website follows; limits are checked', async () => {
      const before = (await http().get('/clinic/booking-settings').set(as('receptionA')).expect(200)).body;
      expect(before).toMatchObject({ slotStepMinutes: 15, reminderOffsetsMinutes: [1440, 120] });
      const after = (await http().patch('/clinic/booking-settings').set(as('ownerA')).send({ slotStepMinutes: 30, reminderOffsetsMinutes: [60, 2880, 60] }).expect(200)).body;
      expect(after).toMatchObject({ slotStepMinutes: 30, reminderOffsetsMinutes: [2880, 60] }); // unique, longest first
      expect((await http().get('/public/booking/options').query({ host: HOST }).expect(200)).body.policy.slotStepMinutes).toBe(30);
      await http().patch('/clinic/booking-settings').set(as('ownerA')).send({ slotStepMinutes: 7 }).expect(400);
      await http().patch('/clinic/booking-settings').set(as('ownerA')).send({ reminderOffsetsMinutes: [60, 120, 180, 240, 300] }).expect(400);
      await http().patch('/clinic/booking-settings').set(as('receptionA')).send({ autoConfirm: false }).expect(403);
      await http().patch('/clinic/booking-settings').set(as('ownerA')).send({ slotStepMinutes: 15, reminderOffsetsMinutes: [1440, 120] }).expect(200);
    });
  });

  describe('my day (APPT-004)', () => {
    it('a doctor sees only their own appointments with mine=true; others see nothing as "mine"', async () => {
      const day = plusDays(date, 28);
      const mona = await book(OMAR, MONA, (await slots(MONA, day))[0]);
      const ahmed = await book(NOUR, AHMED, (await slots(AHMED, day))[1]);
      const ids = async (who: string, mine?: boolean) =>
        (await http().get('/appointments').query({ date: day, ...(mine !== undefined && { mine: String(mine) }) }).set(as(who)).expect(200)).body.appointments.map((x: { id: string }) => x.id);
      // other suites may leave bookings on the same day, so check membership, not the whole list
      const mineMona = await ids('doctorA', true);
      expect(mineMona).toContain(mona.id);
      expect(mineMona).not.toContain(ahmed.id);
      expect(await ids('doctorA')).toEqual(expect.arrayContaining([mona.id, ahmed.id])); // the whole schedule stays readable (CLR-10)
      const mineAhmed = await ids('ownerA', true); // the owner is Dr Ahmed
      expect(mineAhmed).toContain(ahmed.id);
      expect(mineAhmed).not.toContain(mona.id);
      expect(await ids('receptionA', true)).toEqual([]);
    });
  });
});
