import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';

const OMAR = '70000000-0000-0000-0000-0000000000a1';
const NOUR = '70000000-0000-0000-0000-0000000000a2';
const NASR = 'd0000000-0000-0000-0000-0000000000a1';
const WHITENING = '90000000-0000-0000-0000-0000000000a4';
/** a 1×1 PNG: what the signature pad sends, in miniature */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

describe('Patient consents (e2e, Phase H9)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const signer = { signerName: 'عمر خالد', signerRelation: 'self' };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['doctorA', 'doctor.a@demo.test'], ['accountantA', 'accountant.a@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
  });
  afterAll(async () => {
    await http().patch(`/services/${WHITENING}`).set(as('ownerA')).send({ consentKey: null });
    await app.close();
  });

  it('the clinic starts with four drafts; a draft is not signed until the owner reviews and saves it', async () => {
    const list = (await http().get('/consents/templates').set(as('receptionA')).expect(200)).body as { key: string; is_draft: boolean }[];
    expect(list.map((t) => t.key).sort()).toEqual(['anesthesia', 'extraction', 'general', 'implant']);
    expect(list.every((t) => t.is_draft)).toBe(true);
    expect((await http().post(`/patients/${OMAR}/consents`).set(as('receptionA')).send({ ...signer, templateKey: 'extraction', signature: PNG }).expect(409)).body.code).toBe('consent_draft');

    await http().put('/consents/templates/extraction').set(as('receptionA')).send({ titleAr: 'موافقة على خلع سن', bodyAr: 'نص الموافقة بعد المراجعة الكاملة من الطبيب' }).expect(403);
    const saved = (await http().put('/consents/templates/extraction').set(as('ownerA'))
      .send({ titleAr: 'موافقة على خلع سن', bodyAr: 'أوافق على خلع السن التي حددها الطبيب بعد أن شرح لي البدائل والآثار المحتملة.' }).expect(200)).body;
    expect(saved).toMatchObject({ key: 'extraction', current: { version: 2, is_draft: false, reviewed_by_name: expect.any(String) } });
    expect(saved.versions).toHaveLength(2);
    const created = (await http().post('/consents/templates').set(as('ownerA')).send({ titleAr: 'موافقة على تقويم الأسنان', bodyAr: 'أوافق على علاج التقويم الذي شرحه لي الطبيب بمدته وتكلفته.' }).expect(201)).body;
    expect(created.key).toMatch(/^c-[a-z0-9]{6}$/);
  });

  it('signs on screen: the text kept is the reviewed version\'s, the signature is a private file behind a short link', async () => {
    expect((await http().post(`/patients/${OMAR}/consents`).set(as('receptionA')).send({ ...signer, templateKey: 'extraction', signature: 'data:image/png;base64,AAAA' }).expect(400)).body.code).toBe('signature_required');
    expect((await http().post(`/patients/${OMAR}/consents`).set(as('accountantA')).send({ ...signer, templateKey: 'extraction', signature: PNG }).expect(403)).body.code).toBe('missing_permission');
    const c = (await http().post(`/patients/${OMAR}/consents`).set(as('receptionA')).send({ ...signer, templateKey: 'extraction', signature: PNG }).expect(201)).body;
    expect(c).toMatchObject({ key: 'extraction', version: 2, method: 'screen', signer_name: 'عمر خالد', revoked_at: null, recorded_by_name: expect.any(String) });
    expect(c.body_snapshot).toContain('أوافق على خلع السن');
    const url = new URL(c.file_url);
    const img = await http().get(url.pathname + url.search).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    url.searchParams.set('sig', 'A'.repeat(43));
    expect((await http().get(url.pathname + url.search).expect(403)).body.code).toBe('link_expired');
    expect(((await http().get(`/patients/${OMAR}/consents`).set(as('accountantA')).expect(200)).body as { id: string }[]).map((x) => x.id)).toContain(c.id);
  });

  it('records a paper form signed by a guardian, and withdraws a consent once, with a reason', async () => {
    const paper = (await http().post(`/patients/${NOUR}/consents/paper`).set(as('receptionA'))
      .field('templateKey', 'extraction').field('signerName', 'علي محمود').field('signerRelation', 'father').field('visitId', '')
      .attach('file', PDF, { filename: 'form.pdf', contentType: 'application/pdf' }).expect(201)).body;
    expect(paper).toMatchObject({ method: 'paper', signer_relation: 'father' });
    expect((await http().post(`/patients/${NOUR}/consents/${paper.id}/revoke`).set(as('receptionA')).send({ reason: 'x' }).expect(400)).body.code).toBe('validation_failed');
    const revoked = (await http().post(`/patients/${NOUR}/consents/${paper.id}/revoke`).set(as('receptionA')).send({ reason: 'طلب ولي الأمر' }).expect(200)).body;
    expect(revoked).toMatchObject({ revoke_reason: 'طلب ولي الأمر', revoked_at: expect.any(String) });
    expect((await http().post(`/patients/${NOUR}/consents/${paper.id}/revoke`).set(as('receptionA')).send({ reason: 'مرة أخرى' }).expect(409)).body.code).toBe('consent_revoked');
    // the consent belongs to its patient: another patient's path finds nothing
    await http().get(`/patients/${OMAR}/consents/${paper.id}`).set(as('receptionA')).expect(404);
  });

  it('a treatment that needs a consent: the visit warns until it is signed, and never blocks', async () => {
    expect((await http().patch(`/services/${WHITENING}`).set(as('ownerA')).send({ consentKey: 'no-such-text' }).expect(400)).body.code).toBe('consent_not_found');
    await http().patch(`/services/${WHITENING}`).set(as('ownerA')).send({ consentKey: 'extraction' }).expect(200);
    const visitId = (await http().post('/visits').set(as('doctorA')).send({ patientId: NOUR, branchId: NASR }).expect(201)).body.id;
    const v = (await http().post(`/visits/${visitId}/procedures`).set(as('doctorA')).send({ serviceId: WHITENING }).expect(201)).body;
    expect(v.consents).toEqual([{ key: 'extraction', title: 'موافقة على خلع سن', consent_id: null }]); // recorded anyway: a warning only
    const c = (await http().post(`/patients/${NOUR}/consents`).set(as('doctorA'))
      .send({ templateKey: 'extraction', signerName: 'علي محمود', signerRelation: 'father', visitId, signature: PNG }).expect(201)).body;
    expect((await http().get(`/visits/${visitId}`).set(as('doctorA')).expect(200)).body.consents).toEqual([{ key: 'extraction', title: 'موافقة على خلع سن', consent_id: c.id }]);
    // a visit of another patient cannot carry this consent
    expect((await http().post(`/patients/${OMAR}/consents`).set(as('doctorA'))
      .send({ templateKey: 'extraction', ...signer, visitId, signature: PNG }).expect(400)).body.code).toBe('visit_not_this_patient');
  });

  it('an archived text is not signed, and comes back when restored', async () => {
    await http().post('/consents/templates/extraction/active').set(as('ownerA')).send({ active: false }).expect(200);
    expect((await http().post(`/patients/${OMAR}/consents`).set(as('receptionA')).send({ ...signer, templateKey: 'extraction', signature: PNG }).expect(409)).body.code).toBe('consent_archived');
    await http().post('/consents/templates/extraction/active').set(as('ownerA')).send({ active: true }).expect(200);
    await http().post(`/patients/${OMAR}/consents`).set(as('receptionA')).send({ ...signer, templateKey: 'extraction', signature: PNG }).expect(201);
  });
});
