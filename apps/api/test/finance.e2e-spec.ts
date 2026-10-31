import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';

const NASR = 'd0000000-0000-0000-0000-0000000000a1';
// the cash day is tested on Maadi, where no other suite takes payments, so closing it blocks nobody
const MAADI = 'd0000000-0000-0000-0000-0000000000a2';
const tomorrow = () => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

describe('Finance: expenses and the daily cash box (e2e, Phase E3)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const run = `${Date.now()}`.slice(-7);
  let supplies: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['accountantA', 'accountant.a@demo.test'],
      ['maadi', 'reception.maadi@demo.test'], ['doctorA', 'doctor.a@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
    const cats = (await http().get('/expenses/categories').set(as('accountantA')).expect(200)).body;
    supplies = cats.find((c: { key: string }) => c.key === 'supplies').id;
  });
  afterAll(async () => {
    await app.close();
  });

  describe('expenses (EXP-001…004, CLR-03)', () => {
    it('every clinic starts with the eight Arabic categories; the owner adds and deactivates, never deletes', async () => {
      const cats = (await http().get('/expenses/categories').set(as('ownerA')).expect(200)).body;
      expect(cats.filter((c: { key: string | null }) => c.key).map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['إيجار', 'رواتب', 'مستلزمات', 'معامل', 'أخرى']));
      await http().post('/expenses/categories').set(as('accountantA')).send({ name: `تسويق ${run}` }).expect(403);
      const added = (await http().post('/expenses/categories').set(as('ownerA')).send({ name: `تسويق ${run}` }).expect(201)).body;
      const mine = added.find((c: { name: string }) => c.name === `تسويق ${run}`);
      expect((await http().post('/expenses/categories').set(as('ownerA')).send({ name: `تسويق ${run}` }).expect(409)).body.code).toBe('category_name_taken');
      await http().patch(`/expenses/categories/${mine.id}`).set(as('ownerA')).send({ isActive: false }).expect(200);
      const r = await http().post('/expenses').set(as('accountantA')).send({ branchId: NASR, categoryId: mine.id, amountMinor: 1000, method: 'cash' }).expect(400);
      expect(r.body.code).toBe('category_inactive');
    });

    it('the owner and the accountant record any expense, approved on entry; references and dates are checked', async () => {
      const e = (await http().post('/expenses').set(as('accountantA'))
        .send({ branchId: NASR, categoryId: supplies, amountMinor: 250000, method: 'bank_transfer', reference: `TRX-${run}`, supplierName: 'مورد', description: 'خامات' }).expect(201)).body;
      expect(e).toMatchObject({ status: 'approved', amount_minor: 250000, created_by_name: 'Mahmoud Ibrahim', approved_by_name: null, category_name: 'مستلزمات' });
      expect((await http().post('/expenses').set(as('accountantA')).send({ branchId: NASR, categoryId: supplies, amountMinor: 1000, method: 'wallet' }).expect(400)).body.code)
        .toBe('reference_required');
      expect((await http().post('/expenses').set(as('ownerA')).send({ branchId: NASR, categoryId: supplies, amountMinor: 1000, method: 'cash', spentOn: tomorrow() }).expect(400)).body.code)
        .toBe('date_in_future');
      await http().post('/expenses').set(as('doctorA')).send({ branchId: NASR, categoryId: supplies, amountMinor: 1000, method: 'cash' }).expect(403);
    });

    it('reception has no expense access: bookings, patients and patient payments only (owner 2026-10-20)', async () => {
      for (const who of ['receptionA', 'maadi']) {
        expect((await http().get('/expenses').set(as(who)).expect(403)).body.code).toBe('missing_permission');
        await http().get('/expenses/categories').set(as(who)).expect(403);
        await http().post('/expenses').set(as(who)).send({ branchId: NASR, categoryId: supplies, amountMinor: 100, method: 'cash' }).expect(403);
      }
      const e = (await http().post('/expenses').set(as('accountantA')).send({ branchId: NASR, categoryId: supplies, amountMinor: 3000, method: 'cash', description: `قفازات ${run}` }).expect(201)).body;
      await http().get(`/expenses/${e.id}`).set(as('receptionA')).expect(403);
      await http().post(`/expenses/${e.id}/void`).set(as('receptionA')).send({ reason: 'خطأ في المبلغ' }).expect(403);
      // nothing new waits for approval: the owner's and the accountant's expenses are approved on entry; the
      // accountant never approves (CLR-03), and an approved one is not decided again
      expect(e).toMatchObject({ status: 'approved', can: { decide: false, void: true, attach: true } });
      await http().post(`/expenses/${e.id}/approve`).set(as('accountantA')).send({}).expect(403);
      expect((await http().post(`/expenses/${e.id}/approve`).set(as('ownerA')).send({}).expect(409)).body.code).toBe('expense_not_pending');
      // the old reception limit setting is gone
      await http().patch('/expenses/settings').set(as('ownerA')).send({ receptionLimitMinor: 0 }).expect(404);
    });

    it('the list pages with "load more" in its own order (date, then entry); nothing repeats or is skipped', async () => {
      for (let i = 0; i < 3; i++) {
        await http().post('/expenses').set(as('ownerA')).send({ branchId: NASR, categoryId: supplies, amountMinor: 1000 + i, method: 'cash' }).expect(201);
      }
      const ids = (r: request.Response) => (r.body.items as { id: string }[]).map((x) => x.id);
      const first = ids(await http().get('/expenses?limit=2').set(as('ownerA')).expect(200));
      const next = ids(await http().get(`/expenses?limit=2&after=${first[1]}`).set(as('ownerA')).expect(200));
      expect(first).toHaveLength(2);
      expect(next).toHaveLength(2);
      expect(new Set([...first, ...next]).size).toBe(4);
      // anything another suite adds meanwhile is newer and comes first: the two pages stay one unbroken run
      const all = ids(await http().get('/expenses?limit=500').set(as('ownerA')).expect(200));
      const at = all.indexOf(first[0]);
      expect(all.slice(at, at + 4)).toEqual([...first, ...next]);
      await http().get('/expenses?after=not-an-id').set(as('ownerA')).expect(400);
    });

    it('a wrong expense is voided with a reason and stays visible (EXP-004)', async () => {
      const e = (await http().post('/expenses').set(as('ownerA')).send({ branchId: NASR, categoryId: supplies, amountMinor: 7000, method: 'cash' }).expect(201)).body;
      await http().post(`/expenses/${e.id}/void`).set(as('ownerA')).send({}).expect(400);
      const v = (await http().post(`/expenses/${e.id}/void`).set(as('accountantA')).send({ reason: 'خطأ في المبلغ' }).expect(200)).body;
      expect(v).toMatchObject({ status: 'void', void_reason: 'خطأ في المبلغ', voided_by_name: 'Mahmoud Ibrahim' });
      expect((await http().post(`/expenses/${e.id}/void`).set(as('accountantA')).send({ reason: 'مرة أخرى' }).expect(409)).body.code).toBe('expense_void');
      const list = (await http().get('/expenses?status=void').set(as('ownerA')).expect(200)).body.items;
      expect(list.map((x: { id: string }) => x.id)).toContain(e.id);
    });

    it('the supporting document: private, checked by its bytes, attached once, opened by a short link (EXP-001, H2)', async () => {
      const PDF = Buffer.from('%PDF-1.7\n% receipt\n');
      const e = (await http().post('/expenses').set(as('accountantA')).send({ branchId: NASR, categoryId: supplies, amountMinor: 900, method: 'cash', description: `إيصال ${run}` }).expect(201)).body;
      expect(e).toMatchObject({ document: null, can: { attach: true } });
      // only PDF and images, by their bytes; nobody without expenses:write (reception, doctors)
      expect((await http().post(`/expenses/${e.id}/document`).set(as('accountantA')).attach('file', Buffer.from('<html><script>alert(1)</script></html>'), 'r.pdf').expect(400)).body.code)
        .toBe('unsupported_file_type');
      expect((await http().post(`/expenses/${e.id}/document`).set(as('doctorA')).attach('file', PDF, 'r.pdf').expect(403)).body.code).toBe('missing_permission');
      expect((await http().post(`/expenses/${e.id}/document`).set(as('receptionA')).attach('file', PDF, 'r.pdf').expect(403)).body.code).toBe('missing_permission');
      // the receipt that came later is attached, once
      const withDoc = (await http().post(`/expenses/${e.id}/document`).set(as('accountantA')).attach('file', PDF, { filename: 'receipt.pdf', contentType: 'application/pdf' }).expect(200)).body;
      expect(withDoc).toMatchObject({ document: { mime_type: 'application/pdf', size_bytes: PDF.length }, can: { attach: false } });
      expect((await http().post(`/expenses/${e.id}/document`).set(as('ownerA')).attach('file', PDF, 'again.pdf').expect(409)).body.code).toBe('expense_has_document');
      // the link opens without a session, for 5 minutes, for that member only, and never as a clinical file
      const url = new URL(withDoc.document.url);
      const opened = await http().get(url.pathname + url.search).expect(200);
      expect(opened.headers['content-type']).toBe('application/pdf');
      expect(opened.headers['cache-control']).toBe('private, no-store');
      const other = new URL(url); other.searchParams.set('u', 'b0000000-0000-0000-0000-0000000000a1');
      expect((await http().get(other.pathname + other.search).expect(403)).body.code).toBe('link_expired');
      expect((await http().get(url.pathname.replace('/expense-files/', '/clinical-files/') + url.search).expect(403)).body.code).toBe('link_expired');
      // the owner sees it in the list; a void expense takes no document
      const listed = (await http().get('/expenses').set(as('ownerA')).expect(200)).body.items.find((x: { id: string }) => x.id === e.id);
      expect(listed.document.mime_type).toBe('application/pdf');
      const v = (await http().post('/expenses').set(as('accountantA')).send({ branchId: NASR, categoryId: supplies, amountMinor: 800, method: 'cash' }).expect(201)).body;
      await http().post(`/expenses/${v.id}/void`).set(as('accountantA')).send({ reason: 'سجلته مرتين' }).expect(200);
      expect((await http().post(`/expenses/${v.id}/document`).set(as('accountantA')).attach('file', PDF, 'r.pdf').expect(409)).body.code).toBe('expense_void');
    });
  });

  describe('the cash day on one branch (CASH-001…004, CLR-04)', () => {
    let sessionId: string;
    let invoiceId: string;
    const pay = (amountMinor: number, method: string) => http().post(`/invoices/${invoiceId}/payments`).set(as('maadi'))
      .send({ amountMinor, method, idempotencyKey: `cash-${run}-${Math.random()}` });

    beforeAll(async () => {
      // the day as a rerun may find it: an earlier day left open, today closed, or nothing yet
      let day = (await http().get(`/cash/today?branchId=${MAADI}`).set(as('maadi')).expect(200)).body;
      if (day.earlier_open) {
        await http().post(`/cash/sessions/${day.earlier_open.id}/close`).set(as('maadi')).send({ countedMinor: day.earlier_open.expected_minor }).expect(200);
      }
      if (day.session?.status === 'closed') await http().post(`/cash/sessions/${day.session.id}/reopen`).set(as('ownerA')).send({ reason: 'إعادة الاختبار' }).expect(200);
      if (!day.session) {
        expect(day).toHaveProperty('suggested_opening');
        await http().post('/cash/sessions').set(as('maadi')).send({ branchId: MAADI, openingMinor: 100000 }).expect(201);
      }
      day = (await http().get(`/cash/today?branchId=${MAADI}`).set(as('maadi')).expect(200)).body;
      sessionId = day.session.id;
      const patientId = (await http().post('/patients').set(as('maadi')).send({ fullName: `مريض خزنة ${run}`, phone: `0105${run}` }).expect(201)).body.id;
      invoiceId = (await http().post('/invoices').set(as('maadi')).send({ patientId, branchId: MAADI, lines: [{ description: `علاج ${run}`, unitPriceMinor: 500000 }] }).expect(201)).body.id;
      await http().post(`/invoices/${invoiceId}/issue`).set(as('maadi')).expect(200);
    });

    it('one session per branch per day; a branch-limited member sees only their branch', async () => {
      expect((await http().post('/cash/sessions').set(as('maadi')).send({ branchId: MAADI, openingMinor: 0 }).expect(409)).body.code).toBe('session_already_open');
      await http().get(`/cash/today?branchId=${NASR}`).set(as('maadi')).expect(404);
      expect((await http().get('/cash/branches').set(as('maadi')).expect(200)).body.map((b: { id: string }) => b.id)).toEqual([MAADI]);
      expect((await http().get('/cash/branches').set(as('receptionA')).expect(200)).body.map((b: { id: string }) => b.id)).toEqual(expect.arrayContaining([NASR, MAADI]));
      await http().get(`/cash/today?branchId=${MAADI}`).set(as('doctorA')).expect(403);
    });

    it('expected cash moves with cash only; other methods are listed apart (CASH-002)', async () => {
      const before = (await http().get(`/cash/sessions/${sessionId}`).set(as('maadi')).expect(200)).body;
      await pay(50000, 'cash').expect(201);
      await pay(20000, 'card').expect(201);
      await http().post('/expenses').set(as('accountantA')).send({ branchId: MAADI, categoryId: supplies, amountMinor: 10000, method: 'cash', description: 'بنزين' }).expect(201);
      const after = (await http().get(`/cash/sessions/${sessionId}`).set(as('maadi')).expect(200)).body;
      expect(after.expected_minor - before.expected_minor).toBe(40000);
      expect((after.totals.payments.card ?? 0) - (before.totals.payments.card ?? 0)).toBe(20000);
    });

    it('every figure opens the movements it is made of, and they add up to it (redesign R9)', async () => {
      const day = (await http().get(`/cash/sessions/${sessionId}`).set(as('maadi')).expect(200)).body;
      const m = (await http().get(`/cash/sessions/${sessionId}/movements`).set(as('maadi')).expect(200)).body as
        { business_date: string; items: { kind: 'payment' | 'refund' | 'expense'; method: string; amount_minor: number; note: string | null }[] };
      expect(m.business_date).toBe(day.business_date);
      const sum = (kind: string, method: string) => m.items.filter((x) => x.kind === kind && x.method === method).reduce((n, x) => n + x.amount_minor, 0);
      const groups = [['payments', 'payment'], ['refunds', 'refund'], ['expenses', 'expense']] as const;
      for (const [key, kind] of groups) {
        for (const [method, amount] of Object.entries(day.totals[key] as Record<string, number>)) expect(sum(kind, method)).toBe(amount);
      }
      // and nothing listed is missing from the figures
      for (const x of m.items) expect(day.totals[groups.find(([, k]) => k === x.kind)![0]][x.method]).toBeGreaterThan(0);
      expect(sum('payment', 'cash')).toBe(day.totals.cash_in);
      expect(sum('expense', 'cash')).toBe(day.totals.cash_expenses);
      expect(m.items.some((x) => x.kind === 'expense' && x.note === 'بنزين')).toBe(true);
      await http().get(`/cash/sessions/${sessionId}/movements`).set(as('doctorA')).expect(403);
    });

    it('closing: a difference needs a note; then the day takes no movement; only the owner reopens (CASH-003/004)', async () => {
      const open = (await http().get(`/cash/sessions/${sessionId}`).set(as('maadi')).expect(200)).body;
      const r = await http().post(`/cash/sessions/${sessionId}/close`).set(as('maadi')).send({ countedMinor: open.expected_minor - 1000 }).expect(400);
      expect(r.body).toMatchObject({ code: 'difference_note_required', expected: open.expected_minor, difference: -1000 });
      const closed = (await http().post(`/cash/sessions/${sessionId}/close`).set(as('maadi')).send({ countedMinor: open.expected_minor - 1000, note: 'نقص في الفكة' }).expect(200)).body;
      expect(closed).toMatchObject({ status: 'closed', difference_minor: -1000, closed_by_name: 'Hala Fathy', can: { close: false, reopen: false } });

      expect((await pay(100, 'cash').expect(409)).body.code).toBe('session_closed');
      expect((await http().post('/expenses').set(as('accountantA')).send({ branchId: MAADI, categoryId: supplies, amountMinor: 100, method: 'cash' }).expect(409)).body.code).toBe('session_closed');
      expect((await http().post(`/cash/sessions/${sessionId}/close`).set(as('maadi')).send({ countedMinor: 0 }).expect(409)).body.code).toBe('session_closed');

      await http().post(`/cash/sessions/${sessionId}/reopen`).set(as('maadi')).send({ reason: 'إيصال لم يسجل' }).expect(403);
      await http().post(`/cash/sessions/${sessionId}/reopen`).set(as('accountantA')).send({ reason: 'إيصال لم يسجل' }).expect(403);
      await http().post(`/cash/sessions/${sessionId}/reopen`).set(as('ownerA')).send({}).expect(400);
      const reopened = (await http().post(`/cash/sessions/${sessionId}/reopen`).set(as('ownerA')).send({ reason: 'إيصال لم يسجل' }).expect(200)).body;
      expect(reopened.status).toBe('open');
      expect(reopened.reopenings.at(-1)).toMatchObject({ reason: 'إيصال لم يسجل', previous_counted: open.expected_minor - 1000, previous_note: 'نقص في الفكة', reopened_by_name: 'Dr. Ahmed Salah' });
      await pay(100, 'cash').expect(201);

      const history = (await http().get(`/cash/sessions?branchId=${MAADI}`).set(as('accountantA')).expect(200)).body;
      expect(history.find((s: { id: string }) => s.id === sessionId)).toMatchObject({ status: 'open' });
    });
  });
});
