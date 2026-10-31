import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';

export interface FaqRow {
  id: string; question_ar: string; answer_ar: string; question_en: string | null; answer_en: string | null; service_id: string | null;
  is_active: boolean; sort_order: number; updated_at: Date;
}
export interface FaqFields {
  question_ar?: string; answer_ar?: string; question_en?: string | null; answer_en?: string | null; service_id?: string | null; is_active?: boolean;
}

/** The clinic's questions (faqs); RLS scopes every query to the clinic. */
@Injectable()
export class FaqsRepository {
  list(tx: Tx): Promise<FaqRow[]> {
    return tx.selectFrom('faqs')
      .select(['id', 'question_ar', 'answer_ar', 'question_en', 'answer_en', 'service_id', 'is_active', 'sort_order', 'updated_at'])
      .orderBy('sort_order').orderBy('created_at').orderBy('id')
      .execute() as Promise<FaqRow[]>;
  }

  /** Serialises the changes to one clinic's questions (the limit and the positions): its site row, locked. */
  async lockClinic(tx: Tx): Promise<void> {
    await tx.selectFrom('sites').select('id').forUpdate().execute();
  }

  async count(tx: Tx): Promise<number> {
    const r = await tx.selectFrom('faqs').select(sql<number>`count(*)::int`.as('n')).executeTakeFirst();
    return r?.n ?? 0;
  }

  /** New questions go to the end. */
  create(tx: Tx, tenantId: string, f: Required<Pick<FaqFields, 'question_ar' | 'answer_ar'>> & FaqFields) {
    return tx.insertInto('faqs').values({
      tenant_id: tenantId, ...f, sort_order: sql<number>`coalesce((select max(sort_order) + 1 from faqs), 0)`,
    }).returning('id').executeTakeFirstOrThrow();
  }

  async update(tx: Tx, id: string, f: FaqFields): Promise<boolean> {
    if (!Object.keys(f).length) return !!(await tx.selectFrom('faqs').select('id').where('id', '=', id).executeTakeFirst());
    return !!(await tx.updateTable('faqs').set(f).where('id', '=', id).returning('id').executeTakeFirst());
  }

  async remove(tx: Tx, id: string): Promise<boolean> {
    return !!(await tx.deleteFrom('faqs').where('id', '=', id).returning('id').executeTakeFirst());
  }

  /** Every question's id, locked, to check a full reorder. */
  async lockedIds(tx: Tx): Promise<string[]> {
    return (await tx.selectFrom('faqs').select('id').forUpdate().execute()).map((r) => r.id);
  }

  async reorder(tx: Tx, ids: string[]): Promise<void> {
    await sql`update faqs f set sort_order = o.pos - 1 from unnest(${ids}::uuid[]) with ordinality as o(id, pos) where f.id = o.id`.execute(tx);
  }

  async serviceExists(tx: Tx, id: string): Promise<boolean> {
    return !!(await tx.selectFrom('services').select('id').where('id', '=', id).executeTakeFirst());
  }
}
