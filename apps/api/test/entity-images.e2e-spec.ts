import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import '../src/config'; // loads the root .env
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.STORAGE_DRIVER = 'local';
const STORAGE_DIR = mkdtempSync(path.join(tmpdir(), 'dental-e2e-images-'));
process.env.STORAGE_DIR = STORAGE_DIR;
import { AppModule } from '../src/app.module';

const HOST_A = 'clinic-a.lvh.me';
const HOST_B = 'clinic-b.lvh.me';
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const AHMED = 'f0000000-0000-0000-0000-0000000000a1';
const CONSULT = '90000000-0000-0000-0000-0000000000a1';
const MAADI = 'd0000000-0000-0000-0000-0000000000a2';

const png = (w: number, h: number, color = '#4f46e5') => sharp({ create: { width: w, height: h, channels: 4, background: color } }).png().toBuffer();
const stored = (id: string, w: number) => existsSync(path.join(STORAGE_DIR, 't', TENANT_A, id, `${w}.webp`));

describe('Images on the clinic, doctors, services and branches (e2e)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });

  const upload = async (purpose: string, body: Buffer, who = 'ownerA') =>
    http().post(`/media?purpose=${purpose}`).set(as(who)).attach('file', body, { filename: 'x.png', contentType: 'image/png' });
  const uploaded = async (purpose: string, body?: Buffer, who = 'ownerA') => {
    const res = await upload(purpose, body ?? (await png(900, 900)), who);
    expect(res.status).toBe(201);
    return res.body as { id: string; widths: number[] };
  };
  const publicImage = (id: string, w: number, host = HOST_A) => http().get(`/public/media/${id}/${w}.webp?host=${host}`);
  const site = async () => (await http().get(`/public/site?host=${HOST_A}`).expect(200)).body;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    for (const [who, email] of [['ownerA', 'owner.a@demo.test'], ['receptionA', 'reception.a@demo.test'], ['ownerB', 'owner.b@demo.test']]) {
      token[who] = (await http().post('/auth/dev-login').send({ email }).expect(201)).body.accessToken;
    }
  });
  afterAll(async () => {
    // put the seed back as it was
    await http().patch('/clinic/profile').set(as('ownerA')).send({ logoFileId: null });
    await http().patch(`/doctors/${AHMED}`).set(as('ownerA')).send({ photoFileId: null, showOnWebsite: true });
    await http().patch(`/services/${CONSULT}`).set(as('ownerA')).send({ imageFileId: null });
    await http().patch(`/branches/${MAADI}`).set(as('ownerA')).send({ photoFileId: null, isActive: true });
    await app.close();
    rmSync(STORAGE_DIR, { recursive: true, force: true });
  });

  it('uploads follow the purpose: a wide logo is accepted with small renditions; a bad purpose is refused', async () => {
    const logo = await uploaded('logo', await png(400, 100));
    expect(logo.widths).toEqual([128, 256, 400]);
    const photo = await uploaded('photo', await png(2000, 1500));
    expect(photo.widths).toEqual([320, 640, 1280]);
    expect((await upload('photo', await png(400, 100))).body.code).toBe('image_too_small'); // the logo's rules do not apply to photos
    expect((await upload('banner', await png(900, 900))).status).toBe(400);
  });

  it('logos and record photos need settings:write', async () => {
    expect((await upload('photo', await png(900, 900), 'receptionA')).status).toBe(403);
    expect((await upload('logo', await png(400, 100), 'receptionA')).status).toBe(403);
  });

  it('the clinic logo: saved on the profile, shown on the website, served publicly to this clinic only', async () => {
    const logo = await uploaded('logo', await png(400, 100));
    const res = await http().patch('/clinic/profile').set(as('ownerA')).send({ logoFileId: logo.id }).expect(200);
    expect(res.body.logo).toMatchObject({ id: logo.id, width: 400, height: 100 });
    expect(res.body.logo.thumbUrl).toContain(`/media/${TENANT_A}/${logo.id}/128.webp`);
    expect((await http().get('/clinic/profile').set(as('ownerA')).expect(200)).body.logo.id).toBe(logo.id);
    expect((await site()).clinic.logo).toEqual({ id: logo.id, width: 400, height: 100, widths: [128, 256, 400] });
    await publicImage(logo.id, 128).expect(200).expect('content-type', 'image/webp');
    await publicImage(logo.id, 128, HOST_B).expect(404);
  });

  it('a doctor photo: attached, public while the doctor is shown, replaced (old one deleted) and removed', async () => {
    const first = await uploaded('photo');
    const res = await http().patch(`/doctors/${AHMED}`).set(as('ownerA')).send({ photoFileId: first.id }).expect(200);
    expect(res.body.photo).toMatchObject({ id: first.id, widths: [320, 640, 900] });
    expect((await http().get('/doctors').set(as('ownerA')).expect(200)).body.find((d: { id: string }) => d.id === AHMED).photo.id).toBe(first.id);
    expect((await site()).doctors.find((d: { id: string }) => d.id === AHMED).photo.id).toBe(first.id);
    await publicImage(first.id, 320).expect(200);

    await http().patch(`/doctors/${AHMED}`).set(as('ownerA')).send({ showOnWebsite: false }).expect(200);
    await publicImage(first.id, 320).expect(404); // hidden doctor: photo off the site at once
    await http().patch(`/doctors/${AHMED}`).set(as('ownerA')).send({ showOnWebsite: true }).expect(200);
    await publicImage(first.id, 320).expect(200);

    const second = await uploaded('photo');
    await http().patch(`/doctors/${AHMED}`).set(as('ownerA')).send({ photoFileId: second.id }).expect(200);
    expect(stored(first.id, 320)).toBe(false); // the replaced photo is deleted, row and objects
    await publicImage(first.id, 320).expect(404);

    const cleared = await http().patch(`/doctors/${AHMED}`).set(as('ownerA')).send({ photoFileId: null }).expect(200);
    expect(cleared.body.photo).toBeNull();
    expect(stored(second.id, 320)).toBe(false);
  });

  it('a new doctor can be created with a photo', async () => {
    const p = await uploaded('photo');
    // the seeded plan may be at its doctor limit; either the doctor is created with the photo or the limit answers first
    const res = await http().post('/doctors').set(as('ownerA')).send({ nameEn: 'Dr Photo Test', photoFileId: p.id });
    if (res.status === 201) {
      expect(res.body.photo.id).toBe(p.id);
      await http().patch(`/doctors/${res.body.id}`).set(as('ownerA')).send({ isActive: false, photoFileId: null }).expect(200);
    } else {
      expect(res.body.code).toBe('plan_limit_reached');
    }
  });

  it('a service image and a branch photo: public while the record is on the site', async () => {
    const img = await uploaded('photo');
    const s = await http().patch(`/services/${CONSULT}`).set(as('ownerA')).send({ imageFileId: img.id }).expect(200);
    expect(s.body.image.id).toBe(img.id);
    expect((await site()).services.find((x: { id: string }) => x.id === CONSULT).image.id).toBe(img.id);
    await publicImage(img.id, 640).expect(200);

    const bp = await uploaded('photo');
    const b = await http().patch(`/branches/${MAADI}`).set(as('ownerA')).send({ photoFileId: bp.id }).expect(200);
    expect(b.body.photo.id).toBe(bp.id);
    expect((await site()).branches.find((x: { id: string }) => x.id === MAADI).photo.id).toBe(bp.id);
    await publicImage(bp.id, 640).expect(200);
    await http().patch(`/branches/${MAADI}`).set(as('ownerA')).send({ isActive: false }).expect(200);
    await publicImage(bp.id, 640).expect(404); // closed branch: photo off the site
    await http().patch(`/branches/${MAADI}`).set(as('ownerA')).send({ isActive: true }).expect(200);
  });

  it("refuses an image uploaded for something else, a missing one and another clinic's", async () => {
    const galleryPhoto = await uploaded('gallery');
    expect((await http().patch(`/doctors/${AHMED}`).set(as('ownerA')).send({ photoFileId: galleryPhoto.id }).expect(400)).body.code).toBe('wrong_image_kind');
    const logo = await uploaded('logo', await png(400, 100));
    expect((await http().patch(`/services/${CONSULT}`).set(as('ownerA')).send({ imageFileId: logo.id }).expect(400)).body.code).toBe('wrong_image_kind');
    const photo = await uploaded('photo');
    expect((await http().patch('/clinic/profile').set(as('ownerA')).send({ logoFileId: photo.id }).expect(400)).body.code).toBe('wrong_image_kind');
    expect((await http().patch(`/doctors/${AHMED}`).set(as('ownerA')).send({ photoFileId: '00000000-0000-4000-8000-000000000000' }).expect(400)).body.code).toBe('file_not_found');
    const theirs = await uploaded('photo', undefined, 'ownerB');
    expect((await http().patch(`/branches/${MAADI}`).set(as('ownerA')).send({ photoFileId: theirs.id }).expect(400)).body.code).toBe('file_not_found');
  });

  it('an uploaded image is private until something on the site shows it', async () => {
    const p = await uploaded('photo');
    await publicImage(p.id, 320).expect(404);
  });
});
