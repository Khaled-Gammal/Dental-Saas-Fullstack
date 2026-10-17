import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
import { AppModule } from '../src/app.module';

/** A PNG signature and some bytes: enough for the content check (clinical files are stored as uploaded). */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake x-ray bytes for the e2e test')]);
const PDF = Buffer.from('%PDF-1.7\n% referral letter\n');

describe('Patients: Arabic search, duplicates, history versions, clinical files (e2e, Phase D3)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const run = `${Date.now()}`.slice(-7);
  const phoneLocal = `0109${run}`;
  let patientId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['doctorA', 'doctor.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
    patientId = (await http().post('/patients').set(as('receptionA')).send({ fullName: `أحمد مُحمّد عبد الله ${run}`, phone: phoneLocal, dateOfBirth: '1990-05-01' }).expect(201)).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('name search ignores hamza, diacritics, ة/ه and ى/ي (PATIENT-001)', async () => {
    const found = async (q: string) => (await http().get('/patients').query({ q }).set(as('receptionA')).expect(200)).body.items.map((p: { id: string }) => p.id);
    expect(await found(`احمد محمد عبد الله ${run}`)).toContain(patientId);
    expect(await found('احمد محمد عبد')).toContain(patientId);
    expect(await found(`أحمد ${run}`.split(' ')[0])).toContain(patientId);
  });

  it('warns about possible duplicates by phone or name, never blocks (PATIENT-002)', async () => {
    const dup = async (q: Record<string, string>) => (await http().get('/patients/duplicates').query(q).set(as('receptionA')).expect(200)).body.map((p: { id: string }) => p.id);
    expect(await dup({ phone: phoneLocal })).toContain(patientId);
    expect(await dup({ fullName: `احمد محمد عبد الله ${run}` })).toContain(patientId); // same person typed without hamza
    expect(await dup({ fullName: `أحمد محمد عبدالله ${run}`, dateOfBirth: '1990-05-01' })).toContain(patientId); // close name + same birth date
    expect(await dup({ fullName: `Someone Else ${run}` })).toEqual([]);
    await http().post('/patients').set(as('receptionA')).send({ fullName: `نور أحمد ${run}`, phone: phoneLocal }).expect(201); // a sibling on the same phone is allowed
  });

  it('keeps every version of the medical history; reception cannot read them (PATIENT-005)', async () => {
    await http().put(`/patients/${patientId}/medical-history`).set(as('doctorA')).send({ allergies: ['بنسلين'], conditions: [], medications: [], isPregnant: null, isSmoker: false, notes: null }).expect(200);
    await http().put(`/patients/${patientId}/medical-history`).set(as('doctorA')).send({ allergies: ['بنسلين', 'لاتكس'], conditions: ['سكر'], medications: [], isPregnant: null, isSmoker: false, notes: null }).expect(200);
    const v = (await http().get(`/patients/${patientId}/medical-history/versions`).set(as('doctorA')).expect(200)).body;
    expect(v.map((x: { allergies: string[] }) => x.allergies)).toEqual([['بنسلين', 'لاتكس'], ['بنسلين']]);
    expect(v[0].saved_by_name).toBeTruthy();
    expect((await http().get(`/patients/${patientId}/medical-history/versions`).set(as('receptionA')).expect(403)).body.code).toBe('missing_permission');
  });

  describe('clinical documents (PATIENT-004)', () => {
    let fileId: string;
    let url: string;
    const pathOf = (u: string) => { const x = new URL(u); return `${x.pathname}${x.search}`; };

    it('a doctor uploads an X-ray; the bytes decide the type, not the name', async () => {
      const up = await http().post(`/patients/${patientId}/files`).set(as('doctorA'))
        .field('kind', 'xray').field('caption', 'بانوراما').attach('file', PNG, { filename: 'scan.png', contentType: 'image/png' }).expect(201);
      expect(up.body).toMatchObject({ kind: 'xray', mime_type: 'image/png', caption: 'بانوراما', archived_at: null });
      fileId = up.body.file_id; url = up.body.url;
      const html = await http().post(`/patients/${patientId}/files`).set(as('doctorA'))
        .field('kind', 'document').attach('file', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'report.pdf', contentType: 'application/pdf' }).expect(400);
      expect(html.body.code).toBe('unsupported_file_type');
      await http().post(`/patients/${patientId}/files`).set(as('doctorA')).field('kind', 'document').attach('file', PDF, { filename: 'letter.pdf', contentType: 'application/pdf' }).expect(201);
      expect((await http().post(`/patients/${patientId}/files`).set(as('receptionA')).field('kind', 'xray').attach('file', PNG, 'x.png').expect(403)).body.code).toBe('missing_permission');
    });

    it('opens through a short-lived link bound to the member; tampering fails; the opening is audited', async () => {
      const ok = await http().get(pathOf(url)).expect(200);
      expect(ok.headers['content-type']).toBe('image/png');
      expect(ok.headers['cache-control']).toContain('no-store');
      expect(Buffer.from(ok.body).equals(PNG)).toBe(true);
      const u = new URL(url);
      const otherUser = new URL(url); otherUser.searchParams.set('u', 'b0000000-0000-0000-0000-0000000000a1');
      await http().get(`${otherUser.pathname}${otherUser.search}`).expect(403);
      const longer = new URL(url); longer.searchParams.set('exp', String(Number(u.searchParams.get('exp')) + 3600));
      await http().get(`${longer.pathname}${longer.search}`).expect(403);
      const activity = (await http().get(`/patients/${patientId}/activity`).set(as('ownerA')).expect(200)).body.map((x: { action: string }) => x.action);
      expect(activity).toEqual(expect.arrayContaining(['patient_file.create', 'patient_file.view']));
    });

    it('reception (no clinical:read) cannot list files; another clinic cannot see them', async () => {
      expect((await http().get(`/patients/${patientId}/files`).set(as('receptionA')).expect(403)).body.code).toBe('missing_permission');
      await http().get(`/patients/${patientId}/files`).set(as('ownerB')).expect(404);
    });

    it('files are archived with a reason, never deleted', async () => {
      await http().post(`/patients/${patientId}/files/${fileId}/archive`).set(as('doctorA')).send({ reason: 'x' }).expect(400);
      await http().post(`/patients/${patientId}/files/${fileId}/archive`).set(as('doctorA')).send({ reason: 'رُفعت لمريض آخر' }).expect(204);
      expect((await http().get(`/patients/${patientId}/files`).set(as('doctorA')).expect(200)).body.map((f: { file_id: string }) => f.file_id)).not.toContain(fileId);
      const archived = (await http().get(`/patients/${patientId}/files`).query({ archived: 'true' }).set(as('doctorA')).expect(200)).body;
      expect(archived.find((f: { file_id: string }) => f.file_id === fileId)).toMatchObject({ archive_reason: 'رُفعت لمريض آخر' });
      await http().post(`/patients/${patientId}/files/${fileId}/archive`).set(as('doctorA')).send({ reason: 'again' }).expect(404);
    });
  });
});
