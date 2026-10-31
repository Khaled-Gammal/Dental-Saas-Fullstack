import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false'; // per-IP throttles off: every test request comes from 127.0.0.1 (as in identity.e2e-spec)
import { AppModule } from '../src/app.module';
import type { DevEmailSender } from '../src/shared/notifications/dev-email.sender';
import { EMAIL_SENDER } from '../src/shared/notifications/ports';

const HOST = 'clinic-a.lvh.me';
const NASR = 'd0000000-0000-0000-0000-0000000000a1';
const AHMED = 'f0000000-0000-0000-0000-0000000000a1'; // works Nasr City, member of owner.a
const MONA = 'f0000000-0000-0000-0000-0000000000a2'; // works Nasr City + Maadi, member of doctor.a
const CONSULT = '90000000-0000-0000-0000-0000000000a1'; // 20 minutes, 300.00
const OMAR = '70000000-0000-0000-0000-0000000000a1'; // seeded patient

/** A Saturday 1–7 weeks ahead (the seeded doctors work Sat–Thu 17:00–22:00); random so reruns rarely meet their own leftovers. */
function futureSaturday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7) + 7 * Math.floor(Math.random() * 7));
  return d.toISOString().slice(0, 10);
}
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const cairoTime = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

describe('Online booking and reception (e2e)', () => {
  let app: INestApplication;
  let mail: DevEmailSender;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const date = futureSaturday();
  const phone = `+20100${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  const email = `patient.${Date.now()}@example.test`;
  const made: string[] = [];
  let holdId: string;
  let slot: string;
  let code: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    mail = app.get(EMAIL_SENDER);
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['doctorA', 'doctor.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
  });
  afterAll(async () => {
    for (const id of made) await http().post(`/appointments/${id}/cancel`).set(as('ownerA')).send({ reason: 'e2e cleanup' }); // frees the slots for the next run
    await app.close();
  });

  describe('website', () => {
    it('offers branches, bookable services, doctors and the rules', async () => {
      const res = await http().get('/public/booking/options').query({ host: HOST }).expect(200);
      expect(res.body.branches.map((b: { id: string }) => b.id)).toContain(NASR);
      expect(res.body.services.map((s: { id: string }) => s.id)).toContain(CONSULT);
      const ahmed = res.body.doctors.find((d: { id: string }) => d.id === AHMED);
      expect(ahmed.branch_ids).toContain(NASR);
      expect(ahmed.service_ids).toContain(CONSULT);
      expect(res.body.policy).toMatchObject({ otpRequired: true, slotStepMinutes: 15, timezone: 'Africa/Cairo' });
      expect(res.body.dates.first <= date && date <= res.body.dates.last).toBe(true);
      await http().get('/public/booking/options').query({ host: 'nobody.lvh.me' }).expect(404);
    });

    it('computes slots on the grid inside the shift, for one doctor or any', async () => {
      const res = await http().get('/public/booking/slots').query({ host: HOST, branchId: NASR, serviceId: CONSULT, doctorId: AHMED, date }).expect(200);
      expect(res.body).toMatchObject({ date, timezone: 'Africa/Cairo', durationMinutes: 20 });
      const times: string[] = res.body.slots.map((s: { startsAt: string }) => cairoTime(s.startsAt));
      expect(times.length).toBeGreaterThan(10);
      expect(times[0]).toBe('17:00');
      for (const t of times) expect(['00', '15', '30', '45']).toContain(t.slice(3));
      expect(times.every((t) => t >= '17:00' && t <= '21:30')).toBe(true);
      const any = await http().get('/public/booking/slots').query({ host: HOST, branchId: NASR, serviceId: CONSULT, date }).expect(200);
      expect(any.body.slots[0].doctorIds).toEqual(expect.arrayContaining([AHMED, MONA]));
      const past = await http().get('/public/booking/slots').query({ host: HOST, branchId: NASR, serviceId: CONSULT, date: '2020-01-04' }).expect(400);
      expect(past.body.code).toBe('date_out_of_range');
    });

    it('holds a slot for 10 minutes; the slot disappears from availability', async () => {
      const free = await http().get('/public/booking/slots').query({ host: HOST, branchId: NASR, serviceId: CONSULT, doctorId: AHMED, date }).expect(200);
      slot = pick(free.body.slots as { startsAt: string }[]).startsAt;
      const res = await http().post('/public/booking/holds').send({ host: HOST, branchId: NASR, serviceId: CONSULT, doctorId: AHMED, startsAt: slot }).expect(201);
      holdId = res.body.holdId;
      made.push(holdId);
      expect(res.body).toMatchObject({ doctorId: AHMED, startsAt: new Date(slot).toISOString(), otpRequired: true, ttlSeconds: 600 }); // the countdown's own length (review R11)
      expect(new Date(res.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
      const after = await http().get('/public/booking/slots').query({ host: HOST, branchId: NASR, serviceId: CONSULT, doctorId: AHMED, date }).expect(200);
      expect(after.body.slots.map((s: { startsAt: string }) => s.startsAt)).not.toContain(new Date(slot).toISOString());
      const again = await http().post('/public/booking/holds').send({ host: HOST, branchId: NASR, serviceId: CONSULT, doctorId: AHMED, startsAt: slot }).expect(409);
      expect(again.body.code).toBe('slot_unavailable');
    });

    it('another clinic cannot touch the hold', async () => {
      const res = await http().post(`/public/booking/holds/${holdId}/details`).send({ host: 'clinic-b.lvh.me', fullName: 'Someone', phone: '+201000000999', email: 'someone@example.test' }).expect(409);
      expect(res.body.code).toBe('hold_expired');
    });

    it('details trigger an email code; the right code books and emails a reception code', async () => {
      const res = await http().post(`/public/booking/holds/${holdId}/details`).send({ host: HOST, fullName: 'Test Patient', phone, email, notes: 'ألم في الضرس' }).expect(201);
      expect(res.body).toEqual({ status: 'otp_required', maskedEmail: expect.stringMatching(/^pa\*\*\*@example\.test$/) });
      const otp = /(\d{6})/.exec(mail.outbox.get(email)?.text ?? '')?.[1] ?? '';
      expect(otp).toHaveLength(6);
      const wrong = await http().post(`/public/booking/holds/${holdId}/confirm`).send({ host: HOST, code: otp === '000000' ? '000001' : '000000' }).expect(400);
      expect(wrong.body.code).toBe('otp_invalid');
      const ok = await http().post(`/public/booking/holds/${holdId}/confirm`).send({ host: HOST, code: otp }).expect(201);
      expect(ok.body).toMatchObject({ appointmentId: holdId, status: 'confirmed' }); // clinic A auto-confirms
      expect(ok.body.code).toMatch(/^\d{6}$/);
      // the anonymous caller gets the confirmation screen only, never the patient's record or internal notes (review R11)
      expect(Object.keys(ok.body.appointment).sort()).toEqual(['branch_id', 'doctor', 'service']);
      expect(ok.body.appointment.doctor.name_en).toBe('Dr. Ahmed Salah');
      const staffView = await http().get(`/appointments/${holdId}`).set(as('receptionA')).expect(200);
      expect(staffView.body.patient.full_name).toBe('Test Patient');
      expect(staffView.body.patient_notes).toBe('ألم في الضرس');
      code = ok.body.code;
      expect(mail.outbox.get(email)?.text).toContain(code); // the reception code was emailed after commit
      const twice = await http().post(`/public/booking/holds/${holdId}/confirm`).send({ host: HOST, code: otp }).expect(409);
      expect(twice.body.code).toBe('hold_expired');
    });
  });

  describe('reception', () => {
    it('sees the booking in the day list; another clinic does not', async () => {
      const day = await http().get('/appointments').query({ date, branchId: NASR }).set(as('receptionA')).expect(200);
      const mine = day.body.appointments.find((a: { id: string }) => a.id === holdId);
      expect(mine).toMatchObject({ status: 'confirmed', source: 'website', doctor: { name_en: 'Dr. Ahmed Salah' }, service: { duration_minutes: 20 } });
      await http().get(`/appointments/${holdId}`).set(as('ownerB')).expect(404);
    });

    it('checks the patient in with the code, once', async () => {
      const bad = await http().post('/appointments/check-in').set(as('receptionA')).send({ code: code === '000000' ? '000001' : '000000', branchId: NASR }).expect(404);
      expect(bad.body.code).toBe('code_invalid');
      const res = await http().post('/appointments/check-in').set(as('receptionA')).send({ code, branchId: NASR }).expect(200);
      expect(res.body.result).toMatchObject({ appointment_id: holdId, amount_due_minor: 30000, paid_online_minor: 0 });
      expect(res.body.appointment.status).toBe('checked_in');
      await http().post('/appointments/check-in').set(as('receptionA')).send({ code, branchId: NASR }).expect(404);
    });

    it('a doctor may only move their own visits; the lifecycle is enforced', async () => {
      const notOwn = await http().post(`/appointments/${holdId}/complete`).set(as('doctorA')).expect(403); // Dr. Mona vs Dr. Ahmed's visit
      expect(notOwn.body.code).toBe('missing_permission');
      const confirmAgain = await http().post(`/appointments/${holdId}/confirm`).set(as('ownerA')).expect(409);
      expect(confirmAgain.body.code).toBe('invalid_transition');
      const cancelled = await http().post(`/appointments/${holdId}/cancel`).set(as('ownerA')).send({ reason: 'patient left' }).expect(200);
      expect(cancelled.body).toMatchObject({ status: 'cancelled', cancel_reason: 'patient left' });
      made.splice(made.indexOf(holdId), 1);
    });

    it('staff book inside the schedule, or outside it with an override reason and permission', async () => {
      const free = await http().get('/public/booking/slots').query({ host: HOST, branchId: NASR, serviceId: CONSULT, doctorId: MONA, date }).expect(200);
      const startsAt = pick(free.body.slots as { startsAt: string }[]).startsAt;
      const booked = await http().post('/appointments').set(as('receptionA')).send({ patientId: OMAR, branchId: NASR, doctorId: MONA, serviceId: CONSULT, startsAt, source: 'phone' }).expect(201);
      made.push(booked.body.id);
      expect(booked.body).toMatchObject({ status: 'confirmed', source: 'phone', patient: { id: OMAR }, quoted_price_minor: 30000 });
      const taken = await http().post('/appointments').set(as('receptionA')).send({ patientId: OMAR, branchId: NASR, doctorId: MONA, serviceId: CONSULT, startsAt, source: 'phone' }).expect(409);
      expect(['slot_taken', 'outside_schedule']).toContain(taken.body.code); // availability hides it; the DB constraint is the final guard
      const morning = `${date}T09:00:00+02:00`;
      const outside = await http().post('/appointments').set(as('receptionA')).send({ patientId: OMAR, branchId: NASR, doctorId: MONA, startsAt: morning, source: 'walk_in' }).expect(409);
      expect(outside.body.code).toBe('outside_schedule');
      const override = await http().post('/appointments').set(as('receptionA')).send({ patientId: OMAR, branchId: NASR, doctorId: MONA, startsAt: morning, source: 'walk_in', overrideReason: 'doctor came in early' }).expect(201);
      made.push(override.body.id);
      expect(override.body.status).toBe('confirmed');
    });
  });

  describe('review fixes', () => {
    /** The public summary carries no patient (review R11): staff look the appointment up. */
    const patientOf = async (appointmentId: string): Promise<string> =>
      (await http().get(`/appointments/${appointmentId}`).set(as('receptionA')).expect(200)).body.patient.id;

    /** The whole website flow for one visitor; returns the booking summary. */
    async function bookOnline(o: { fullName: string; phone: string; email: string; doctorId?: string }) {
      const free = await http().get('/public/booking/slots').query({ host: HOST, branchId: NASR, serviceId: CONSULT, doctorId: o.doctorId ?? AHMED, date }).expect(200);
      const startsAt = pick(free.body.slots as { startsAt: string }[]).startsAt;
      const hold = await http().post('/public/booking/holds').send({ host: HOST, branchId: NASR, serviceId: CONSULT, doctorId: o.doctorId ?? AHMED, startsAt }).expect(201);
      made.push(hold.body.holdId);
      await http().post(`/public/booking/holds/${hold.body.holdId}/details`).send({ host: HOST, fullName: o.fullName, phone: o.phone, email: o.email }).expect(201);
      const otp = /(\d{6})/.exec(mail.outbox.get(o.email)?.text ?? '')?.[1] ?? '';
      return http().post(`/public/booking/holds/${hold.body.holdId}/confirm`).send({ host: HOST, code: otp });
    }

    it('a released hold frees the slot at once; releasing twice is harmless', async () => {
      const free = await http().get('/public/booking/slots').query({ host: HOST, branchId: NASR, serviceId: CONSULT, doctorId: AHMED, date }).expect(200);
      const startsAt = pick(free.body.slots as { startsAt: string }[]).startsAt;
      const hold = await http().post('/public/booking/holds').send({ host: HOST, branchId: NASR, serviceId: CONSULT, doctorId: AHMED, startsAt }).expect(201);
      await http().post(`/public/booking/holds/${hold.body.holdId}/release`).send({ host: HOST }).expect(204);
      const after = await http().get('/public/booking/slots').query({ host: HOST, branchId: NASR, serviceId: CONSULT, doctorId: AHMED, date }).expect(200);
      expect(after.body.slots.map((s: { startsAt: string }) => s.startsAt)).toContain(startsAt);
      await http().post(`/public/booking/holds/${hold.body.holdId}/release`).send({ host: HOST }).expect(204);
      const late = await http().post(`/public/booking/holds/${hold.body.holdId}/details`).send({ host: HOST, fullName: 'Late', phone: '+201000000998', email: 'late@example.test' }).expect(409);
      expect(late.body.code).toBe('hold_expired');
    });

    it('a returning patient booking with a different email keeps the one on file: flagged for review, audited (review R11)', async () => {
      const before = (await http().get(`/patients/${await patientOf((await bookOnline({ fullName: 'Test Patient', phone, email })).body.appointmentId)}`).set(as('ownerA')).expect(200)).body;
      if (before.needs_review) await http().patch(`/patients/${before.id}`).set(as('ownerA')).send({ needsReview: false }).expect(200);
      const newEmail = `returning.${Date.now()}@example.test`;
      const res = await bookOnline({ fullName: 'Test Patient', phone, email: newEmail });
      expect(res.status).toBe(201);
      const patientId = await patientOf(res.body.appointmentId);
      expect(patientId).toBe(before.id);
      const profile = await http().get(`/patients/${patientId}`).set(as('ownerA')).expect(200);
      expect(profile.body.email).toBe(before.email);
      expect(profile.body.needs_review).toBe(true);
      expect(mail.outbox.get(newEmail)?.text).toContain(res.body.code); // this booking's code still goes to the verified address
      const log = await http().get(`/patients/${patientId}/activity`).set(as('ownerA')).expect(200);
      expect(log.body.find((e: { action: string; changes: { via?: string } }) => e.action === 'patient.booking_contact_differs' && e.changes?.via === 'website_booking')).toBeTruthy();
    });

    it('a blocked patient is refused online and gets no duplicate record', async () => {
      const blockedPhone = `+20101${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
      const first = await bookOnline({ fullName: 'Blocked Person', phone: blockedPhone, email: `b1.${Date.now()}@example.test` });
      const patientId = await patientOf(first.body.appointmentId);
      await http().patch(`/patients/${patientId}`).set(as('receptionA')).send({ isBlocked: true }).expect(200);
      const again = await bookOnline({ fullName: 'Blocked Person', phone: blockedPhone, email: `b2.${Date.now()}@example.test` });
      expect(again.status).toBe(403);
      expect(again.body.code).toBe('booking_refused');
      const same = await http().get('/patients').query({ q: blockedPhone }).set(as('receptionA')).expect(200);
      expect(same.body.items).toHaveLength(1);
    });

    it('reception checks in a staff booking without a code; a website booking needs a reason', async () => {
      const free = await http().get('/appointments/availability').query({ branchId: NASR, doctorId: MONA, serviceId: CONSULT, date }).set(as('receptionA')).expect(200);
      const staff = await http().post('/appointments').set(as('receptionA'))
        .send({ patientId: OMAR, branchId: NASR, doctorId: MONA, serviceId: CONSULT, startsAt: pick(free.body.slots as string[]), source: 'walk_in' }).expect(201);
      made.push(staff.body.id);
      expect(staff.body.has_code).toBe(false);
      const arrived = await http().post(`/appointments/${staff.body.id}/arrive`).set(as('receptionA')).send({}).expect(200);
      expect(arrived.body.status).toBe('checked_in');
      await http().post(`/appointments/${staff.body.id}/start`).set(as('receptionA')).expect(200);
      expect((await http().post(`/appointments/${staff.body.id}/complete`).set(as('receptionA')).expect(200)).body.status).toBe('completed');

      const web = await bookOnline({ fullName: 'Code Holder', phone: `+20102${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, email: `code.${Date.now()}@example.test` });
      expect((await http().get(`/appointments/${web.body.appointmentId}`).set(as('receptionA')).expect(200)).body.has_code).toBe(true);
      const noNote = await http().post(`/appointments/${web.body.appointmentId}/arrive`).set(as('receptionA')).send({}).expect(400);
      expect(noNote.body.code).toBe('note_required');
      const withNote = await http().post(`/appointments/${web.body.appointmentId}/arrive`).set(as('receptionA')).send({ note: 'ID checked, phone lost' }).expect(200);
      expect(withNote.body).toMatchObject({ status: 'checked_in', has_code: false });
      await http().post(`/appointments/${web.body.appointmentId}/arrive`).set(as('doctorA')).send({ note: 'not my job' }).expect(403);
    });
  });
});
