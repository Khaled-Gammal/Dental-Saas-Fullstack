import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { existsSync } from 'node:fs';
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
const STORAGE_DIR = mkdtempSync(path.join(tmpdir(), 'dental-e2e-media-'));
process.env.STORAGE_DIR = STORAGE_DIR;
import { AppModule } from '../src/app.module';

const HOST_A = 'clinic-a.lvh.me';
const HOST_B = 'clinic-b.lvh.me';
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const NASR = 'd0000000-0000-0000-0000-0000000000a1';

const photo = (w = 1200, h = 800, color = '#6d4ed6') => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const pathOf = (u: string) => { const x = new URL(u); return x.pathname + x.search; };

describe('Media uploads and gallery (e2e)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });
  const made: string[] = [];
  let samplePng: Buffer;

  /** The request itself (not a promise of it), so callers can chain .expect(). */
  const upload = (who = 'ownerA', body?: Buffer, name = 'photo.png') =>
    http().post('/media').set(as(who)).attach('file', body ?? samplePng, { filename: name, contentType: 'image/png' });

  beforeAll(async () => {
    samplePng = await photo();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
  });
  afterAll(async () => {
    for (const id of made) await http().delete(`/gallery/${id}`).set(as('ownerA'));
    await app.close();
    rmSync(STORAGE_DIR, { recursive: true, force: true });
  });

  describe('upload', () => {
    it('accepts a real image and stores WebP renditions', async () => {
      const res = await upload().expect(201);
      expect(res.body).toMatchObject({ width: 1200, height: 800, widths: [480, 960, 1200] });
      for (const w of res.body.widths) expect(existsSync(path.join(STORAGE_DIR, 't', TENANT_A, res.body.id, `${w}.webp`))).toBe(true);
      const thumb = await http().get(pathOf(res.body.thumbUrl)).expect(200);
      expect(thumb.headers['content-type']).toBe('image/webp');
      expect(thumb.headers['cache-control']).toContain('private');
    });

    it('refuses what is not an image, other formats, tiny images and oversized files', async () => {
      expect((await upload('ownerA', Buffer.from('MZ fake executable'), 'innocent.png').expect(400)).body.code).toBe('invalid_image');
      const gif = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#000' } }).gif().toBuffer();
      expect((await upload('ownerA', gif, 'x.gif').expect(400)).body.code).toBe('unsupported_image_type');
      expect((await upload('ownerA', await photo(100, 100), 'tiny.png').expect(400)).body.code).toBe('image_too_small');
      expect((await upload('ownerA', Buffer.alloc(11 * 1024 * 1024, 1), 'huge.png').expect(413)).body.code).toBe('payload_too_large');
      expect((await http().post('/media').set(as('ownerA')).expect(400)).body.code).toBe('file_required');
    });

    it('needs website:write', async () => {
      await upload('receptionA').expect(403);
      await http().post('/media').attach('file', await photo(), 'p.png').expect(401);
    });

    it('signed links cannot be tampered with or used after they expire', async () => {
      const res = await upload().expect(201);
      const u = new URL(res.body.thumbUrl);
      u.searchParams.set('sig', `${u.searchParams.get('sig')!.slice(0, -2)}xx`);
      expect((await http().get(u.pathname + u.search).expect(403)).body.code).toBe('link_expired');
      const v = new URL(res.body.thumbUrl);
      v.searchParams.set('exp', String(Math.floor(Date.now() / 1000) - 10));
      await http().get(v.pathname + v.search).expect(403);
      const w = new URL(res.body.thumbUrl.replace('/480.webp', '/960.webp')); // same signature, other size
      await http().get(w.pathname + w.search).expect(403);
    });
  });

  describe('gallery', () => {
    let first: { id: string; image: { id: string } };
    let second: { id: string };

    it('a new photo is a draft: invisible on the website and its file is private', async () => {
      const file = (await upload().expect(201)).body;
      const res = await http().post('/gallery').set(as('ownerA')).send({ fileId: file.id }).expect(201);
      first = res.body;
      made.push(first.id);
      expect(res.body).toMatchObject({ is_published: false, is_featured: false, branch_id: null, image: { id: file.id, widths: [480, 960, 1200] } });
      const pub = await http().get('/public/gallery').query({ host: HOST_A }).expect(200);
      expect(pub.body.map((g: { id: string }) => g.id)).not.toContain(first.id);
      await http().get(`/public/media/${file.id}/480.webp`).query({ host: HOST_A }).expect(404);
    });

    it('publishing needs a description; then the photo and its image are public', async () => {
      expect((await http().patch(`/gallery/${first.id}`).set(as('ownerA')).send({ isPublished: true }).expect(400)).body.code).toBe('alt_required');
      await http().patch(`/gallery/${first.id}`).set(as('ownerA')).send({ isPublished: true, altAr: 'غرفة الكشف', captionAr: 'غرفة الكشف الرئيسية' }).expect(200);
      const pub = await http().get('/public/gallery').query({ host: HOST_A }).expect(200);
      const item = pub.body.find((g: { id: string }) => g.id === first.id);
      expect(item).toMatchObject({ alt_ar: 'غرفة الكشف', image: { id: first.image.id, widths: [480, 960, 1200] } });
      expect(item.is_published).toBeUndefined(); // only public fields leave the API
      const img = await http().get(`/public/media/${first.image.id}/960.webp`).query({ host: HOST_A }).expect(200);
      expect(img.headers['cache-control']).toContain('public');
      await http().get(`/public/media/${first.image.id}/960.webp`).query({ host: HOST_B }).expect(404); // another clinic's site
    });

    it('one featured photo per scope; featuring needs publishing', async () => {
      const file = (await upload().expect(201)).body;
      expect((await http().post('/gallery').set(as('ownerA')).send({ fileId: file.id, isFeatured: true, altAr: 'x' }).expect(400)).body.code).toBe('featured_requires_published');
      second = (await http().post('/gallery').set(as('ownerA')).send({ fileId: file.id, isPublished: true, isFeatured: true, altAr: 'الاستقبال' }).expect(201)).body;
      made.push(second.id);
      await http().patch(`/gallery/${first.id}`).set(as('ownerA')).send({ isFeatured: true }).expect(200);
      const a = await http().get(`/gallery/${first.id}`).set(as('ownerA')).expect(200);
      const b = await http().get(`/gallery/${second.id}`).set(as('ownerA')).expect(200);
      expect([a.body.is_featured, b.body.is_featured]).toEqual([true, false]);
    });

    it('reorders a whole scope; a partial or foreign list is refused', async () => {
      const scope = await http().get('/gallery').query({ scope: 'clinic' }).set(as('ownerA')).expect(200);
      const ids: string[] = scope.body.items.map((g: { id: string }) => g.id);
      const reversed = [...ids].reverse();
      await http().put('/gallery/order').set(as('ownerA')).send({ branchId: null, ids: reversed }).expect(200);
      const after = await http().get('/gallery').query({ scope: 'clinic' }).set(as('ownerA')).expect(200);
      expect(after.body.items.map((g: { id: string }) => g.id)).toEqual(reversed);
      expect((await http().put('/gallery/order').set(as('ownerA')).send({ branchId: null, ids: reversed.slice(1) }).expect(400)).body.code).toBe('order_mismatch');
    });

    it('branch galleries; another clinic cannot use this clinic\'s branch, photos or files', async () => {
      const file = (await upload().expect(201)).body;
      const res = await http().post('/gallery').set(as('ownerA')).send({ fileId: file.id, branchId: NASR, isPublished: true, altAr: 'فرع مدينة نصر' }).expect(201);
      made.push(res.body.id);
      const branchOnly = await http().get('/public/gallery').query({ host: HOST_A, scope: NASR }).expect(200);
      expect(branchOnly.body.map((g: { id: string }) => g.id)).toEqual([res.body.id]);
      expect((await http().post('/gallery').set(as('ownerB')).send({ fileId: file.id }).expect(400)).body.code).toBe('file_not_found');
      const fileB = (await upload('ownerB').expect(201)).body;
      expect((await http().post('/gallery').set(as('ownerB')).send({ fileId: fileB.id, branchId: NASR }).expect(400)).body.code).toBe('branch_not_found');
      await http().get(`/gallery/${res.body.id}`).set(as('ownerB')).expect(404);
      await http().patch(`/gallery/${res.body.id}`).set(as('ownerB')).send({ captionAr: 'x' }).expect(404);
      await http().delete(`/gallery/${res.body.id}`).set(as('ownerB')).expect(404);
      const listB = await http().get('/gallery').set(as('ownerB')).expect(200);
      expect(listB.body.items.map((g: { id: string }) => g.id)).not.toContain(res.body.id);
      await http().get('/gallery').set(as('receptionA')).expect(403);
    });

    it('deleting a photo removes its image files once nothing uses them', async () => {
      const file = (await upload().expect(201)).body;
      const res = await http().post('/gallery').set(as('ownerA')).send({ fileId: file.id }).expect(201);
      await http().delete(`/gallery/${res.body.id}`).set(as('ownerA')).expect(204);
      await http().get(`/gallery/${res.body.id}`).set(as('ownerA')).expect(404);
      expect(existsSync(path.join(STORAGE_DIR, 't', TENANT_A, file.id, '480.webp'))).toBe(false);
      await http().get(pathOf(file.thumbUrl)).expect(404);
    });
  });
});
