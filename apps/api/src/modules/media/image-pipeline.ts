import sharp from 'sharp';
import { MEDIA_POLICY } from '../../config';
import { Err } from '../../shared/errors/app-error';

export interface Rendition { width: number; body: Buffer }
export interface ProcessedImage { width: number; height: number; renditions: Rendition[] }

/** Which rendition widths to produce for an image this wide: the policy widths it reaches, never upscaled. */
export function renditionWidths(original: number, widths: readonly number[] = MEDIA_POLICY.purposes.gallery.widths): number[] {
  const fit = widths.filter((w) => w <= original);
  // an image narrower than the largest width still gets a rendition at its own size, so nothing is lost
  if (!fit.length || original > fit[fit.length - 1]) fit.push(Math.min(original, widths[widths.length - 1]));
  return [...new Set(fit)].sort((a, b) => a - b);
}

/**
 * Decodes the upload (the declared MIME type and file name are not trusted), refuses anything that is not a real
 * JPEG/PNG/WebP within the size limits, applies the EXIF orientation, and re-encodes WebP renditions. Re-encoding
 * drops every metadata block — EXIF, GPS position, camera serials — so a photo taken in the clinic never publishes
 * where it was taken or by which phone.
 */
export async function processImage(input: Buffer, rules: { minSide: number; widths: readonly number[] } = MEDIA_POLICY.purposes.gallery): Promise<ProcessedImage> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(input, { limitInputPixels: MEDIA_POLICY.maxInputPixels, failOn: 'error' }).metadata();
  } catch {
    throw Err.badRequest('invalid_image', 'The file is not a readable image');
  }
  if (!meta.format || !(MEDIA_POLICY.acceptedFormats as readonly string[]).includes(meta.format)) {
    throw Err.badRequest('unsupported_image_type', 'Only JPEG, PNG and WebP images can be uploaded', { format: meta.format ?? null });
  }
  // orientation 5–8 means the stored pixels are rotated by 90°: the visible width is the stored height
  const turned = (meta.orientation ?? 1) >= 5;
  const width = (turned ? meta.height : meta.width) ?? 0;
  const height = (turned ? meta.width : meta.height) ?? 0;
  if (Math.min(width, height) < rules.minSide) {
    throw Err.badRequest('image_too_small', `Images must be at least ${rules.minSide} pixels on each side`, { width, height, minSide: rules.minSide });
  }
  // review R11: the upload is decoded once — turned upright and brought down to the largest rendition — and every
  // rendition is made from those pixels; each rendition used to decode the whole original again.
  const widths = renditionWidths(width, rules.widths);
  const { data, info } = await sharp(input, { limitInputPixels: MEDIA_POLICY.maxInputPixels }).rotate()
    .resize({ width: widths[widths.length - 1], withoutEnlargement: true }).raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  const raw = { raw: { width: info.width, height: info.height, channels: info.channels } };
  const renditions = await Promise.all(widths.map(async (w) => ({
    width: w,
    body: await sharp(data, raw).resize({ width: w, withoutEnlargement: true }).webp({ quality: MEDIA_POLICY.webpQuality }).toBuffer(),
  })));
  return { width, height, renditions };
}
