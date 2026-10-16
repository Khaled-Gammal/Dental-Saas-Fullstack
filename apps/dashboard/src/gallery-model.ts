/**
 * Gallery and upload rules mirrored from the API (MEDIA_POLICY, gallery CHECKs). Pure functions, unit-tested in
 * __tests__/gallery-model.test.ts. The server stays the authority; these only spare the user a round trip.
 */
import type { GalleryItem } from './types';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ACCEPT_ATTR = ACCEPTED_TYPES.join(',');

export type UploadProblem = 'type' | 'size';
/** A quick check before sending; the server decodes the file and checks again (a renamed file is caught there). */
export function uploadProblem(f: { type: string; size: number }): UploadProblem | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(f.type)) return 'type';
  if (f.size > MAX_UPLOAD_BYTES) return 'size';
  return null;
}

/** The ids after moving one item up (-1) or down (+1); unchanged at the ends. */
export function moveId(ids: string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const out = [...ids];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Reordering sends the whole scope, so it is only offered when the screen shows exactly one complete scope. */
export const canReorder = (f: { scope: string; status: string; q: string; hasMore: boolean }) => f.scope !== 'all' && f.status === 'all' && !f.q.trim() && !f.hasMore;

export interface GalleryForm { branchId: string; captionAr: string; captionEn: string; altAr: string; altEn: string; isPublished: boolean; isFeatured: boolean }

export const toGalleryForm = (g: GalleryItem): GalleryForm => ({
  branchId: g.branch_id ?? '', captionAr: g.caption_ar ?? '', captionEn: g.caption_en ?? '', altAr: g.alt_ar ?? '', altEn: g.alt_en ?? '',
  isPublished: g.is_published, isFeatured: g.is_featured,
});

/** The same rule as the API (gallery_items_published_described): a published photo is described for screen readers. */
export const describedEnough = (f: Pick<GalleryForm, 'captionAr' | 'captionEn' | 'altAr' | 'altEn'>) =>
  [f.altAr, f.altEn, f.captionAr, f.captionEn].some((v) => v.trim().length > 0);

export type GalleryProblem = 'alt_required' | 'featured_requires_published';
export function galleryProblems(f: GalleryForm): GalleryProblem[] {
  const out: GalleryProblem[] = [];
  if (f.isPublished && !describedEnough(f)) out.push('alt_required');
  if (f.isFeatured && !f.isPublished) out.push('featured_requires_published');
  return out;
}

/** PATCH body: only what changed; emptied text becomes null; the scope is null for clinic-wide. */
export function galleryBody(f: GalleryForm, orig: GalleryForm): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const text: [keyof GalleryForm, string][] = [['captionAr', 'captionAr'], ['captionEn', 'captionEn'], ['altAr', 'altAr'], ['altEn', 'altEn']];
  for (const [k, api] of text) if (f[k] !== orig[k]) body[api] = String(f[k]).trim() || null;
  if (f.branchId !== orig.branchId) body.branchId = f.branchId || null;
  if (f.isPublished !== orig.isPublished) body.isPublished = f.isPublished;
  if (f.isFeatured !== orig.isFeatured) body.isFeatured = f.isFeatured;
  return body;
}

/** `srcset` for a signed image: the API only signs the smallest and largest renditions, which is all a thumbnail needs. */
export const imageSrcSet = (img: { thumbUrl: string; fullUrl: string; widths: number[] }) =>
  `${img.thumbUrl} ${img.widths[0]}w, ${img.fullUrl} ${img.widths[img.widths.length - 1]}w`;
