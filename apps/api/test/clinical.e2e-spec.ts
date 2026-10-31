import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';

const NASR = 'd0000000-0000-0000-0000-0000000000a1';
const AHMED = 'f0000000-0000-0000-0000-0000000000a1'; // the owner's doctor profile
const MONA = 'f0000000-0000-0000-0000-0000000000a2'; // doctor.a
const SCALING = '90000000-0000-0000-0000-0000000000a2'; // 600.00
const FILLING = '90000000-0000-0000-0000-0000000000a3'; // 800.00–1200.00

/** A Saturday 10–40 weeks ahead (doctors work Sat 17:00–22:00), random so reruns rarely collide with their leftovers. */
function farSaturday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7) + 7 * (10 + Math.floor(Math.random() * 30)));
  return d.toISOString().slice(0, 10);
}

describe('Clinical: visits, notes, procedures, plans, prescriptions, chart, follow-ups (e2e, Phase D4)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const run = `${Date.now()}`.slice(-7);
  let date = farSaturday(); // re-picked in beforeAll until both doctors have a mostly free day
  let patientId: string;

  /** A staff booking at a free slot of the day (asked each time: a booking also blocks its neighbours); checked in when asked. */
  const book = async (doctorId: string, arrive = true): Promise<string> => {
    const free: string[] = (await http().get('/appointments/availability').query({ branchId: NASR, doctorId, date }).set(as('receptionA')).expect(200)).body.slots;
    const startsAt = free[Math.floor(Math.random() * free.length)];
    const id = (await http().post('/appointments').set(as('receptionA')).send({ patientId, branchId: NASR, doctorId, startsAt, source: 'phone' }).expect(201)).body.id as string;
    if (arrive) await http().post(`/appointments/${id}/arrive`).set(as('receptionA')).send({}).expect(200);
    return id;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['doctorA', 'doctor.a@demo.test'],
      ['accountantA', 'accountant.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
    // The test database keeps earlier runs' bookings, and other suites book these doctors on random far Saturdays
    // too; a day that is already nearly full leaves the later tests without a free slot. Pick a free day.
    const slots = async (doctorId: string): Promise<number> =>
      (await http().get('/appointments/availability').query({ branchId: NASR, doctorId, date }).set(as('receptionA')).expect(200)).body.slots.length;
    for (let i = 0; i < 20 && ((await slots(MONA)) < 15 || (await slots(AHMED)) < 15); i++) date = farSaturday();
    patientId =(await http().post('/patients').set(as('receptionA')).send({ fullName: `منى زيارة ${run}`, phone: `0108${run}`, dateOfBirth: '1988-03-02' }).expect(201)).body.id;
    await http().put(`/patients/${patientId}/medical-history`).set(as('doctorA'))
      .send({ allergies: ['Penicillin'], conditions: ['سكري'], medications: [], isPregnant: null, isSmoker: false, notes: null }).expect(200);
  });
  afterAll(async () => { await app.close(); });

  describe('visits (VISIT-001, VISIT-002, PATIENT-005)', () => {
    let apptId: string;
    let visitId: string;

    it('the doctor opens the visit of their checked-in patient, once; it starts the appointment', async () => {
      apptId = await book(MONA);
      expect((await http().post('/visits').set(as('receptionA')).send({ appointmentId: apptId }).expect(403)).body.code).toBe('missing_permission');
      const opened = await http().post('/visits').set(as('doctorA')).send({ appointmentId: apptId }).expect(201);
      expect(opened.body.created).toBe(true);
      visitId = opened.body.id;
      expect((await http().post('/visits').set(as('doctorA')).send({ appointmentId: apptId }).expect(201)).body).toEqual({ id: visitId, created: false });
      const appt = (await http().get(`/appointments/${apptId}`).set(as('receptionA')).expect(200)).body;
      expect(appt).toMatchObject({ status: 'in_progress', visit_id: visitId }); // reception sees that the visit exists
    });

    it('refuses another doctor\'s appointment and one that has not arrived', async () => {
      const ahmeds = await book(AHMED);
      expect((await http().post('/visits').set(as('doctorA')).send({ appointmentId: ahmeds }).expect(403)).body.code).toBe('not_your_appointment');
      const notHere = await book(MONA, false);
      expect((await http().post('/visits').set(as('doctorA')).send({ appointmentId: notHere }).expect(409)).body.code).toBe('appointment_not_in_progress');
    });

    it('shows the allergy alert on the visit; reception (no clinical:read) and the accountant cannot read it', async () => {
      const v = (await http().get(`/visits/${visitId}`).set(as('doctorA')).expect(200)).body;
      expect(v.patient.medicalHistory.allergies).toEqual(['Penicillin']);
      expect(v.can).toMatchObject({ writeNotes: true, amend: false, procedures: true, prescribe: true });
      await http().get(`/visits/${visitId}`).set(as('receptionA')).expect(403);
      await http().get(`/visits/${visitId}`).set(as('accountantA')).expect(403);
      await http().get(`/visits/${visitId}`).set(as('ownerB')).expect(404);
    });

    it('notes are a draft until finalized; then amended with a reason, the original kept', async () => {
      await http().patch(`/visits/${visitId}`).set(as('doctorA')).send({ chiefComplaint: 'ألم في الضرس 36', diagnosis: 'تسوس' }).expect(200);
      const final = (await http().post(`/visits/${visitId}/finalize`).set(as('doctorA')).expect(200)).body;
      expect(final).toMatchObject({ status: 'final', diagnosis: 'تسوس', finalized_by_name: 'Dr. Mona Hassan' });
      expect((await http().patch(`/visits/${visitId}`).set(as('doctorA')).send({ diagnosis: 'x' }).expect(409)).body.code).toBe('visit_finalized');
      await http().post(`/visits/${visitId}/amendments`).set(as('doctorA')).send({ field: 'diagnosis', text: 'التهاب لب', reason: '' }).expect(400);
      const amended = (await http().post(`/visits/${visitId}/amendments`).set(as('doctorA'))
        .send({ field: 'diagnosis', text: 'التهاب لب الضرس', reason: 'بعد الأشعة' }).expect(201)).body;
      expect(amended.diagnosis).toBe('تسوس');
      expect(amended.amendments).toEqual([expect.objectContaining({ field: 'diagnosis', new_text: 'التهاب لب الضرس', reason: 'بعد الأشعة', author_name: 'Dr. Mona Hassan' })]);
      // the owner may amend too; reception never
      await http().post(`/visits/${visitId}/amendments`).set(as('ownerA')).send({ field: 'next_visit_note', text: 'حشو عصب', reason: 'ملاحظة المالك' }).expect(201);
      await http().post(`/visits/${visitId}/amendments`).set(as('receptionA')).send({ field: 'diagnosis', text: 'x', reason: 'xyz' }).expect(403);
    });

    it('completing the appointment finalizes a draft visit (CLR-06)', async () => {
      const appt = await book(MONA);
      const id = (await http().post('/visits').set(as('doctorA')).send({ appointmentId: appt }).expect(201)).body.id;
      await http().post(`/appointments/${appt}/complete`).set(as('doctorA')).expect(200);
      expect((await http().get(`/visits/${id}`).set(as('doctorA')).expect(200)).body.status).toBe('final');
    });
  });

  describe('plans and procedures (TPLAN-001…004, VISIT-003)', () => {
    let planId: string;
    let visitId: string;
    let fillingItem: string;
    let scalingItem: string;

    it('a doctor builds a plan; the estimate is derived; it is proposed, then accepted by a member', async () => {
      const plan = (await http().post(`/patients/${patientId}/plans`).set(as('doctorA')).send({ title: 'حشو وتنظيف' }).expect(201)).body;
      planId = plan.id;
      expect(plan).toMatchObject({ status: 'draft', doctor_id: MONA, can: { write: true } });
      await http().post(`/plans/${planId}/items`).set(as('doctorA')).send({ serviceId: FILLING, priceMinor: 50000 }).expect(400);
      await http().post(`/plans/${planId}/items`).set(as('doctorA')).send({ serviceId: FILLING, toothCode: 36, surfaces: ['D', 'O'], priceMinor: 100000, discountMinor: 10000 }).expect(201);
      const two = (await http().post(`/plans/${planId}/items`).set(as('doctorA')).send({ serviceId: SCALING }).expect(201)).body;
      [fillingItem, scalingItem] = two.items.map((i: { id: string }) => i.id);
      expect(two.total_estimate_minor).toBe(150000);
      expect(two.items[0]).toMatchObject({ tooth_code: 36, surfaces: ['O', 'D'] });
      expect((await http().post(`/plans/${planId}/status`).set(as('doctorA')).send({ to: 'accepted' }).expect(409)).body.code).toBe('invalid_transition');
      await http().post(`/plans/${planId}/status`).set(as('receptionA')).send({ to: 'proposed' }).expect(403);
      await http().post(`/plans/${planId}/status`).set(as('doctorA')).send({ to: 'proposed' }).expect(200);
      const accepted = (await http().post(`/plans/${planId}/status`).set(as('doctorA')).send({ to: 'accepted' }).expect(200)).body;
      expect(accepted).toMatchObject({ status: 'accepted', accepted_by_name: 'Dr. Mona Hassan' });
      expect((await http().post(`/plans/${planId}/items`).set(as('doctorA')).send({ serviceId: SCALING }).expect(409)).body.code).toBe('plan_locked');
      // others read plans (patients:read); an accountant sees the estimate but not the doctor's clinical note
      expect((await http().get(`/plans/${planId}`).set(as('accountantA')).expect(200)).body.next.next_visit_note).toBeNull();
    });

    it('a procedure is priced within the service range and marks its plan item done', async () => {
      visitId = (await http().post('/visits').set(as('doctorA')).send({ patientId, branchId: NASR }).expect(201)).body.id; // a walk-in
      expect((await http().post(`/visits/${visitId}/procedures`).set(as('doctorA')).send({ serviceId: FILLING, priceMinor: 50000 }).expect(400)).body.code).toBe('price_out_of_range');
      await http().post(`/visits/${visitId}/procedures`).set(as('receptionA')).send({ planItemId: fillingItem }).expect(403);
      const v = (await http().post(`/visits/${visitId}/procedures`).set(as('doctorA')).send({ planItemId: fillingItem }).expect(201)).body;
      expect(v.procedures).toEqual([expect.objectContaining({ service_id: FILLING, tooth_code: 36, surfaces: ['O', 'D'], price_minor: 100000, plan_item_id: fillingItem, billed: false })]);
      const plan = (await http().get(`/plans/${planId}`).set(as('doctorA')).expect(200)).body;
      expect(plan.status).toBe('in_progress');
      expect(plan.summary).toMatchObject({ items_done: 1, items_total: 2, remaining_estimate_minor: 60000 });
      expect(plan.next.item.id).toBe(scalingItem);
      expect((await http().post(`/visits/${visitId}/procedures`).set(as('doctorA')).send({ planItemId: fillingItem }).expect(409)).body.code).toBe('plan_item_closed');
    });

    it('removing a procedure from a draft visit reopens the item; a final visit keeps its procedures', async () => {
      const v = (await http().get(`/visits/${visitId}`).set(as('doctorA')).expect(200)).body;
      await http().delete(`/visits/${visitId}/procedures/${v.procedures[0].id}`).set(as('doctorA')).expect(200);
      expect((await http().get(`/plans/${planId}`).set(as('doctorA')).expect(200)).body).toMatchObject({ status: 'accepted', summary: { items_done: 0 } });
      const again = (await http().post(`/visits/${visitId}/procedures`).set(as('doctorA')).send({ planItemId: fillingItem }).expect(201)).body;
      await http().post(`/visits/${visitId}/finalize`).set(as('doctorA')).expect(200);
      expect((await http().delete(`/visits/${visitId}/procedures/${again.procedures[0].id}`).set(as('doctorA')).expect(409)).body.code).toBe('visit_finalized');
    });

    it('the plan shows what it was invoiced, paid and still owes; the patient’s balance shows for the day list (TPLAN-004, BILLING-005)', async () => {
      const before = (await http().get(`/plans/${planId}`).set(as('receptionA')).expect(200)).body;
      expect(before.billing).toEqual({ invoiced_minor: 0, paid_minor: 0, balance_minor: 0 });
      // the plan's filling and an unrelated cleaning on one invoice: the plan's share is its line's part of the subtotal
      const v = (await http().get(`/visits/${visitId}`).set(as('doctorA')).expect(200)).body;
      const inv = (await http().post('/invoices').set(as('receptionA')).send({ patientId, branchId: NASR, procedureIds: [v.procedures[0].id], lines: [{ serviceId: SCALING }] }).expect(201)).body;
      const issued = (await http().post(`/invoices/${inv.id}/issue`).set(as('receptionA')).expect(200)).body;
      await http().post(`/invoices/${inv.id}/payments`).set(as('receptionA')).send({ amountMinor: 30000, method: 'cash', idempotencyKey: `plan-${Date.now()}` }).expect(201);
      const line = issued.lines.find((l: { visit_procedure_id: string | null }) => l.visit_procedure_id === v.procedures[0].id).line_total_minor;
      const share = (x: number) => Math.round((x * line) / issued.subtotal_minor);
      const plan = (await http().get(`/plans/${planId}`).set(as('receptionA')).expect(200)).body;
      expect(plan.billing).toEqual({ invoiced_minor: share(issued.total_minor), paid_minor: share(30000), balance_minor: share(issued.total_minor - 30000) });
      expect((await http().get(`/plans/${planId}`).set(as('doctorA')).expect(200)).body.billing).toEqual(plan.billing); // the plan's own doctor
      expect((await http().get(`/patients/${patientId}/plans`).set(as('receptionA')).expect(200)).body.find((p: { id: string }) => p.id === planId).billing).toEqual(plan.billing);
      // the day list's balances: reception sees every patient, the doctor the patients she treats
      const owed = issued.total_minor - 30000;
      expect((await http().get('/balances').query({ patientIds: patientId }).set(as('receptionA')).expect(200)).body).toEqual({ [patientId]: owed });
      expect((await http().get('/balances').query({ patientIds: patientId }).set(as('doctorA')).expect(200)).body).toEqual({ [patientId]: owed });
      await http().get('/balances').query({ patientIds: 'not-a-uuid' }).set(as('receptionA')).expect(400);
    });

    it('cancelling the last open item completes the plan; a cancelled item stays visible', async () => {
      const plan = (await http().post(`/plans/${planId}/items/${scalingItem}/cancel`).set(as('doctorA')).expect(200)).body;
      expect(plan.status).toBe('completed');
      expect(plan.items.map((i: { status: string }) => i.status)).toEqual(['done', 'cancelled']);
      expect(plan.total_estimate_minor).toBe(90000);
      expect((await http().post(`/plans/${planId}/status`).set(as('doctorA')).send({ to: 'cancelled' }).expect(409)).body.code).toBe('invalid_transition');
    });
  });

  describe('prescriptions (VISIT-004)', () => {
    it('are issued, printed and corrected by a new prescription that keeps the old one', async () => {
      const appt = await book(MONA);
      const visitId = (await http().post('/visits').set(as('doctorA')).send({ appointmentId: appt }).expect(201)).body.id;
      await http().post(`/visits/${visitId}/prescriptions`).set(as('doctorA')).send({ items: [] }).expect(400);
      const rx = (await http().post(`/visits/${visitId}/prescriptions`).set(as('doctorA'))
        .send({ items: [{ drugName: 'Amoxicillin 500mg', dose: 'كبسولة', frequency: 'كل 8 ساعات', duration: '5 أيام' }] }).expect(201)).body;
      expect(rx).toMatchObject({ branch_id: NASR, doctor: { name_ar: 'د. منى حسن' }, patient: { id: patientId, date_of_birth: '1988-03-02' } });
      expect(rx.items).toEqual([expect.objectContaining({ drug_name: 'Amoxicillin 500mg', frequency: 'كل 8 ساعات' })]);
      const fixed = (await http().post(`/visits/${visitId}/prescriptions`).set(as('doctorA'))
        .send({ items: [{ drugName: 'Amoxicillin 500mg', frequency: 'كل 12 ساعة' }], replacesId: rx.id }).expect(201)).body;
      expect(fixed.replaces_id).toBe(rx.id);
      expect((await http().get(`/prescriptions/${rx.id}`).set(as('doctorA')).expect(200)).body.replaced_by_id).toBe(fixed.id);
      expect((await http().post(`/visits/${visitId}/prescriptions`).set(as('doctorA')).send({ items: [{ drugName: 'x' }], replacesId: rx.id }).expect(409)).body.code)
        .toBe('prescription_already_corrected');
      await http().get(`/prescriptions/${rx.id}`).set(as('accountantA')).expect(403);
    });

    it('suggests the drugs the clinic prescribes, the doctor\'s own first, with the line last written (redesign R8)', async () => {
      const list = (await http().get('/prescriptions/drugs').query({ q: 'amoxi' }).set(as('doctorA')).expect(200)).body as
        { drug_name: string; frequency: string | null; uses: number; mine: number }[];
      const amox = list.find((d) => d.drug_name === 'Amoxicillin 500mg');
      expect(amox).toBeDefined();
      expect(amox!.mine).toBeGreaterThanOrEqual(2); // the prescription and its correction above
      expect(list.every((d) => /amoxi/i.test(d.drug_name))).toBe(true);
      await http().get('/prescriptions/drugs').set(as('accountantA')).expect(403);
      await http().get('/prescriptions/drugs?limit=0').set(as('doctorA')).expect(400);
    });
  });

  describe('chart (CHART-001)', () => {
    it('entries are appended; the current chart is the latest entry per tooth', async () => {
      await http().post(`/patients/${patientId}/chart`).set(as('doctorA')).send({ entries: [{ toothCode: 36, condition: 'caries', surfaces: ['O'] }, { toothCode: 18, condition: 'missing' }] }).expect(201);
      const chart = (await http().post(`/patients/${patientId}/chart`).set(as('doctorA')).send({ entries: [{ toothCode: 36, condition: 'filled', surfaces: ['O', 'D'] }] }).expect(201)).body;
      expect(chart.current.map((c: { tooth_code: number; condition: string }) => [c.tooth_code, c.condition])).toEqual([[18, 'missing'], [36, 'filled']]);
      expect(chart.entries.filter((e: { tooth_code: number }) => e.tooth_code === 36)).toHaveLength(2);
      await http().post(`/patients/${patientId}/chart`).set(as('doctorA')).send({ entries: [{ toothCode: 19, condition: 'caries' }] }).expect(400);
      await http().post(`/patients/${patientId}/chart`).set(as('receptionA')).send({ entries: [{ toothCode: 11, condition: 'caries' }] }).expect(403);
      await http().get(`/patients/${patientId}/chart`).set(as('accountantA')).expect(403);
    });
  });

  describe('next visit and follow-ups (APPT-007, VISIT-005)', () => {
    it('reception books the next visit for a planned item; a cancelled booking puts it back to planned', async () => {
      const planId = (await http().post(`/patients/${patientId}/plans`).set(as('doctorA')).send({ title: 'تنظيف' }).expect(201)).body.id;
      const itemId = (await http().post(`/plans/${planId}/items`).set(as('doctorA')).send({ serviceId: SCALING }).expect(201)).body.items[0].id;
      const appt = await book(MONA, false);
      const linked = (await http().post(`/plans/${planId}/items/${itemId}/schedule`).set(as('receptionA')).send({ appointmentId: appt }).expect(200)).body;
      expect(linked.items[0]).toMatchObject({ status: 'scheduled', appointment_id: appt });
      await http().post(`/appointments/${appt}/cancel`).set(as('receptionA')).send({ reason: 'المريض اعتذر' }).expect(200);
      expect((await http().get(`/plans/${planId}`).set(as('receptionA')).expect(200)).body.items[0]).toMatchObject({ status: 'planned', appointment_id: null });
    });

    it('reception works the follow-up list: call, book, dismiss; nothing is sent automatically', async () => {
      const r = (await http().post(`/patients/${patientId}/recalls`).set(as('doctorA')).send({ reason: 'checkup', dueDate: '2020-01-01', notes: 'بعد 6 شهور' }).expect(201)).body;
      expect(r).toMatchObject({ status: 'pending', due_date: '2020-01-01', patient: { id: patientId } });
      const due = (await http().get('/recalls').query({ view: 'due' }).set(as('receptionA')).expect(200)).body;
      expect(due.items.map((x: { id: string }) => x.id)).toContain(r.id);
      const called = (await http().post(`/recalls/${r.id}/contact`).set(as('receptionA')).send({ note: 'لم يرد' }).expect(200)).body;
      expect(called).toMatchObject({ status: 'contacted', contact_attempts: 1 });
      expect(called.notes).toContain('Sara Mohamed: لم يرد');
      const appt = await book(MONA, false);
      expect((await http().post(`/recalls/${r.id}/book`).set(as('receptionA')).send({ appointmentId: appt }).expect(200)).body).toMatchObject({ status: 'booked', appointment_id: appt });
      await http().post(`/appointments/${appt}/cancel`).set(as('receptionA')).send({ reason: 'تأجيل' }).expect(200);
      const back = (await http().get(`/patients/${patientId}/recalls`).set(as('receptionA')).expect(200)).body.find((x: { id: string }) => x.id === r.id);
      expect(back).toMatchObject({ status: 'pending', appointment_id: null });
      expect((await http().post(`/recalls/${r.id}/dismiss`).set(as('receptionA')).send({ reason: 'سافر' }).expect(200)).body.status).toBe('dismissed');
      expect((await http().post(`/recalls/${r.id}/contact`).set(as('receptionA')).send({ note: 'x' }).expect(409)).body.code).toBe('recall_closed');
      await http().post(`/patients/${patientId}/recalls`).set(as('accountantA')).send({ reason: 'checkup', dueDate: '2031-01-01' }).expect(403);
    });

    it('another clinic sees none of it', async () => {
      await http().get(`/patients/${patientId}/plans`).set(as('ownerB')).expect(404);
      await http().get(`/patients/${patientId}/recalls`).set(as('ownerB')).expect(404);
      expect((await http().get('/recalls').query({ view: 'closed' }).set(as('ownerB')).expect(200)).body.items).toEqual([]);
    });
  });
});
