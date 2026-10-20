import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';

const NASR = 'd0000000-0000-0000-0000-0000000000a1';
const SCALING = '90000000-0000-0000-0000-0000000000a2'; // 600.00
const FILLING = '90000000-0000-0000-0000-0000000000a3'; // 800.00–1200.00

describe('Billing: invoices, payments, reversals, refunds (e2e, Phase E1)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const run = `${Date.now()}`.slice(-7);
  let patientId: string;
  let procedureId: string;
  let invoiceId: string;
  let instapayId: string;
  let cardId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['doctorA', 'doctor.a@demo.test'],
      ['accountantA', 'accountant.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
    patientId = (await http().post('/patients').set(as('receptionA')).send({ fullName: `مريض فاتورة ${run}`, phone: `0106${run}` }).expect(201)).body.id;
    const visitId = (await http().post('/visits').set(as('doctorA')).send({ patientId, branchId: NASR }).expect(201)).body.id;
    procedureId = (await http().post(`/visits/${visitId}/procedures`).set(as('doctorA')).send({ serviceId: FILLING, toothCode: 36, surfaces: ['O'], priceMinor: 100000 }).expect(201)).body.procedures[0].id;
  });
  afterAll(async () => { await app.close(); });

  it('shows unbilled work; reception drafts an invoice from the procedure and a service line', async () => {
    const before = (await http().get(`/patients/${patientId}/billing`).set(as('receptionA')).expect(200)).body;
    expect(before).toMatchObject({ currency: 'EGP', balance_minor: 0 });
    expect(before.unbilled.map((p: { id: string }) => p.id)).toEqual([procedureId]);
    const inv = (await http().post('/invoices').set(as('receptionA')).send({ patientId, branchId: NASR, procedureIds: [procedureId], lines: [{ serviceId: SCALING }] }).expect(201)).body;
    invoiceId = inv.id;
    expect(inv).toMatchObject({ status: 'draft', number: null, subtotal_minor: 160000, currency: 'EGP', can: { issue: true, pay: false } });
    expect(inv.lines.map((l: { description: string }) => l.description)).toEqual(['حشو تجميلي — سن 36 (O)', 'تنظيف الجير والتلميع']);
    expect((await http().post('/invoices').set(as('receptionA')).send({ patientId, branchId: NASR, procedureIds: [procedureId] }).expect(400)).body.code).toBe('procedure_not_billable');
    await http().post('/invoices').set(as('doctorA')).send({ patientId, branchId: NASR, lines: [{ serviceId: SCALING }] }).expect(403);
  });

  it('the doctor sees their own patient\'s billing, not others\'; the accountant sees all; another clinic nothing', async () => {
    await http().get(`/patients/${patientId}/billing`).set(as('doctorA')).expect(200);
    // a patient Dr. Mona has never seen or booked (not a seed patient: other suites book those with her)
    const stranger = (await http().post('/patients').set(as('receptionA')).send({ fullName: `لم يزر د. منى ${run}`, phone: `0105${run}` }).expect(201)).body.id;
    expect((await http().get(`/patients/${stranger}/billing`).set(as('doctorA')).expect(403)).body.code).toBe('missing_permission');
    await http().get(`/invoices/${invoiceId}`).set(as('accountantA')).expect(200);
    await http().get(`/invoices/${invoiceId}`).set(as('ownerB')).expect(404);
  });

  it('issuing numbers and locks the invoice', async () => {
    const issued = (await http().post(`/invoices/${invoiceId}/issue`).set(as('receptionA')).expect(200)).body;
    expect(issued.status).toBe('issued');
    expect(issued.number).toMatch(/^SMA-\d{4}-\d{5}$/);
    expect(issued.total_minor).toBe(160000 + issued.tax_minor);
    const line = issued.lines[1].id;
    expect((await http().delete(`/invoices/${invoiceId}/lines/${line}`).set(as('receptionA')).expect(409)).body.code).toBe('invoice_locked');
    expect((await http().post(`/invoices/${invoiceId}/issue`).set(as('receptionA')).expect(409)).body.code).toBe('invoice_locked');
    expect((await http().patch('/clinic/profile').set(as('ownerA')).send({ currency: 'USD' }).expect(409)).body.code).toBe('currency_locked');
  });

  it('records partial payments by method with references; a repeated request records once; no overpayment', async () => {
    const total = (await http().get(`/invoices/${invoiceId}`).set(as('receptionA')).expect(200)).body.total_minor as number;
    expect((await http().post(`/invoices/${invoiceId}/payments`).set(as('receptionA')).send({ amountMinor: 1000, method: 'wallet', idempotencyKey: `w-${run}` }).expect(400)).body.code)
      .toBe('reference_required');
    expect((await http().post(`/invoices/${invoiceId}/payments`).set(as('receptionA')).send({ amountMinor: total + 1, method: 'cash', idempotencyKey: `o-${run}` }).expect(400)).body.code)
      .toBe('amount_exceeds_balance');
    const body = { amountMinor: 60000, method: 'instapay', reference: 'IP-55', idempotencyKey: `i-${run}` };
    await http().post(`/invoices/${invoiceId}/payments`).set(as('receptionA')).send(body).expect(201);
    const twice = (await http().post(`/invoices/${invoiceId}/payments`).set(as('receptionA')).send(body).expect(201)).body;
    expect(twice.payments).toHaveLength(1);
    expect(twice).toMatchObject({ status: 'partially_paid', paid_minor: 60000 });
    instapayId = twice.payments[0].id;
    const paid = (await http().post(`/invoices/${invoiceId}/payments`).set(as('receptionA')).send({ amountMinor: total - 60000, method: 'card', idempotencyKey: `c-${run}` }).expect(201)).body;
    expect(paid).toMatchObject({ status: 'paid', balance_minor: 0 });
    cardId = paid.payments[1].id;
    await http().post(`/invoices/${invoiceId}/payments`).set(as('doctorA')).send({ amountMinor: 1, method: 'cash', idempotencyKey: `d-${run}` }).expect(403);
  });

  it('the receipt names who received the money', async () => {
    const r = (await http().get(`/payments/${instapayId}`).set(as('receptionA')).expect(200)).body;
    expect(r).toMatchObject({ amount_minor: 60000, method: 'instapay', reference: 'IP-55', received_by_name: 'Sara Mohamed', invoice: { id: invoiceId } });
  });

  it('a payment entered in error is reversed by its receiver the same day (CLR-05), and stays visible', async () => {
    await http().post(`/payments/${instapayId}/reverse`).set(as('accountantA')).send({ reason: 'خطأ' }).expect(403); // no payments:reverse
    const after = (await http().post(`/payments/${instapayId}/reverse`).set(as('receptionA')).send({ reason: 'سُجلت مرتين' }).expect(200)).body;
    expect(after).toMatchObject({ status: 'partially_paid', balance_minor: 60000 });
    expect(after.payments[0]).toMatchObject({ status: 'reversed', reversal_reason: 'سُجلت مرتين', reversed_by_name: 'Sara Mohamed' });
    expect((await http().post(`/payments/${instapayId}/reverse`).set(as('receptionA')).send({ reason: 'مرة أخرى' }).expect(409)).body.code).toBe('payment_not_reversible');
  });

  it('refunds: the accountant returns money by any method with a reason; the balance reopens', async () => {
    await http().post(`/payments/${cardId}/refunds`).set(as('receptionA')).send({ amountMinor: 1000, method: 'cash', reason: 'ارجاع' }).expect(403); // no payments:refund
    const after = (await http().post(`/payments/${cardId}/refunds`).set(as('accountantA')).send({ amountMinor: 20000, method: 'cash', reason: 'إلغاء التنظيف' }).expect(201)).body;
    expect(after.payments[1]).toMatchObject({ status: 'partially_refunded', refunds: [expect.objectContaining({ amount_minor: 20000, method: 'cash', created_by_name: 'Mahmoud Ibrahim' })] });
    expect(after.balance_minor).toBe(80000);
    expect((await http().post(`/payments/${cardId}/refunds`).set(as('accountantA')).send({ amountMinor: 10_000_000, method: 'cash', reason: 'كثير' }).expect(400)).body.code).toBe('refund_exceeds_payment');
    expect((await http().get(`/patients/${patientId}/billing`).set(as('receptionA')).expect(200)).body.balance_minor).toBe(80000);
  });

  it('voiding needs nothing paid and a reason; a void invoice frees its procedures', async () => {
    expect((await http().post(`/invoices/${invoiceId}/void`).set(as('accountantA')).send({ reason: 'خطأ في الإصدار' }).expect(409)).body.code).toBe('invoice_has_payments');
    const second = (await http().post('/invoices').set(as('receptionA')).send({ patientId, branchId: NASR, lines: [{ description: 'صورة أشعة', unitPriceMinor: 15000 }] }).expect(201)).body.id;
    await http().post(`/invoices/${second}/issue`).set(as('receptionA')).expect(200);
    await http().post(`/invoices/${second}/void`).set(as('receptionA')).send({ reason: 'خطأ في الإصدار' }).expect(403); // no invoices:void
    await http().post(`/invoices/${second}/void`).set(as('accountantA')).send({ reason: 'x' }).expect(400);
    expect((await http().post(`/invoices/${second}/void`).set(as('accountantA')).send({ reason: 'أُصدرت بالخطأ' }).expect(200)).body).toMatchObject({ status: 'void', void_reason: 'أُصدرت بالخطأ' });
    const draft = (await http().post('/invoices').set(as('receptionA')).send({ patientId, branchId: NASR, lines: [{ serviceId: SCALING }] }).expect(201)).body.id;
    await http().delete(`/invoices/${draft}`).set(as('receptionA')).expect(204);
    await http().get(`/invoices/${draft}`).set(as('receptionA')).expect(404);
  });

  it('the list pages with "load more": each page continues the last, nothing repeats or is skipped; an id from another clinic gives nothing', async () => {
    for (let i = 0; i < 3; i++) await http().post('/invoices').set(as('receptionA')).send({ patientId, branchId: NASR, lines: [{ serviceId: SCALING }] }).expect(201);
    const ids = (r: request.Response) => (r.body as { id: string }[]).map((x) => x.id);
    const first = ids(await http().get('/invoices?limit=2').set(as('accountantA')).expect(200));
    const next = ids(await http().get(`/invoices?limit=2&after=${first[1]}`).set(as('accountantA')).expect(200));
    expect(first).toHaveLength(2);
    expect(next).toHaveLength(2);
    expect(new Set([...first, ...next]).size).toBe(4);
    // other suites may add invoices meanwhile; they are newer, so they come before: the two pages stay one unbroken run
    const all = ids(await http().get('/invoices?limit=200').set(as('accountantA')).expect(200));
    const at = all.indexOf(first[0]);
    expect(all.slice(at, at + 4)).toEqual([...first, ...next]);
    expect((await http().get(`/invoices?after=${first[0]}`).set(as('ownerB')).expect(200)).body).toEqual([]);
    await http().get('/invoices?after=not-an-id').set(as('accountantA')).expect(400);
  });
});
