import { sql, type Db } from '@dental/db';
import { renditionKey } from '../modules/media/media-urls';
import type { ObjectStorage } from '../shared/storage/ports';

/**
 * Nightly: website images uploaded but never attached (a form left without saving), or let go of and not deleted at
 * the time, older than a day. The rows go first (`purge_orphan_images`, in one statement); then their stored
 * renditions. A storage failure leaves objects with no row, which nothing can link to; it is logged, not retried.
 */
export async function purgeOrphanImages(db: Db, storage: ObjectStorage, log: (o: object) => void): Promise<number> {
  const { rows } = await sql<{ tenant_id: string; id: string; variant_widths: number[] }>`select * from purge_orphan_images()`.execute(db);
  for (const r of rows) {
    await storage.deleteMany(r.variant_widths.map((w) => renditionKey(r.tenant_id, r.id, w)))
      .catch((e) => log({ job: 'purge-orphan-images', file: r.id, error: (e as Error).message }));
  }
  return rows.length;
}
