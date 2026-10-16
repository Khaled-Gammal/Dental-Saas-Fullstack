import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';
import type { MediaKind } from '../../config';

export interface FileRow { id: string; width: number | null; height: number | null; variant_widths: number[]; is_private: boolean; kind: string }

/** `files` rows for uploaded images. RLS scopes every query to the current clinic. */
@Injectable()
export class MediaRepository {
  insert(tx: Tx, f: { id: string; tenantId: string; kind: MediaKind; bucket: string; objectKey: string; sizeBytes: number; width: number; height: number; widths: number[]; uploadedBy: string | null }) {
    return tx.insertInto('files').values({
      id: f.id, tenant_id: f.tenantId, bucket: f.bucket, object_key: f.objectKey, mime_type: 'image/webp', size_bytes: f.sizeBytes,
      kind: f.kind, is_private: true, width: f.width, height: f.height, variant_widths: f.widths, uploaded_by: f.uploadedBy,
    }).execute();
  }

  async usedBytes(tx: Tx, tenantId: string): Promise<number> {
    const r = await tx.selectFrom('files').select(sql<string>`coalesce(sum(size_bytes), 0)`.as('n')).where('tenant_id', '=', tenantId).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  get(tx: Tx, id: string): Promise<FileRow | undefined> {
    return tx.selectFrom('files').select(['id', 'width', 'height', 'variant_widths', 'is_private', 'kind']).where('id', '=', id).executeTakeFirst();
  }

  /** Whether the website may serve this file now (`file_is_public`: published gallery photo, logo, shown doctor/service, open branch). */
  async isPublic(tx: Tx, id: string): Promise<boolean> {
    const { rows } = await sql<{ ok: boolean }>`select file_is_public(${id}::uuid) as ok`.execute(tx);
    return !!rows[0]?.ok;
  }

  /**
   * The gallery's own flag (its public list filters on it). Whether a file may be served is decided live by
   * `isPublic`; this flag only mirrors it for gallery files. Every module that puts images on the site
   * adds its references here (gallery today; offers, stories and banners in the next phases).
   */
  async refreshVisibility(tx: Tx, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await sql`
      update files f set is_private = not exists (
        select 1 from gallery_items g where g.is_published and (g.image_file_id = f.id or g.before_file_id = f.id))
      where f.id = any(${ids}::uuid[]) and f.kind = 'gallery'`.execute(tx);
  }

  /** Deletes the row unless something still points at it (the foreign keys decide); returns whether it went. */
  async deleteUnreferenced(tx: Tx, id: string): Promise<FileRow | undefined> {
    const row = await this.get(tx, id);
    if (!row) return undefined;
    // some references are ON DELETE SET NULL: the delete itself would not refuse, so file_in_use decides
    const { numDeletedRows } = await tx.deleteFrom('files').where('id', '=', id).where(sql<boolean>`not file_in_use(files.id)`)
      .executeTakeFirst();
    return numDeletedRows > 0n ? row : undefined;
  }
}
