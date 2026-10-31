import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { createDb, sql, type Db } from '@dental/db';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.STORAGE_DRIVER = 'local';
const STORAGE_DIR = mkdtempSync(path.join(tmpdir(), 'dental-e2e-seo-'));
process.env.STORAGE_DIR = STORAGE_DIR;
import { AppModule } from '../src/app.module';
import { workerUrl } from './test-admin';

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const HOST_A = 'clinic-a.lvh.me';
const HOST_B = 'clinic-b.lvh.me';
const binary = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

/** Phase 2C-3: the site's search title and description, its share image, and the data the service pages use. */
describe('Search and sharing (e2e, Phase 2C-3)', () => {
  let app: INestApplication;
  let worker: Db;
  const token: Record<string, string> = {};
  const uploaded: string[] = []; // images never attached: removed after the suite (they count against the clinic's storage)
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const site = async (host = HOST_A) => (await http().get('/public/site').query({ host }).expect(200)).body;
  const shareImage = async (host: string) => {
    const res = await http().get('/public/share-image').query({ host }).buffer(true).parse(binary).expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    return sharp(res.body as Buffer).metadata();
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    worker = createDb(workerUrl(), { max: 2, applicationName: 'dental-worker-test' });
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
  });
  afterAll(async () => {
    await sql`update sites set seo_title = null, seo_description = null, share_file_id = null where tenant_id = ${CLINIC_A}`.execute(worker);
    if (uploaded.length) await sql`delete from files where id = any(${uploaded}::uuid[])`.execute(worker);
    await worker.destroy();
    await app.close();
    rmSync(STORAGE_DIR, { recursive: true, force: true });
  });

  it('the clinic sets its search title and description; empty goes back to the defaults', async () => {
    await http().put('/clinic/website/seo').set(as('ownerA')).send({ title: 'abc' }).expect(400);
    await http().put('/clinic/website/seo').set(as('ownerA')).send({ description: 'قصير' }).expect(400);
    await http().put('/clinic/website/seo').set(as('receptionA')).send({ title: 'عيادة الابتسامة لطب الأسنان' }).expect(403);
    const st = (await http().put('/clinic/website/seo').set(as('ownerA'))
      .send({ title: ' عيادة الابتسامة لطب الأسنان ', description: 'تبييض وتقويم وزراعة أسنان في مدينة نصر، احجز موعدك أونلاين.' }).expect(200)).body;
    expect(st.seo).toMatchObject({ title: 'عيادة الابتسامة لطب الأسنان', shareImage: null });
    expect(st.hostname).toBe(HOST_A);
    expect((await site()).seo).toMatchObject({ title: 'عيادة الابتسامة لطب الأسنان', description: expect.stringContaining('مدينة نصر') });
    expect((await http().put('/clinic/website/seo').set(as('ownerA')).send({ title: '' }).expect(200)).body.seo.title).toBeNull();
  });

  it('the share image: the clinic\'s own (a 1200×630 JPEG from it), or one made from its logo and colour', async () => {
    const before = (await site()).seo.shareVersion;
    const made = await shareImage(HOST_A);
    expect([made.width, made.height]).toEqual([1200, 630]);
    const upload = await http().post('/media').query({ purpose: 'share' }).set(as('ownerA'))
      .attach('file', await sharp({ create: { width: 1400, height: 800, channels: 3, background: '#2a9d8f' } }).png().toBuffer(), { filename: 's.png', contentType: 'image/png' })
      .expect(201);
    const st = (await http().put('/clinic/website/seo').set(as('ownerA')).send({ shareFileId: upload.body.id }).expect(200)).body;
    expect(st.seo.shareImage.id).toBe(upload.body.id);
    expect((await site()).seo.shareVersion).not.toBe(before); // shared links refresh
    const own = await shareImage(HOST_A);
    expect([own.format, own.width, own.height]).toEqual(['jpeg', 1200, 630]);
    // a gallery image is not a share image; removing it goes back to the made one
    const gallery = (await http().post('/media').set(as('ownerA'))
      .attach('file', await sharp({ create: { width: 900, height: 700, channels: 3, background: '#111111' } }).png().toBuffer(), { filename: 'g.png', contentType: 'image/png' })
      .expect(201)).body.id;
    uploaded.push(gallery);
    expect((await http().put('/clinic/website/seo').set(as('ownerA')).send({ shareFileId: gallery }).expect(400)).body.code).toBe('wrong_image_kind');
    expect((await http().put('/clinic/website/seo').set(as('ownerA')).send({ shareFileId: null }).expect(200)).body.seo.shareImage).toBeNull();
    // another clinic's site has its own; an unknown host has none
    await shareImage(HOST_B);
    await http().get('/public/share-image').query({ host: 'nobody.lvh.me' }).expect(404);
  });

  it('the service pages\' data: each service\'s doctors on the site; questions and cases name their service', async () => {
    const s = await site();
    expect(s.services.every((x: { doctor_ids: unknown }) => Array.isArray(x.doctor_ids))).toBe(true);
    const doctorIds = new Set(s.doctors.map((d: { id: string }) => d.id));
    expect(s.services.flatMap((x: { doctor_ids: string[] }) => x.doctor_ids).every((id: string) => doctorIds.has(id))).toBe(true);
    expect(s.faqs.every((f: object) => 'service_id' in f)).toBe(true);
  });
});
