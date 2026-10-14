import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';

/** The clinic's site row (RLS: one row, this clinic) and its hostnames. */
@Injectable()
export class WebsiteRepository {
  status(tx: Tx) {
    return tx.selectFrom('sites')
      .select([
        'status', 'published_version', 'published_at',
        sql<boolean>`published_theme is distinct from draft_theme`.as('pending_changes'),
      ])
      .executeTakeFirst();
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

  /** Every live hostname of the clinic: these are the website's cache tags. */
  async hostnames(tx: Tx): Promise<string[]> {
    const rows = await tx.selectFrom('domains').select('hostname').where('status', 'in', ['verified', 'active']).execute();
    return rows.map((r) => r.hostname);
  }
}
