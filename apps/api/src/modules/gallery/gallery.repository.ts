import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';

const ZERO = '00000000-0000-0000-0000-000000000000';

export interface GalleryRow {
  id: string; branch_id: string | null; caption_ar: string | null; caption_en: string | null; alt_ar: string | null; alt_en: string | null;
  is_published: boolean; is_featured: boolean; sort_order: number; created_at: Date; updated_at: Date;
  file_id: string; width: number | null; height: number | null; variant_widths: number[];
}

export interface GalleryFields {
  branch_id?: string | null; caption_ar?: string | null; caption_en?: string | null; alt_ar?: string | null; alt_en?: string | null;
  is_published?: boolean; is_featured?: boolean;
}

/** gallery_items rows (photos only; before/after cases belong to the success-stories module). RLS scopes every query. */
@Injectable()
export class GalleryRepository {
  private select(tx: Tx) {
    return tx.selectFrom('gallery_items as g').innerJoin('files as f', 'f.id', 'g.image_file_id')
      .select(['g.id', 'g.branch_id', 'g.caption_ar', 'g.caption_en', 'g.alt_ar', 'g.alt_en', 'g.is_published', 'g.is_featured', 'g.sort_order',
        'g.created_at', 'g.updated_at', 'f.id as file_id', 'f.width', 'f.height', 'f.variant_widths'])
      .where('g.type', '=', 'photo');
  }

  /** Display order within a scope; `after` continues a page (sort_order, id). */
  list(tx: Tx, q: { scope: 'all' | 'clinic' | string; status: 'all' | 'published' | 'draft'; q?: string; after?: { sort: number; id: string } | null; limit: number }) {
    let query = this.select(tx);
    if (q.scope === 'clinic') query = query.where('g.branch_id', 'is', null);
    else if (q.scope !== 'all') query = query.where('g.branch_id', '=', q.scope);
    if (q.status !== 'all') query = query.where('g.is_published', '=', q.status === 'published');
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      query = query.where((eb) => eb.or(['g.caption_ar', 'g.caption_en', 'g.alt_ar', 'g.alt_en'].map((c) => eb(c as 'g.caption_ar', 'ilike', like))));
    }
    if (q.after) query = query.where(sql<boolean>`(g.sort_order, g.id) > (${q.after.sort}, ${q.after.id})`);
    return query.orderBy('g.sort_order').orderBy('g.id').limit(q.limit).execute();
  }

  get(tx: Tx, id: string): Promise<GalleryRow | undefined> {
    return this.select(tx).where('g.id', '=', id).executeTakeFirst();
  }

  lock(tx: Tx, id: string) {
    return tx.selectFrom('gallery_items').select(['id', 'branch_id', 'image_file_id', 'is_published', 'is_featured', 'alt_ar', 'alt_en', 'caption_ar', 'caption_en'])
      .where('id', '=', id).where('type', '=', 'photo').forUpdate().executeTakeFirst();
  }

  async create(tx: Tx, tenantId: string, fileId: string, f: GalleryFields): Promise<{ id: string }> {
    const scope = f.branch_id ?? null;
    return tx.insertInto('gallery_items').values({
      tenant_id: tenantId, type: 'photo', image_file_id: fileId, ...f,
      // new photos go to the end of their scope
      sort_order: sql<number>`coalesce((select max(sort_order) + 1 from gallery_items where branch_id is not distinct from ${scope}::uuid), 0)`,
    }).returning('id').executeTakeFirstOrThrow();
  }

  async update(tx: Tx, id: string, f: GalleryFields): Promise<void> {
    if (!Object.keys(f).length) return;
    await tx.updateTable('gallery_items').set(f).where('id', '=', id).execute();
  }

  /** One featured photo per scope: clear the others before setting a new one (the unique index is the last guard). */
  async unfeatureOthers(tx: Tx, scope: string | null, exceptId: string | null): Promise<void> {
    let q = tx.updateTable('gallery_items').set({ is_featured: false }).where('is_featured', '=', true)
      .where(sql<boolean>`coalesce(branch_id, ${ZERO}::uuid) = coalesce(${scope}::uuid, ${ZERO}::uuid)`);
    if (exceptId) q = q.where('id', '<>', exceptId);
    await q.execute();
  }

  /** Ids of the photos in a scope, locked, to validate a full reorder. */
  async scopeIds(tx: Tx, scope: string | null): Promise<string[]> {
    const rows = await tx.selectFrom('gallery_items').select('id').where('type', '=', 'photo')
      .where(sql<boolean>`branch_id is not distinct from ${scope}::uuid`).forUpdate().execute();
    return rows.map((r) => r.id);
  }

  async reorder(tx: Tx, ids: string[]): Promise<void> {
    await sql`
      update gallery_items g set sort_order = o.pos - 1
      from unnest(${ids}::uuid[]) with ordinality as o(id, pos)
      where g.id = o.id`.execute(tx);
  }

  async remove(tx: Tx, id: string): Promise<{ image_file_id: string } | undefined> {
    return tx.deleteFrom('gallery_items').where('id', '=', id).where('type', '=', 'photo').returning('image_file_id').executeTakeFirst();
  }

  async branchExists(tx: Tx, id: string): Promise<boolean> {
    return !!(await tx.selectFrom('branches').select('id').where('id', '=', id).executeTakeFirst());
  }

  /** Published photos for a website, featured first within each scope. */
  publicList(tx: Tx, scope: 'all' | 'clinic' | string) {
    let q = tx.selectFrom('gallery_items as g').innerJoin('files as f', 'f.id', 'g.image_file_id')
      .leftJoin('branches as b', 'b.id', 'g.branch_id')
      .select(['g.id', 'g.branch_id', 'g.caption_ar', 'g.caption_en', 'g.alt_ar', 'g.alt_en', 'g.is_featured', 'f.id as file_id', 'f.width', 'f.height', 'f.variant_widths'])
      .where('g.type', '=', 'photo').where('g.is_published', '=', true).where('f.is_private', '=', false)
      .where((eb) => eb.or([eb('g.branch_id', 'is', null), eb('b.is_active', '=', true)])); // photos of a closed branch leave the site with it
    if (scope === 'clinic') q = q.where('g.branch_id', 'is', null);
    else if (scope !== 'all') q = q.where('g.branch_id', '=', scope);
    return q.orderBy('g.is_featured', 'desc').orderBy('g.sort_order').orderBy('g.id').limit(500).execute();
  }
}
