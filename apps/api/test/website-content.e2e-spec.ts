import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createDb, sql, type Db } from '@dental/db';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';
import { workerUrl } from './test-admin';

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const HOST_A = 'clinic-a.lvh.me';
const DEFAULT = ['services', 'doctors', 'gallery', 'faq', 'branches'];

/**
 * Phase 2C-1: the clinic website's sections (order, shown or hidden) and its questions and answers — managed from the
 * dashboard, live on the site at once.
 */
describe('Website sections and questions (e2e, Phase 2C-1)', () => {
  let app: INestApplication;
  let worker: Db;
  let savedSections = '[]';
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const site = async () => (await http().get('/public/site').query({ host: HOST_A }).expect(200)).body;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    worker = createDb(workerUrl(), { max: 2, applicationName: 'dental-worker-test' });
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
    savedSections = (await sql<{ s: string }>`select sections::text as s from sites where tenant_id = ${CLINIC_A}`.execute(worker)).rows[0].s;
    await sql`update sites set sections = '[]' where tenant_id = ${CLINIC_A}`.execute(worker);
    await sql`delete from faqs where tenant_id = ${CLINIC_A}`.execute(worker);
  });

  afterAll(async () => {
    await sql`update sites set sections = ${savedSections}::jsonb where tenant_id = ${CLINIC_A}`.execute(worker);
    await sql`delete from faqs where tenant_id = ${CLINIC_A}`.execute(worker);
    await worker.destroy();
    await app.close();
  });

  it('sections: the default order until the clinic sets its own; each section exactly once', async () => {
    const st = (await http().get('/clinic/website').set(as('ownerA')).expect(200)).body;
    expect(st.sections).toEqual(DEFAULT.map((key) => ({ key, visible: true })));
    const mine = [
      { key: 'faq', visible: true }, { key: 'services', visible: true }, { key: 'doctors', visible: false },
      { key: 'branches', visible: true }, { key: 'gallery', visible: false },
    ];
    expect((await http().put('/clinic/website/sections').set(as('ownerA')).send({ sections: mine }).expect(200)).body.sections).toEqual(mine);
    expect((await site()).sections).toEqual(mine); // live at once
    await http().put('/clinic/website/sections').set(as('ownerA')).send({ sections: mine.slice(1) }).expect(400); // one missing
    await http().put('/clinic/website/sections').set(as('ownerA')).send({ sections: [...mine.slice(1), { key: 'services', visible: true }] }).expect(400); // twice
    await http().put('/clinic/website/sections').set(as('ownerA')).send({ sections: [...mine.slice(1), { key: 'hero', visible: true }] }).expect(400); // unknown
    await http().put('/clinic/website/sections').set(as('receptionA')).send({ sections: mine }).expect(403);
  });

  it('questions: added at the end, edited, reordered, hidden and deleted; the site shows the active ones in order', async () => {
    await http().post('/clinic/website/faqs').set(as('ownerA')).send({ questionAr: 'سؤال', answerAr: 'نعم' }).expect(400); // too short
    let list = (await http().post('/clinic/website/faqs').set(as('ownerA')).send({ questionAr: 'هل تقبلون التأمين الطبي؟', answerAr: 'نعم، مع أغلب الشركات.' }).expect(201)).body;
    list = (await http().post('/clinic/website/faqs').set(as('ownerA')).send({ questionAr: 'هل يوجد موقف سيارات؟', answerAr: 'نعم أمام العيادة.\nومجاني.' }).expect(201)).body;
    expect(list.map((q: { questionAr: string }) => q.questionAr)).toEqual(['هل تقبلون التأمين الطبي؟', 'هل يوجد موقف سيارات؟']);
    expect(list[1].answerAr).toBe('نعم أمام العيادة.\nومجاني.'); // line breaks kept
    const [a, b] = list as { id: string }[];
    list = (await http().put('/clinic/website/faqs/order').set(as('ownerA')).send({ ids: [b.id, a.id] }).expect(200)).body;
    expect(list.map((q: { id: string }) => q.id)).toEqual([b.id, a.id]);
    await http().put('/clinic/website/faqs/order').set(as('ownerA')).send({ ids: [b.id] }).expect(400); // must name every question
    list = (await http().patch(`/clinic/website/faqs/${a.id}`).set(as('ownerA')).send({ isActive: false }).expect(200)).body;
    expect((await site()).faqs.map((q: { id: string }) => q.id)).toEqual([b.id]); // the hidden one is not on the site
    await http().patch(`/clinic/website/faqs/${a.id}`).set(as('ownerA')).send({ serviceId: '00000000-0000-0000-0000-000000000000' }).expect(400);
    await http().delete(`/clinic/website/faqs/${a.id}`).set(as('ownerA')).expect(204);
    await http().delete(`/clinic/website/faqs/${a.id}`).set(as('ownerA')).expect(404);
  });

  it('another clinic\'s questions are not found; staff without website rights cannot read them', async () => {
    const [q] = (await http().get('/clinic/website/faqs').set(as('ownerA')).expect(200)).body as { id: string }[];
    await http().patch(`/clinic/website/faqs/${q.id}`).set(as('ownerB')).send({ isActive: false }).expect(404);
    await http().delete(`/clinic/website/faqs/${q.id}`).set(as('ownerB')).expect(404);
    await http().get('/clinic/website/faqs').set(as('receptionA')).expect(403);
  });

  it('a clinic has 50 questions at most', async () => {
    await sql`insert into faqs (tenant_id, question_ar, answer_ar, sort_order)
              select ${CLINIC_A}, 'سؤال رقم ' || g, 'إجابة', 100 + g from generate_series(1, 49) g`.execute(worker);
    expect((await http().post('/clinic/website/faqs').set(as('ownerA')).send({ questionAr: 'سؤال زائد عن الحد؟', answerAr: 'لا' }).expect(409)).body.code).toBe('faq_limit');
  });
});
