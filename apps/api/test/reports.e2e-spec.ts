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
const DR_MONA = 'f0000000-0000-0000-0000-0000000000a2';
const sum = (xs: { [k: string]: unknown }[], k: string) => xs.reduce((s, x) => s + Number(x[k] ?? 0), 0);

describe('Reports (e2e, Phase E4)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const run = `${Date.now()}`.slice(-7);
  let today: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['accountantA', 'accountant.a@demo.test'],
      ['maadi', 'reception.maadi@demo.test'], ['doctorMona', 'doctor.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
    today = (await http().get('/reports/revenue').set(as('receptionA')).expect(200)).body.today;
  });
  afterAll(async () => { await app.close(); });

  describe('revenue and collections (REPORT-001)', () => {
    it('a payment and a refund move today’s figures by exactly their amounts; every breakdown adds up to the totals', async () => {
      const q = `/reports/revenue?from=${today}&to=${today}&branchId=${NASR}`;
      const before = (await http().get(q).set(as('ownerA')).expect(200)).body;
      const patientId = (await http().post('/patients').set(as('receptionA')).send({ fullName: `مريض تقرير ${run}`, phone: `0106${run}` }).expect(201)).body.id;
      const invoiceId = (await http().post('/invoices').set(as('receptionA')).send({ patientId, branchId: NASR, lines: [{ description: `علاج ${run}`, unitPriceMinor: 300000 }] }).expect(201)).body.id;
      await http().post(`/invoices/${invoiceId}/issue`).set(as('receptionA')).expect(200);
      const cash = (await http().post(`/invoices/${invoiceId}/payments`).set(as('receptionA')).send({ amountMinor: 120000, method: 'cash', idempotencyKey: `rep-${run}-1` }).expect(201)).body;
      await http().post(`/invoices/${invoiceId}/payments`).set(as('receptionA')).send({ amountMinor: 30000, method: 'instapay', reference: `IP-${run}`, idempotencyKey: `rep-${run}-2` }).expect(201);
      const cashPaymentId = cash.payments?.find((p: { method: string }) => p.method === 'cash')?.id ?? cash.id;
      await http().post(`/payments/${cashPaymentId}/refunds`).set(as('accountantA')).send({ amountMinor: 10000, method: 'cash', reason: 'جزء لم يتم' }).expect(201);

      const after = (await http().get(q).set(as('ownerA')).expect(200)).body;
      expect(after).toMatchObject({ kind: 'revenue', scope: 'all', period: { from: today, to: today }, branch_id: NASR, currency: 'EGP' });
      expect(after.totals.invoiced - before.totals.invoiced).toBe(300000);
      expect(after.totals.collected - before.totals.collected).toBe(150000);
      expect(after.totals.refunded - before.totals.refunded).toBe(10000);
      expect(after.totals.net - before.totals.net).toBe(140000);
      const m = (r: { by_method: { method: string; net: number }[] }, k: string) => r.by_method.find((x) => x.method === k)?.net ?? 0;
      expect(m(after, 'cash') - m(before, 'cash')).toBe(110000);
      expect(m(after, 'instapay') - m(before, 'instapay')).toBe(30000);
      for (const k of ['collected', 'refunded', 'net']) expect(sum(after.by_method, k)).toBe(after.totals[k]);
      for (const k of ['invoiced', 'collected', 'net']) {
        expect(sum(after.by_branch, k)).toBe(after.totals[k]);
        expect(sum(after.by_day, k)).toBe(after.totals[k]);
      }
      expect(after.by_branch[0]).toMatchObject({ branch_id: NASR, branch: { name_ar: 'مدينة نصر' } });
    });

    it('reception sees today only; another day is refused', async () => {
      const r = (await http().get('/reports/revenue').set(as('receptionA')).expect(200)).body;
      expect(r).toMatchObject({ scope: 'today', period: { from: today, to: today } });
      const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      expect((await http().get(`/reports/revenue?from=${yesterday}&to=${today}`).set(as('receptionA')).expect(403)).body.code).toBe('today_only');
      for (const k of ['expenses', 'attendance', 'outstanding', 'performance']) await http().get(`/reports/${k}`).set(as('receptionA')).expect(403);
    });

    it('a branch-limited member never sees another branch’s figures', async () => {
      const r = (await http().get('/reports/revenue').set(as('maadi')).expect(200)).body;
      expect(r.by_branch.every((b: { branch_id: string }) => b.branch_id === MAADI)).toBe(true);
      expect((await http().get(`/reports/revenue?branchId=${NASR}`).set(as('maadi')).expect(404)).body.code).toBe('branch_not_found');
      expect((await http().get('/reports/branches').set(as('maadi')).expect(200)).body.map((b: { id: string }) => b.id)).toEqual([MAADI]);
      // Maadi's figures read by the owner are the same
      const own = (await http().get(`/reports/revenue?branchId=${MAADI}`).set(as('ownerA')).expect(200)).body;
      expect(own.totals).toEqual(r.totals);
    });

    it('another clinic sees none of these figures', async () => {
      const b = (await http().get(`/reports/revenue?branchId=${NASR}`).set(as('ownerB')).expect(404)).body;
      expect(b.code).toBe('branch_not_found');
    });
  });

  describe('expenses (REPORT-002)', () => {
    it('a recorded expense counts once; collections − expenses is the cash-basis result', async () => {
      const q = `/reports/expenses?from=${today}&to=${today}&branchId=${NASR}`;
      const before = (await http().get(q).set(as('accountantA')).expect(200)).body;
      const supplies = (await http().get('/expenses/categories').set(as('accountantA')).expect(200)).body.find((c: { key: string }) => c.key === 'supplies');
      await http().post('/expenses').set(as('accountantA')).send({ branchId: NASR, categoryId: supplies.id, amountMinor: 45000, method: 'card', reference: `C-${run}` }).expect(201);
      const after = (await http().get(q).set(as('accountantA')).expect(200)).body;
      expect(after.totals.total - before.totals.total).toBe(45000);
      expect(after.totals.result).toBe(after.totals.collections_net - after.totals.total);
      expect(sum(after.by_category, 'amount')).toBe(after.totals.total);
      expect(sum(after.by_method, 'amount')).toBe(after.totals.total);
      expect(after.by_category.find((c: { category_id: string }) => c.category_id === supplies.id).name).toBe(supplies.name);
      await http().get(q).set(as('doctorMona')).expect(403);
    });
  });

  describe('attendance and performance (REPORT-003, REPORT-005)', () => {
    it('the owner sees every doctor and branch; the figures add up', async () => {
      const a = (await http().get('/reports/attendance').set(as('ownerA')).expect(200)).body;
      expect(sum(a.by_doctor, 'booked')).toBe(a.totals.booked);
      expect(sum(a.by_branch, 'booked')).toBe(a.totals.booked);
      expect(sum(a.by_status, 'n')).toBe(a.totals.booked);
      const p = (await http().get('/reports/performance').set(as('ownerA')).expect(200)).body;
      expect(sum(p.by_branch, 'procedures_value')).toBe(p.totals.procedures_value);
      expect(sum(p.by_doctor, 'procedures_value')).toBe(p.totals.procedures_value);
      expect(sum(p.by_branch, 'collections_net')).toBe(p.totals.collections_net);
    });

    it('a doctor sees their own figures only, with no collections', async () => {
      const a = (await http().get('/reports/attendance').set(as('doctorMona')).expect(200)).body;
      expect(a.scope).toBe('own');
      expect(a.by_doctor.every((d: { doctor_id: string }) => d.doctor_id === DR_MONA)).toBe(true);
      const p = (await http().get('/reports/performance').set(as('doctorMona')).expect(200)).body;
      expect(p).toMatchObject({ scope: 'own', by_branch: null, totals: { collections_net: null } });
      expect(p.by_doctor.every((d: { doctor_id: string }) => d.doctor_id === DR_MONA)).toBe(true);
      await http().get('/reports/revenue').set(as('doctorMona')).expect(403);
      await http().get('/reports/outstanding').set(as('doctorMona')).expect(403);
    });
  });

  describe('outstanding balances (REPORT-004)', () => {
    it('the balance total is the sum of the patients listed; overdue installments come with their days', async () => {
      const r = (await http().get('/reports/outstanding').set(as('accountantA')).expect(200)).body;
      expect(r.period).toBeNull();
      if (!r.truncated) expect(sum(r.patients, 'balance')).toBe(r.totals.balance);
      expect(r.patients.every((p: { balance: number }) => p.balance > 0)).toBe(true);
      expect(r.overdue.every((o: { days_overdue: number; due_date: string }) => o.days_overdue > 0 && o.due_date < today)).toBe(true);
      const maadi = (await http().get('/reports/outstanding').set(as('ownerA')).query({ branchId: MAADI }).expect(200)).body;
      expect(maadi.totals.balance).toBeLessThanOrEqual(r.totals.balance);
    });
  });

  describe('home screen per role (REPORT-006)', () => {
    it('reception: today’s appointments and waiting list, collections, the cash box of its branches — no month figures', async () => {
      const h = (await http().get('/reports/home').set(as('receptionA')).expect(200)).body;
      expect(h).toMatchObject({ today, appointments: { scope: 'all' }, follow_ups: { scope: 'all' }, finance: null });
      expect(h.appointments).toEqual(expect.objectContaining({ booked: expect.any(Number), waiting: expect.any(Number) }));
      expect(h.today_money).toEqual(expect.objectContaining({ collected: expect.any(Number), net: expect.any(Number) }));
      expect(h.cash.map((c: { branch_id: string }) => c.branch_id)).toEqual(expect.arrayContaining([NASR, MAADI]));
      // the same figure as the daily report
      const daily = (await http().get('/reports/revenue').set(as('receptionA')).expect(200)).body;
      expect(h.today_money.net).toBe(daily.totals.net);
    });

    it('a branch-limited member’s home holds only their branch', async () => {
      const h = (await http().get('/reports/home').set(as('maadi')).expect(200)).body;
      expect(h.cash.map((c: { branch_id: string }) => c.branch_id)).toEqual([MAADI]);
      const own = (await http().get(`/reports/revenue?branchId=${MAADI}&from=${today}&to=${today}`).set(as('ownerA')).expect(200)).body;
      expect(h.today_money.net).toBe(own.totals.net);
    });

    it('doctor: their own day and follow-ups, nothing about money or the cash box', async () => {
      const h = (await http().get('/reports/home').set(as('doctorMona')).expect(200)).body;
      expect(h).toMatchObject({ linked_doctor: true, appointments: { scope: 'mine' }, follow_ups: { scope: 'mine' }, today_money: null, finance: null, cash: null });
      const own = (await http().get(`/reports/attendance?from=${today}&to=${today}`).set(as('doctorMona')).expect(200)).body;
      expect(h.appointments.booked).toBe(own.totals.booked);
    });

    it('owner and accountant: today and the month in money, outstanding, no-shows', async () => {
      for (const who of ['ownerA', 'accountantA']) {
        const h = (await http().get('/reports/home').set(as(who)).expect(200)).body;
        expect(h.finance).toEqual({
          today: expect.objectContaining({ invoiced: expect.any(Number), collections_net: expect.any(Number), expenses: expect.any(Number), no_show: expect.any(Number) }),
          month: expect.objectContaining({ collections_net: expect.any(Number), no_show: expect.any(Number) }),
          outstanding: expect.objectContaining({ balance: expect.any(Number), overdue: expect.any(Number) }),
        });
      }
      const h = (await http().get('/reports/home').set(as('ownerA')).expect(200)).body;
      const month = (await http().get('/reports/revenue').set(as('ownerA')).expect(200)).body; // the month so far
      expect(h.finance.month.collections_net).toBe(month.totals.net);
      expect(h.finance.outstanding.balance).toBe((await http().get('/reports/outstanding').set(as('ownerA')).expect(200)).body.totals.balance);
    });
  });

  it('the period ends after it starts and covers at most a year', async () => {
    expect((await http().get('/reports/revenue?from=2026-05-02&to=2026-05-01').set(as('ownerA')).expect(400)).body.code).toBe('invalid_period');
    expect((await http().get('/reports/revenue?from=2025-01-01&to=2026-05-01').set(as('ownerA')).expect(400)).body.code).toBe('period_too_long');
    await http().get('/reports/revenue?from=yesterday').set(as('ownerA')).expect(400);
  });
});
