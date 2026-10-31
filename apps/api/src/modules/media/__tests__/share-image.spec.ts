import sharp from 'sharp';
import { brandOf, shareImage, SHARE_H, SHARE_W } from '../share-image';

const png = (w: number, h: number, color: string) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

describe('the share image (Phase 2C-3)', () => {
  it('is a 1200×630 JPEG from the clinic\'s image, cropped to fill', async () => {
    const out = await shareImage({ image: await png(800, 800, '#118844') });
    const m = await sharp(out).metadata();
    expect([m.format, m.width, m.height]).toEqual(['jpeg', SHARE_W, SHARE_H]);
  });
  it('without one: the logo on the brand colour, or a tooth on it', async () => {
    for (const out of [await shareImage({ logo: await png(400, 120, '#000000'), brand: '#0ea5e9' }), await shareImage({ brand: '#0ea5e9' })]) {
      const m = await sharp(out).metadata();
      expect([m.format, m.width, m.height]).toEqual(['jpeg', SHARE_W, SHARE_H]);
      // the corner is the brand colour
      const { data } = await sharp(out).extract({ left: 4, top: 4, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      expect(Math.abs(data[0] - 0x0e) + Math.abs(data[1] - 0xa5) + Math.abs(data[2] - 0xe9)).toBeLessThan(30);
    }
  });
  it('only a plain #rrggbb colour is used', () => {
    expect(brandOf('#0EA5E9')).toBe('#0EA5E9');
    expect(brandOf('red;</svg>')).toBe('#4f46e5');
    expect(brandOf(null)).toBe('#4f46e5');
  });
});
