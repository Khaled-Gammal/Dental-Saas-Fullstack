import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';

const NASR = 'd0000000-0000-0000-0000-0000000000a1';
const RECEPTIONIST_ROLE = 'a0000000-0000-0000-0000-0000000000a2';
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const plusMonths = (n: number) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

describe('Billing: discounts with approval, installments, waivers and write-offs (e2e, Phase E2)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const run = `${Date.now()}`.slice(-7);
  let patientId: string;
  const draft = async (amount: number) =>
    (await http().post('/invoices').set(as('receptionA')).send({ patientId, branchId: NASR, lines: [{ description: `علاج ${run}`, unitPriceMinor: amount }] }).expect(201)).body;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['accountantA', 'accountant.a@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
    patientId = (await http().post('/patients').set(as('receptionA')).send({ fullName: `مريض خصم ${run}`, phone: `0104${run}` }).expect(201)).body.id;
  });
  afterAll(async () => {
    await http().patch(`/discounts/limits/${RECEPTIONIST_ROLE}`).set(as('ownerA')).send({ maxDiscountBp: 1000, maxDiscountMinor: null });
    await app.close();
  });

  it('a discount within the role limit applies; above it waits for the owner; issuing waits too (DISC-001…003)', async () => {
    const inv = await draft(100000);
    await http().put(`/invoices/${inv.id}/discount`).set(as('receptionA')).send({ type: 'percent', value: 1000 }).expect(400); // no reason
    const ok = (await http().put(`/invoices/${inv.id}/discount`).set(as('receptionA')).send({ type: 'percent', value: 1000, reason: 'مريض دائم' }).expect(200)).body;
    expect(ok).toMatchObject({ discount_minor: 10000, discount_status: 'within_limit', discount_requested_by_name: 'Sara Mohamed' });
    const over = (await http().put(`/invoices/${inv.id}/discount`).set(as('receptionA')).send({ type: 'percent', value: 1500, reason: 'مريض دائم' }).expect(200)).body;
    expect(over).toMatchObject({ discount_minor: 15000, discount_status: 'pending' });
    expect((await http().post(`/invoices/${inv.id}/issue`).set(as('receptionA')).expect(409)).body.code).toBe('discount_pending_approval');
    await http().post(`/invoices/${inv.id}/discount/approve`).set(as('receptionA')).send({}).expect(403);
    await http().post(`/invoices/${inv.id}/discount/approve`).set(as('accountantA')).send({}).expect(403); // CLR-02: the accountant does not approve
    expect((await http().get('/discounts/pending').set(as('ownerA')).expect(200)).body.map((x: { id: string }) => x.id)).toContain(inv.id);
    const approved = (await http().post(`/invoices/${inv.id}/discount/approve`).set(as('ownerA')).send({ note: 'موافق' }).expect(200)).body;
    expect(approved).toMatchObject({ discount_status: 'approved', discount_decided_by_name: 'Dr. Ahmed Salah' });
    expect((await http().post(`/invoices/${inv.id}/issue`).set(as('receptionA')).expect(200)).body).toMatchObject({ status: 'issued', total_minor: 85000 });
  });

  it('a change after approval is measured again; a rejection blocks issuing; line discounts count too', async () => {
    const inv = await draft(200000);
    const line = inv.lines[0].id;
    const l = (await http().put(`/invoices/${inv.id}/lines/${line}/discount`).set(as('receptionA')).send({ type: 'amount', value: 30000, reason: 'حالة إنسانية' }).expect(200)).body;
    expect(l).toMatchObject({ subtotal_minor: 170000, discount_status: 'pending' }); // 15 % > 10 %
    const rejected = (await http().post(`/invoices/${inv.id}/discount/reject`).set(as('ownerA')).send({ note: 'الحد الأقصى 10 %' }).expect(200)).body;
    expect(rejected).toMatchObject({ discount_status: 'rejected', discount_note: 'الحد الأقصى 10 %' });
    expect((await http().post(`/invoices/${inv.id}/issue`).set(as('receptionA')).expect(409)).body.code).toBe('discount_pending_approval');
    const lowered = (await http().put(`/invoices/${inv.id}/lines/${line}/discount`).set(as('receptionA')).send({ type: 'amount', value: 20000, reason: 'حالة إنسانية' }).expect(200)).body;
    expect(lowered.discount_status).toBe('within_limit');
    await http().post(`/invoices/${inv.id}/issue`).set(as('receptionA')).expect(200);
  });

  it('the owner sets role limits (DISC-002)', async () => {
    const limits = (await http().get('/discounts/limits').set(as('ownerA')).expect(200)).body;
    expect(limits.find((r: { id: string }) => r.id === RECEPTIONIST_ROLE)).toMatchObject({ max_discount_bp: 1000 });
    await http().patch(`/discounts/limits/${RECEPTIONIST_ROLE}`).set(as('receptionA')).send({ maxDiscountBp: 5000, maxDiscountMinor: null }).expect(403);
    await http().patch(`/discounts/limits/${RECEPTIONIST_ROLE}`).set(as('ownerA')).send({ maxDiscountBp: 2000, maxDiscountMinor: 50000 }).expect(200);
    const inv = await draft(100000);
    expect((await http().put(`/invoices/${inv.id}/discount`).set(as('receptionA')).send({ type: 'percent', value: 1500, reason: 'عرض' }).expect(200)).body.discount_status)
      .toBe('within_limit');
  });

  describe('installments, waivers, write-offs (PAY-004, PAY-006)', () => {
    let invoiceId: string;
    let ins: { id: string }[];

    it('the open balance is split into dated installments that must add up; one plan per invoice', async () => {
      const inv = await draft(300000);
      invoiceId = inv.id;
      await http().post(`/invoices/${invoiceId}/issue`).set(as('receptionA')).expect(200);
      const bad = [{ dueDate: plusMonths(1), amountMinor: 100000 }, { dueDate: plusMonths(2), amountMinor: 100000 }];
      expect((await http().post(`/invoices/${invoiceId}/plan`).set(as('receptionA')).send({ installments: bad }).expect(400)).body.code).toBe('installments_total_mismatch');
      const good = [...bad, { dueDate: plusMonths(3), amountMinor: 100000 }];
      const v = (await http().post(`/invoices/${invoiceId}/plan`).set(as('receptionA')).send({ installments: good }).expect(201)).body;
      ins = v.plan.installments;
      expect(v.plan).toMatchObject({ status: 'active', total_minor: 300000, down_payment_minor: 0 });
      expect(ins).toHaveLength(3);
      expect((await http().post(`/invoices/${invoiceId}/plan`).set(as('receptionA')).send({ installments: good }).expect(409)).body.code).toBe('plan_exists');
    });

    it('an installment is paid; it is overdue the day after its date', async () => {
      expect((await http().post(`/invoices/${invoiceId}/payments`).set(as('receptionA')).send({ amountMinor: 150000, method: 'cash', installmentId: ins[0]!.id, idempotencyKey: `i1-${run}` })
        .expect(400)).body.code).toBe('amount_exceeds_installment');
      const v = (await http().post(`/invoices/${invoiceId}/payments`).set(as('receptionA')).send({ amountMinor: 100000, method: 'cash', installmentId: ins[0]!.id, idempotencyKey: `i1b-${run}` })
        .expect(201)).body;
      expect(v.plan.installments[0]).toMatchObject({ status: 'paid', paid_minor: 100000 });
      await http().patch(`/installments/${ins[1]!.id}`).set(as('receptionA')).send({ dueDate: yesterday() }).expect(200);
      const overdue = (await http().get('/installments/overdue').set(as('accountantA')).expect(200)).body.items.map((x: { id: string }) => x.id);
      expect(overdue).toContain(ins[1]!.id);
    });

    it('the owner waives an installment with a reason; the rest is paid and the plan completes (CLR-12)', async () => {
      await http().post(`/installments/${ins[1]!.id}/waive`).set(as('receptionA')).send({ reason: 'ظروف خاصة' }).expect(403);
      const w = (await http().post(`/installments/${ins[1]!.id}/waive`).set(as('ownerA')).send({ reason: 'ظروف خاصة' }).expect(200)).body;
      expect(w).toMatchObject({ adjusted_minor: 100000, balance_minor: 100000, status: 'partially_paid' });
      expect(w.plan.installments[1]).toMatchObject({ status: 'waived', waived_reason: 'ظروف خاصة' });
      expect(w.adjustments).toEqual([expect.objectContaining({ kind: 'waiver', amount_minor: 100000, created_by_name: 'Dr. Ahmed Salah' })]);
      const done = (await http().post(`/invoices/${invoiceId}/payments`).set(as('receptionA')).send({ amountMinor: 100000, method: 'card', installmentId: ins[2]!.id, idempotencyKey: `i3-${run}` })
        .expect(201)).body;
      expect(done).toMatchObject({ status: 'paid', balance_minor: 0, plan: { status: 'completed' } });
    });

    it('the owner writes off a small remainder; never more than what is owed', async () => {
      const inv = await draft(50050);
      await http().post(`/invoices/${inv.id}/issue`).set(as('receptionA')).expect(200);
      await http().post(`/invoices/${inv.id}/payments`).set(as('receptionA')).send({ amountMinor: 50000, method: 'cash', idempotencyKey: `w-${run}` }).expect(201);
      expect((await http().post(`/invoices/${inv.id}/write-off`).set(as('ownerA')).send({ amountMinor: 51, reason: 'كسور' }).expect(400)).body.code).toBe('amount_exceeds_balance');
      await http().post(`/invoices/${inv.id}/write-off`).set(as('accountantA')).send({ amountMinor: 50, reason: 'كسور' }).expect(403);
      const w = (await http().post(`/invoices/${inv.id}/write-off`).set(as('ownerA')).send({ amountMinor: 50, reason: 'كسور' }).expect(201)).body;
      expect(w).toMatchObject({ status: 'paid', paid_minor: 50000, adjusted_minor: 50, balance_minor: 0 });
    });
  });
});
