import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.STORAGE_DRIVER = 'local';
const STORAGE_DIR = mkdtempSync(path.join(tmpdir(), 'dental-e2e-cases-'));
process.env.STORAGE_DIR = STORAGE_DIR;
import { AppModule } from '../src/app.module';

const HOST_A = 'clinic-a.lvh.me';
const photo = (color: string) => sharp({ create: { width: 900, height: 600, channels: 3, background: color } }).png().toBuffer();

/**
 * Phase 2C-2: before/after cases. Published only with the patient's consent (recorded: who confirmed and when); the
 * website shows the published ones and serves their images; withdrawing consent takes a case off the site.
 */
describe('Before/after cases (e2e, Phase 2C-2)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const made: string[] = [];
  const upload = async (color: string, who = 'ownerA') =>
    (await http().post('/media').query({ purpose: 'case' }).set(as(who)).attach('file', await photo(color), { filename: 'case.png', contentType: 'image/png' }).expect(201)).body.id as string;
  const site = async () => (await http().get('/public/site').query({ host: HOST_A }).expect(200)).body;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
  });
  afterAll(async () => {
    for (const id of made) await http().delete(`/gallery/cases/${id}`).set(as('ownerA'));
    await app.close();
    rmSync(STORAGE_DIR, { recursive: true, force: true });
  });

  it('a case needs two different images; it is published only with consent and a description', async () => {
    const before = await upload('#b08a5a');
    const after = await upload('#f4f1ea');
    await http().post('/gallery/cases').set(as('ownerA')).send({ beforeFileId: before, afterFileId: before, consentConfirmed: true }).expect(400);
    expect((await http().post('/gallery/cases').set(as('ownerA')).send({ beforeFileId: before, afterFileId: after, consentConfirmed: false, captionAr: 'تبييض', isPublished: true }).expect(400)).body.code)
      .toBe('consent_required');
    expect((await http().post('/gallery/cases').set(as('ownerA')).send({ beforeFileId: before, afterFileId: after, consentConfirmed: true, isPublished: true }).expect(400)).body.code)
      .toBe('alt_required');
    const c = (await http().post('/gallery/cases').set(as('ownerA')).send({ beforeFileId: before, afterFileId: after, consentConfirmed: true, captionAr: 'تبييض الأسنان في جلستين', isPublished: true }).expect(201)).body;
    made.push(c.id);
    expect(c).toMatchObject({ isPublished: true, consentConfirmed: true, captionAr: 'تبييض الأسنان في جلستين' });
    expect(c.consentConfirmedBy).toBeTruthy(); // the owner who confirmed it, recorded by the database
    expect(new Date(c.consentConfirmedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(c.before.thumbUrl).toBeTruthy();

    // on the site, with its images served
    const s = await site();
    const shown = s.cases.find((x: { id: string }) => x.id === c.id);
    expect(shown).toMatchObject({ caption_ar: 'تبييض الأسنان في جلستين' });
    expect(Object.keys(shown)).not.toContain('consent_confirmed_by'); // nothing about the patient or who confirmed
    const img = await http().get(`/public/case-media/${shown.before.id}/${shown.before.widths[0]}.webp`).query({ host: HOST_A }).expect(200);
    expect(img.headers['cache-control']).toBe('no-store'); // consent can be withdrawn: never cached
    // case images are served only by their own route, and are never a photo
    await http().get(`/public/media/${shown.before.id}/${shown.before.widths[0]}.webp`).query({ host: HOST_A }).expect(404);
    expect((await http().post('/gallery').set(as('ownerA')).send({ fileId: before, altAr: 'صورة', isPublished: true }).expect(400)).body.code).toBe('wrong_image_kind');
    // a website photo is not a case image
    const sitePhoto = (await http().post('/media').set(as('ownerA')).attach('file', await photo('#123456'), { filename: 'p.png', contentType: 'image/png' }).expect(201)).body.id;
    const caseImage = await upload('#654321'); // not inline: a request started inside another's .send() races supertest's server shutdown
    expect((await http().post('/gallery/cases').set(as('ownerA')).send({ beforeFileId: sitePhoto, afterFileId: caseImage, consentConfirmed: false }).expect(400)).body.code)
      .toBe('wrong_image_kind');
  });

  it('a new image on a published case needs the consent confirmed again', async () => {
    const [c] = (await http().get('/gallery/cases').set(as('ownerA')).expect(200)).body.filter((x: { id: string }) => made.includes(x.id));
    const after2 = await upload('#fafafa');
    const r = (await http().patch(`/gallery/cases/${c.id}`).set(as('ownerA')).send({ afterFileId: after2 }).expect(200)).body;
    expect(r).toMatchObject({ consentConfirmed: false, isPublished: false });
    const again = (await http().patch(`/gallery/cases/${c.id}`).set(as('ownerA')).send({ consentConfirmed: true, isPublished: true }).expect(200)).body;
    expect(again).toMatchObject({ consentConfirmed: true, isPublished: true });
  });

  it('withdrawing consent takes the case off the site and makes its images private again', async () => {
    const [c] = (await http().get('/gallery/cases').set(as('ownerA')).expect(200)).body.filter((x: { id: string }) => made.includes(x.id));
    const updated = (await http().patch(`/gallery/cases/${c.id}`).set(as('ownerA')).send({ consentConfirmed: false }).expect(200)).body;
    expect(updated).toMatchObject({ consentConfirmed: false, isPublished: false, consentConfirmedBy: null });
    expect((await site()).cases.some((x: { id: string }) => x.id === c.id)).toBe(false);
    await http().get(`/public/case-media/${c.before.id}/${c.before.widths[0]}.webp`).query({ host: HOST_A }).expect(404);
  });

  it('replacing an image, reordering, and the rights: website editors only, each clinic its own', async () => {
    const [c] = (await http().get('/gallery/cases').set(as('ownerA')).expect(200)).body.filter((x: { id: string }) => made.includes(x.id));
    const after3 = await upload('#ffffff');
    const r = (await http().patch(`/gallery/cases/${c.id}`).set(as('ownerA')).send({ afterFileId: after3, consentConfirmed: true }).expect(200)).body;
    expect(r).toMatchObject({ consentConfirmed: true });
    expect(r.after.id).toBe(after3);
    const [before2, after2] = [await upload('#999999'), await upload('#eeeeee')];
    const two = (await http().post('/gallery/cases').set(as('ownerA'))
      .send({ beforeFileId: before2, afterFileId: after2, consentConfirmed: false }).expect(201)).body;
    made.push(two.id);
    const all = (await http().get('/gallery/cases').set(as('ownerA')).expect(200)).body.map((x: { id: string }) => x.id);
    const reordered = (await http().put('/gallery/cases/order').set(as('ownerA')).send({ ids: [...all].reverse() }).expect(200)).body.map((x: { id: string }) => x.id);
    expect(reordered).toEqual([...all].reverse());
    await http().put('/gallery/cases/order').set(as('ownerA')).send({ ids: [all[0]] }).expect(all.length > 1 ? 400 : 200);
    await http().get('/gallery/cases').set(as('receptionA')).expect(403);
    await http().patch(`/gallery/cases/${c.id}`).set(as('ownerB')).send({ captionAr: 'x' }).expect(404);
    // the photo routes still answer beside /gallery/cases
    await http().get('/gallery').set(as('ownerA')).expect(200);
  });
});
