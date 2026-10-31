import { Injectable } from '@nestjs/common';
import { sql, type Json, type Tx } from '@dental/db';

/** The clinic's site row (RLS: one row, this clinic) and its hostnames. */
@Injectable()
export class WebsiteRepository {
  status(tx: Tx) {
    return tx.selectFrom('sites as s')
      .leftJoin('files as f', 'f.id', 's.share_file_id')
      .select([
        's.status', 's.published_version', 's.published_at', 's.show_powered_by', 's.sections', 's.seo_title', 's.seo_description', 's.share_file_id',
        'f.width as share_width', 'f.height as share_height', 'f.variant_widths as share_widths',
        sql<boolean>`s.published_theme is distinct from s.draft_theme`.as('pending_changes'),
        // Phase 2C-3: the site's address, for the search-result preview (the primary hostname, else any live one)
        sql<string | null>`(select d.hostname::text from domains d where d.status in ('verified', 'active') order by d.is_primary desc, d.created_at limit 1)`.as('hostname'),
      ])
      .executeTakeFirst();
  }

  /** Phase 2C-3: the search title and description and the share image (live at once); returns the share image it replaced. */
  async setSeo(tx: Tx, seo: { seo_title?: string | null; seo_description?: string | null; share_file_id?: string | null }) {
    const cur = await tx.selectFrom('sites').select(['id', 'share_file_id']).forUpdate().executeTakeFirst();
    if (!cur) return null;
    if (Object.keys(seo).length) await tx.updateTable('sites').set({ ...seo, updated_at: sql<Date>`now()` }).where('id', '=', cur.id).execute();
    return { previousShare: cur.share_file_id };
  }

  /** draft -> published in one statement; returns the new version. */
  publish(tx: Tx) {
    return tx.updateTable('sites')
      .set({
        published_theme: sql`draft_theme`,
        status: 'published',
        published_version: sql<number>`published_version + 1`,
        published_at: sql<Date>`now()`,
        updated_at: sql<Date>`now()`,
      })
      .returning(['published_version'])
      .executeTakeFirst();
  }

  /** Phase 1D (WEB-10): the clinic's choice for the platform badge (the website shows it anyway on a plan without remove_badge). */
  setPoweredBy(tx: Tx, show: boolean) {
    return tx.updateTable('sites').set({ show_powered_by: show, updated_at: sql<Date>`now()` }).returning(['id']).executeTakeFirst();
  }

  /** Phase 2C-1: the order and visibility of the website's sections (applies to the live site at once). */
  setSections(tx: Tx, sections: unknown[]) {
    return tx.updateTable('sites').set({ sections: sql<Json>`${JSON.stringify(sections)}::jsonb`, updated_at: sql<Date>`now()` }).returning(['id']).executeTakeFirst();
  }

  /** Every live hostname of the clinic: these are the website's cache tags. */
  async hostnames(tx: Tx): Promise<string[]> {
    const rows = await tx.selectFrom('domains').select('hostname').where('status', 'in', ['verified', 'active']).execute();
    return rows.map((r) => r.hostname);
  }
}
