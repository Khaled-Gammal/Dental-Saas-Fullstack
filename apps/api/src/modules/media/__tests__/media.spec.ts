import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { MEDIA_POLICY } from '../../../config';
import { LocalObjectStorage } from '../../../shared/storage/local-storage';
import { assertKey } from '../../../shared/storage/ports';
import { processImage, renditionWidths } from '../image-pipeline';
import { MediaSigner } from '../media-urls';

const T = '11111111-1111-1111-1111-111111111111';
const F = '22222222-2222-2222-2222-222222222222';

describe('renditionWidths', () => {
  it('produces the policy widths the image reaches, never upscaling', () => {
    expect(renditionWidths(4000)).toEqual([480, 960, 1600]);
    expect(renditionWidths(1200)).toEqual([480, 960, 1200]);
    expect(renditionWidths(960)).toEqual([480, 960]);
    expect(renditionWidths(300)).toEqual([300]);
  });
});

describe('processImage', () => {
  it('re-encodes to WebP renditions and drops EXIF / GPS', async () => {
    const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#7c3aed' } })
      .jpeg().withExif({ IFD0: { Make: 'PhoneMaker', Model: 'X' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '30/1 3/1 0/1' } }).toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const out = await processImage(jpeg);
    expect(out).toMatchObject({ width: 1200, height: 900 });
    expect(out.renditions.map((r) => r.width)).toEqual([480, 960, 1200]);
    for (const r of out.renditions) {
      const m = await sharp(r.body).metadata();
      expect(m.format).toBe('webp');
      expect(m.exif).toBeUndefined();
      expect(m.width).toBe(r.width);
    }
  });
  it('applies the EXIF orientation (a portrait phone photo stays portrait)', async () => {
    const rotated = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#fff' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await processImage(rotated);
    expect(out).toMatchObject({ width: 400, height: 800 });
    expect((await sharp(out.renditions[0].body).metadata()).height).toBeGreaterThan((await sharp(out.renditions[0].body).metadata()).width!);
  });
  it('refuses non-images, other formats and tiny images whatever the file name says', async () => {
    await expect(processImage(Buffer.from('not an image at all'))).rejects.toMatchObject({ code: 'invalid_image' });
    const gif = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#000' } }).gif().toBuffer();
    await expect(processImage(gif)).rejects.toMatchObject({ code: 'unsupported_image_type' });
    const tiny = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#000' } }).png().toBuffer();
    await expect(processImage(tiny)).rejects.toMatchObject({ code: 'image_too_small' });
  });
  it('applies the purpose: a short wide logo passes the logo rules (small renditions, alpha kept) but not the photo rules', async () => {
    const logo = await sharp({ create: { width: 400, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await processImage(logo, MEDIA_POLICY.purposes.logo);
    expect(out.renditions.map((r) => r.width)).toEqual([128, 256, 400]);
    expect((await sharp(out.renditions[0].body).metadata()).hasAlpha).toBe(true);
    await expect(processImage(logo, MEDIA_POLICY.purposes.photo)).rejects.toMatchObject({ code: 'image_too_small' });
  });
});

describe('MediaSigner', () => {
  const s = new MediaSigner('test-secret-0123456789', 'http://api.test');
  const parse = (u: string) => { const url = new URL(u); return { exp: Number(url.searchParams.get('exp')), sig: url.searchParams.get('sig')! }; };
  it('accepts its own link until it expires', () => {
    const now = Date.UTC(2026, 9, 16);
    const { exp, sig } = parse(s.url(T, F, 480, 60, now));
    expect(s.verify(T, F, 480, exp, sig, now)).toBe(true);
    expect(s.verify(T, F, 480, exp, sig, now + 61_000)).toBe(false);
  });
  it('a link cannot be moved to another file, size or clinic, or extended', () => {
    const now = Date.UTC(2026, 9, 16);
    const { exp, sig } = parse(s.url(T, F, 480, 60, now));
    expect(s.verify(T, F, 1600, exp, sig, now)).toBe(false);
    expect(s.verify(F, F, 480, exp, sig, now)).toBe(false);
    expect(s.verify(T, T, 480, exp, sig, now)).toBe(false);
    expect(s.verify(T, F, 480, exp + 3600, sig, now)).toBe(false);
  });
});

describe('storage keys and the local adapter', () => {
  it('refuses keys that could escape the storage root', () => {
    for (const bad of ['../etc/passwd', '/abs', 'a/../b', 'A/b', 'a//b', '']) expect(() => assertKey(bad)).toThrow();
    expect(() => assertKey(`t/${T}/${F}/480.webp`)).not.toThrow();
  });
  it('stores, reads and deletes objects', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dental-storage-'));
    try {
      const st = new LocalObjectStorage(dir);
      const key = `t/${T}/${F}/480.webp`;
      await st.put(key, Buffer.from('abc'), 'image/webp');
      const got = await st.get(key);
      expect(got).toMatchObject({ contentType: 'image/webp', length: 3 });
      got!.body.destroy();
      await st.deleteMany([key, `t/${T}/${F}/960.webp`]); // a missing key is fine
      expect(await st.get(key)).toBeNull();
      expect(await readdir(path.join(dir, 't', T, F))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
