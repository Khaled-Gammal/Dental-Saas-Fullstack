import { Injectable } from '@nestjs/common';
import type { Tx } from '@dental/db';
import { Err } from '../../shared/errors/app-error';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { MediaService } from '../media';
import { LiveSiteWrite } from '../website/live-site';
import { GalleryRepository, type GalleryFields, type GalleryRow } from './gallery.repository';
import type { CreateGalleryItemInput, ListGalleryQueryInput, UpdateGalleryItemInput } from './gallery.schemas';

const notFound = () => Err.notFound('gallery_item_not_found', 'Photo not found');

const toFields = (i: UpdateGalleryItemInput): GalleryFields => ({
  ...(i.branchId !== undefined && { branch_id: i.branchId }),
  ...(i.captionAr !== undefined && { caption_ar: i.captionAr }),
  ...(i.captionEn !== undefined && { caption_en: i.captionEn }),
  ...(i.altAr !== undefined && { alt_ar: i.altAr }),
  ...(i.altEn !== undefined && { alt_en: i.altEn }),
  ...(i.isPublished !== undefined && { is_published: i.isPublished }),
  ...(i.isFeatured !== undefined && { is_featured: i.isFeatured }),
});

/** The rules a photo must meet to be shown (also CHECKs in the database; checked here first for clear messages). */
function assertShowable(s: { is_published: boolean; is_featured: boolean; alt_ar: string | null; alt_en: string | null; caption_ar: string | null; caption_en: string | null }) {
  if (s.is_featured && !s.is_published) throw Err.badRequest('featured_requires_published', 'Only a published photo can be featured');
  if (s.is_published && !(s.alt_ar || s.alt_en || s.caption_ar || s.caption_en)) {
    throw Err.badRequest('alt_required', 'Describe the photo (alt text or caption) before publishing it');
  }
}

const encodeCursor = (r: GalleryRow) => Buffer.from(`${r.sort_order}|${r.id}`).toString('base64url');
function decodeCursor(c?: string) {
  if (!c) return null;
  const [s, id] = Buffer.from(c, 'base64url').toString().split('|');
  return /^-?\d+$/.test(s ?? '') && /^[0-9a-f-]{36}$/.test(id ?? '') ? { sort: Number(s), id } : null;
}

/**
 * Clinic and branch photo galleries (website-content phase 1). Every change goes through `LiveSiteWrite` (the
 * website cache is purged after commit), and the file's visibility follows: an image is public exactly while a
 * published photo shows it.
 */
@Injectable()
export class GalleryService {
  constructor(
    private readonly db: TenantDb,
    private readonly site: LiveSiteWrite,
    private readonly repo: GalleryRepository,
    private readonly media: MediaService,
  ) {}

  private view(tenantId: string, r: GalleryRow) {
    const { file_id, width, height, variant_widths, ...item } = r;
    return { ...item, image: this.media.view(tenantId, { id: file_id, width, height, variant_widths }) };
  }

  list(q: ListGalleryQueryInput) {
    return this.db.run(async (tx, tenantId) => {
      const rows = await this.repo.list(tx, { ...q, after: decodeCursor(q.cursor), limit: q.limit + 1 });
      const items = rows.slice(0, q.limit);
      return { items: items.map((r) => this.view(tenantId, r)), nextCursor: rows.length > q.limit ? encodeCursor(items[items.length - 1]) : null };
    });
  }

  get(id: string) {
    return this.db.run(async (tx, tenantId) => {
      const r = await this.repo.get(tx, id);
      if (!r) throw notFound();
      return this.view(tenantId, r);
    });
  }

  create(input: CreateGalleryItemInput) {
    return this.site.run(async (tx, tenantId) => {
      await this.media.assertAttachable(tx, input.fileId);
      const f = toFields(input);
      await this.assertBranch(tx, f.branch_id);
      assertShowable({ is_published: false, is_featured: false, alt_ar: null, alt_en: null, caption_ar: null, caption_en: null, ...f });
      if (f.is_featured) await this.repo.unfeatureOthers(tx, f.branch_id ?? null, null);
      const { id } = await this.repo.create(tx, tenantId, input.fileId, f);
      await this.media.refreshVisibility(tx, [input.fileId]);
      return this.view(tenantId, (await this.repo.get(tx, id))!);
    });
  }

  update(id: string, input: UpdateGalleryItemInput) {
    return this.site.run(async (tx, tenantId) => {
      const cur = await this.repo.lock(tx, id);
      if (!cur) throw notFound();
      const f = toFields(input);
      await this.assertBranch(tx, f.branch_id);
      const next = { ...cur, ...f };
      // unpublishing takes the "featured" badge away with it
      if (f.is_published === false && cur.is_featured && f.is_featured === undefined) { f.is_featured = false; next.is_featured = false; }
      assertShowable(next);
      if (next.is_featured) await this.repo.unfeatureOthers(tx, next.branch_id ?? null, id);
      await this.repo.update(tx, id, f);
      await this.media.refreshVisibility(tx, [cur.image_file_id]);
      return this.view(tenantId, (await this.repo.get(tx, id))!);
    });
  }

  /** Sets the order of one whole scope (clinic-wide or a branch): the list must be exactly the photos in it. */
  reorder(branchId: string | null, ids: string[]) {
    return this.site.run(async (tx) => {
      await this.assertBranch(tx, branchId);
      const inScope = new Set(await this.repo.scopeIds(tx, branchId));
      if (inScope.size !== ids.length || ids.some((i) => !inScope.has(i))) {
        throw Err.badRequest('order_mismatch', 'The order must list every photo of this gallery exactly once; reload and try again');
      }
      await this.repo.reorder(tx, ids);
      return { ok: true };
    });
  }

  /** Removes the photo; the image itself is deleted after the commit if nothing else uses it. */
  async remove(id: string): Promise<void> {
    const { fileId, tenantId } = await this.site.run(async (tx, tenantId) => {
      const gone = await this.repo.remove(tx, id);
      if (!gone) throw notFound();
      await this.media.refreshVisibility(tx, [gone.image_file_id]);
      return { fileId: gone.image_file_id, tenantId };
    });
    await this.media.deleteIfUnused(tenantId, fileId);
  }

  /** Published photos for a clinic website (hostname-resolved; no ids of drafts, no private files). */
  async publicList(host: string, scope: 'all' | 'clinic' | string) {
    const rows = await this.db.runForHost(host, (tx) => this.repo.publicList(tx, scope));
    if (!rows) throw Err.notFound('site_not_found', 'No clinic at this address');
    return rows.map(({ file_id, width, height, variant_widths, ...r }) => ({ ...r, image: { id: file_id, width, height, widths: variant_widths } }));
  }

  private async assertBranch(tx: Tx, branchId: string | null | undefined) {
    if (branchId && !(await this.repo.branchExists(tx, branchId))) throw Err.badRequest('branch_not_found', 'Branch not found');
  }
}
