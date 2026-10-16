import { sql, type RawBuilder } from '@dental/db';

/** An image as other modules embed it in their rows: enough for an aspect ratio and a srcset, no links yet. */
export interface StoredImage { id: string; width: number; height: number; widths: number[] }

/**
 * The image behind a `*_file_id` column as JSON (or null), for a select list: `imageJson('d.photo_file_id').as('photo')`.
 * One correlated lookup by primary key; RLS limits it to the clinic in context.
 */
export function imageJson(column: string): RawBuilder<StoredImage | null> {
  return sql<StoredImage | null>`(select json_build_object('id', f.id, 'width', f.width, 'height', f.height, 'widths', f.variant_widths)
    from files f where f.id = ${sql.ref(column)})`;
}
