import sharp from 'sharp';

/**
 * Phase 2C-3: the image shown when a clinic's site is shared (WhatsApp, Facebook…): a 1200×630 JPEG — the size every
 * network shows large, and a format they all read (renditions are WebP). Made from the clinic's chosen image, or else
 * from its logo on its brand colour, or else a tooth on its brand colour. No text is drawn (the server may lack Arabic
 * fonts; the shared title carries the name). Pure image work, unit-tested.
 */
export const SHARE_W = 1200;
export const SHARE_H = 630;
const DEFAULT_BRAND = '#4f46e5';

export const brandOf = (c: string | null | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_BRAND);

/** A simple tooth, in white, centred (used when the clinic has neither a share image nor a logo). */
const TOOTH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_W}" height="${SHARE_H}" viewBox="0 0 ${SHARE_W} ${SHARE_H}">
  <g transform="translate(${SHARE_W / 2 - 110} ${SHARE_H / 2 - 120})" fill="#ffffff" fill-opacity="0.92">
    <path d="M60 0C26 0 0 28 0 66c0 30 10 52 20 82 10 30 12 92 34 92 22 0 22-60 56-60s34 60 56 60c22 0 24-62 34-92s20-52 20-82C220 28 194 0 160 0c-22 0-34 12-50 12S82 0 60 0Z"/>
  </g></svg>`;

export async function shareImage(input: { image?: Buffer | null; logo?: Buffer | null; brand?: string | null }): Promise<Buffer> {
  if (input.image) {
    // JPEG has no transparency: a transparent area turns white, not black
    return sharp(input.image).flatten({ background: '#ffffff' }).resize(SHARE_W, SHARE_H, { fit: 'cover', position: 'attention' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  }
  const base = sharp({ create: { width: SHARE_W, height: SHARE_H, channels: 3, background: brandOf(input.brand) } });
  if (input.logo) {
    // the logo on a white rounded card, so a dark or transparent logo reads on any brand colour
    const cardW = 640, cardH = 360;
    const card = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}"><rect width="${cardW}" height="${cardH}" rx="36" fill="#ffffff"/></svg>`);
    const logo = await sharp(input.logo).resize(cardW - 120, cardH - 100, { fit: 'inside', withoutEnlargement: false }).png().toBuffer();
    const m = await sharp(logo).metadata();
    return base.composite([
      { input: card, left: (SHARE_W - cardW) / 2, top: (SHARE_H - cardH) / 2 },
      { input: logo, left: Math.round((SHARE_W - (m.width ?? 0)) / 2), top: Math.round((SHARE_H - (m.height ?? 0)) / 2) },
    ]).jpeg({ quality: 85 }).toBuffer();
  }
  return base.composite([{ input: Buffer.from(TOOTH_SVG), left: 0, top: 0 }]).jpeg({ quality: 85 }).toBuffer();
}
