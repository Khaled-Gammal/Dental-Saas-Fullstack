import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';
import { imageJson } from '../media';

export interface NewBranch {
  nameEn?: string;
  nameAr?: string;
  slug: string;
  city?: string;
  phone?: string;
}

export interface BranchPatch {
  nameEn?: string | null;
  nameAr?: string | null;
  addressEn?: string | null;
  addressAr?: string | null;
  city?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  isActive?: boolean;
  photoFileId?: string | null;
}

export interface HoursRow { weekday: number; opens_at: string; closes_at: string }

const columns = ['id', 'name_en', 'name_ar', 'slug', 'address_en', 'address_ar', 'city', 'phone', 'whatsapp', 'is_main', 'is_active'] as const;
const photo = imageJson('branches.photo_file_id');
/** Hours as a JSON array on each branch row: one query for the list, no N+1. */
const hoursJson = sql<HoursRow[]>`coalesce((
  select json_agg(json_build_object('weekday', h.weekday, 'opens_at', to_char(h.opens_at, 'HH24:MI'), 'closes_at', to_char(h.closes_at, 'HH24:MI'))
                  order by h.weekday, h.opens_at)
  from branch_hours h where h.branch_id = branches.id), '[]'::json)`;

/** Plain Kysely queries. RLS adds "WHERE tenant_id = current clinic" to every one of them. */
@Injectable()
export class BranchesRepository {
  /** Active branches count against the plan; a deactivated branch frees its seat. */
  async countActive(tx: Tx): Promise<number> {
    const row = await tx.selectFrom('branches').select(({ fn }) => fn.countAll<number>().as('n')).where('is_active', '=', true).executeTakeFirstOrThrow();
    return Number(row.n);
  }

  list(tx: Tx) {
    return tx.selectFrom('branches')
      .select([...columns, photo.as('photo'), hoursJson.as('hours')])
      .orderBy('is_main', 'desc').orderBy('sort_order').orderBy('name_en')
      .execute();
  }

  get(tx: Tx, id: string) {
    return tx.selectFrom('branches').select([...columns, photo.as('photo'), hoursJson.as('hours')]).where('id', '=', id).executeTakeFirst();
  }

  /**
   * Locks the branch row until the transaction ends; false if it doesn't exist (in this clinic).
   * Two saves of the same week then run one after the other instead of mixing their rows.
   */
  async lock(tx: Tx, id: string): Promise<{ is_active: boolean; photo_file_id: string | null } | undefined> {
    return tx.selectFrom('branches').select(['is_active', 'photo_file_id']).where('id', '=', id).forUpdate().executeTakeFirst();
  }

  /** Locks every branch of the clinic: two "make main" requests at once then can't both clear-and-set. */
  async lockAll(tx: Tx): Promise<void> {
    await tx.selectFrom('branches').select('id').forUpdate().execute();
  }

  create(tx: Tx, tenantId: string, b: NewBranch) {
    return tx.insertInto('branches')
      .values({ tenant_id: tenantId, name_en: b.nameEn ?? null, name_ar: b.nameAr ?? null, slug: b.slug, city: b.city ?? null, phone: b.phone ?? null })
      .returning(['id', 'name_en', 'name_ar', 'slug'])
      .executeTakeFirstOrThrow();
  }

  /** Updates only the fields present in the patch. Returns false when no branch has this id (in this clinic). */
  async update(tx: Tx, id: string, p: BranchPatch): Promise<boolean> {
    const set = {
      ...(p.nameEn !== undefined && { name_en: p.nameEn }),
      ...(p.nameAr !== undefined && { name_ar: p.nameAr }),
      ...(p.addressEn !== undefined && { address_en: p.addressEn }),
      ...(p.addressAr !== undefined && { address_ar: p.addressAr }),
      ...(p.city !== undefined && { city: p.city }),
      ...(p.phone !== undefined && { phone: p.phone }),
      ...(p.whatsapp !== undefined && { whatsapp: p.whatsapp }),
      ...(p.isActive !== undefined && { is_active: p.isActive }),
      ...(p.photoFileId !== undefined && { photo_file_id: p.photoFileId }),
    };
    const row = await tx.updateTable('branches').set({ ...set, updated_at: sql<Date>`now()` })
      .where('id', '=', id).returning('id').executeTakeFirst();
    return !!row;
  }

  /** Two statements, one transaction (the caller's): the partial unique index allows only one main branch. */
  async makeMain(tx: Tx, id: string): Promise<void> {
    await tx.updateTable('branches').set({ is_main: false }).where('is_main', '=', true).where('id', '<>', id).execute();
    await tx.updateTable('branches').set({ is_main: true, is_active: true }).where('id', '=', id).execute();
  }

  /** Replaces the whole week: delete + insert in the caller's transaction, so a failed save changes nothing. */
  async replaceHours(tx: Tx, tenantId: string, branchId: string, rows: HoursRow[]): Promise<void> {
    await tx.deleteFrom('branch_hours').where('branch_id', '=', branchId).execute();
    if (rows.length) {
      await tx.insertInto('branch_hours')
        .values(rows.map((r) => ({ tenant_id: tenantId, branch_id: branchId, weekday: r.weekday, opens_at: r.opens_at, closes_at: r.closes_at })))
        .execute();
    }
  }
}
