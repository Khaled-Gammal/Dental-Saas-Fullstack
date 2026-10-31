import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';

export interface CaseRow {
  id: string; service_id: string | null; service_name: string | null; caption_ar: string | null; alt_ar: string | null; is_published: boolean;
  consent_confirmed: boolean; consent_confirmed_at: Date | null; consent_confirmed_by_name: string | null; sort_order: number; updated_at: Date;
  after_id: string; after_width: number | null; after_height: number | null; after_widths: number[];
  before_id: string; before_width: number | null; before_height: number | null; before_widths: number[];
}
export interface CaseFields {
  image_file_id?: string; before_file_id?: string; service_id?: string | null; caption_ar?: string | null; alt_ar?: string | null;
  consent_confirmed?: boolean; is_published?: boolean;
}

/** Before/after cases (gallery_items of type 'before_after', clinic-wide). RLS scopes every query to the clinic. */
@Injectable()
export class CasesRepository {
  private rows(tx: Tx, id?: string) {
    return sql<CaseRow>`
      select g.id, g.service_id, coalesce(s.name_ar, s.name_en) as service_name, g.caption_ar, g.alt_ar, g.is_published, g.consent_confirmed,
             g.consent_confirmed_at, u.full_name as consent_confirmed_by_name, g.sort_order, g.updated_at,
             fa.id as after_id, fa.width as after_width, fa.height as after_height, fa.variant_widths as after_widths,
             fb.id as before_id, fb.width as before_width, fb.height as before_height, fb.variant_widths as before_widths
        from gallery_items g
        join files fa on fa.id = g.image_file_id
        join files fb on fb.id = g.before_file_id
        left join services s on s.id = g.service_id
        left join tenant_members m on m.id = g.consent_confirmed_by left join users u on u.id = m.user_id
       where g.type = 'before_after' and (${id ?? null}::uuid is null or g.id = ${id ?? null}::uuid)
       order by g.sort_order, g.id
       limit 200`.execute(tx);
  }

  async list(tx: Tx): Promise<CaseRow[]> { return (await this.rows(tx)).rows; }
  async get(tx: Tx, id: string): Promise<CaseRow | undefined> { return (await this.rows(tx, id)).rows[0]; }

  /** The clinic's site row, locked: one change to the cases at a time (the limit and the positions). */
  async lockClinic(tx: Tx): Promise<void> { await tx.selectFrom('sites').select('id').forUpdate().execute(); }

  async count(tx: Tx): Promise<number> {
    const r = await tx.selectFrom('gallery_items').select(sql<number>`count(*)::int`.as('n')).where('type', '=', 'before_after').executeTakeFirst();
    return r?.n ?? 0;
  }

  lock(tx: Tx, id: string) {
    return tx.selectFrom('gallery_items')
      .select(['id', 'image_file_id', 'before_file_id', 'caption_ar', 'alt_ar', 'consent_confirmed', 'is_published'])
      .where('id', '=', id).where('type', '=', 'before_after').forUpdate().executeTakeFirst();
  }

  create(tx: Tx, tenantId: string, f: CaseFields & { image_file_id: string; before_file_id: string }) {
    return tx.insertInto('gallery_items').values({
      tenant_id: tenantId, type: 'before_after', ...f,
      sort_order: sql<number>`coalesce((select max(sort_order) + 1 from gallery_items where type = 'before_after'), 0)`,
    }).returning('id').executeTakeFirstOrThrow();
  }

  async update(tx: Tx, id: string, f: CaseFields): Promise<void> {
    if (Object.keys(f).length) await tx.updateTable('gallery_items').set(f).where('id', '=', id).execute();
  }

  remove(tx: Tx, id: string) {
    return tx.deleteFrom('gallery_items').where('id', '=', id).where('type', '=', 'before_after')
      .returning(['image_file_id', 'before_file_id']).executeTakeFirst();
  }

  async ids(tx: Tx): Promise<string[]> {
    return (await tx.selectFrom('gallery_items').select('id').where('type', '=', 'before_after').execute()).map((r) => r.id);
  }

  async reorder(tx: Tx, ids: string[]): Promise<void> {
    await sql`update gallery_items g set sort_order = o.pos - 1 from unnest(${ids}::uuid[]) with ordinality as o(id, pos) where g.id = o.id`.execute(tx);
  }

  async serviceExists(tx: Tx, id: string): Promise<boolean> {
    return !!(await tx.selectFrom('services').select('id').where('id', '=', id).executeTakeFirst());
  }
}
