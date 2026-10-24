import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';
import { imageJson } from '../../media';

export interface ServiceInput {
  nameAr?: string | null;
  nameEn?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  priceMinor?: number;
  priceMaxMinor?: number | null;
  durationMinutes?: number;
  bookableOnline?: boolean;
  showOnWebsite?: boolean;
  isActive?: boolean;
  imageFileId?: string | null;
  /** the doctors who perform it; undefined = unchanged (on create: every active doctor) */
  doctorIds?: string[];
}

const plain = ['id', 'catalog_code', 'name_ar', 'name_en', 'description_ar', 'description_en', 'duration_minutes', 'bookable_online', 'show_on_website', 'is_active', 'sort_order'] as const;
// bigint prices come back from pg as strings; cast to int so JSON carries numbers (prices here never exceed 2^31 piastres)
const columns = () => [...plain, sql<number>`price_minor::int`.as('price_minor'), sql<number | null>`price_max_minor::int`.as('price_max_minor'),
  imageJson('services.image_file_id').as('image'),
  sql<string[]>`coalesce((select json_agg(ds.doctor_id) from doctor_services ds where ds.service_id = services.id), '[]'::json)`.as('doctor_ids')];

/** Everything that keeps a service as history: once used, a delete only hides it. */
const USED_BY = ['appointments', 'treatment_plan_items', 'visit_procedures', 'waitlist_entries', 'invoice_items'] as const;

@Injectable()
export class ServicesRepository {
  /** The price list: deleted services are gone from it (history reads them by id). */
  list(tx: Tx) {
    return tx.selectFrom('services').select(columns()).where('deleted_at', 'is', null).orderBy('sort_order').orderBy('name_en').execute();
  }

  get(tx: Tx, id: string) {
    return tx.selectFrom('services').select(columns()).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
  }

  /** Locks the row for the rest of the transaction and returns what cross-field rules need (null = not this clinic's, or deleted). */
  lock(tx: Tx, id: string) {
    return tx.selectFrom('services').select(['name_ar', 'name_en', 'image_file_id', sql<number>`price_minor::int`.as('price_minor'), sql<number | null>`price_max_minor::int`.as('price_max_minor')])
      .where('id', '=', id).where('deleted_at', 'is', null).forUpdate().executeTakeFirst();
  }

  /** How many of these ids are this clinic's doctors (row-level security hides the others). */
  async countDoctors(tx: Tx, ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const r = await tx.selectFrom('doctors').select((eb) => eb.fn.countAll<string>().as('n')).where('id', 'in', ids).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async activeDoctorIds(tx: Tx): Promise<string[]> {
    return (await tx.selectFrom('doctors').select('id').where('is_active', '=', true).execute()).map((d) => d.id);
  }

  /** Replaces who performs the service. */
  async setDoctors(tx: Tx, tenantId: string, serviceId: string, doctorIds: string[]): Promise<void> {
    let del = tx.deleteFrom('doctor_services').where('service_id', '=', serviceId);
    if (doctorIds.length) del = del.where('doctor_id', 'not in', doctorIds);
    await del.execute();
    if (doctorIds.length) {
      await tx.insertInto('doctor_services').values(doctorIds.map((doctorId) => ({ tenant_id: tenantId, doctor_id: doctorId, service_id: serviceId })))
        .onConflict((oc) => oc.columns(['doctor_id', 'service_id']).doNothing()).execute();
    }
  }

  create(tx: Tx, tenantId: string, s: Required<Pick<ServiceInput, 'durationMinutes'>> & ServiceInput) {
    return tx.insertInto('services')
      .values({
        tenant_id: tenantId, name_ar: s.nameAr ?? null, name_en: s.nameEn ?? null,
        description_ar: s.descriptionAr ?? null, description_en: s.descriptionEn ?? null,
        price_minor: s.priceMinor ?? 0, price_max_minor: s.priceMaxMinor ?? null, duration_minutes: s.durationMinutes,
        bookable_online: s.bookableOnline ?? true, show_on_website: s.showOnWebsite ?? true, image_file_id: s.imageFileId ?? null,
      })
      .returning('id').executeTakeFirstOrThrow();
  }

  async update(tx: Tx, id: string, s: ServiceInput): Promise<boolean> {
    const set = {
      ...(s.nameAr !== undefined && { name_ar: s.nameAr }),
      ...(s.nameEn !== undefined && { name_en: s.nameEn }),
      ...(s.descriptionAr !== undefined && { description_ar: s.descriptionAr }),
      ...(s.descriptionEn !== undefined && { description_en: s.descriptionEn }),
      ...(s.priceMinor !== undefined && { price_minor: s.priceMinor }),
      ...(s.priceMaxMinor !== undefined && { price_max_minor: s.priceMaxMinor }),
      ...(s.durationMinutes !== undefined && { duration_minutes: s.durationMinutes }),
      ...(s.bookableOnline !== undefined && { bookable_online: s.bookableOnline }),
      ...(s.showOnWebsite !== undefined && { show_on_website: s.showOnWebsite }),
      ...(s.isActive !== undefined && { is_active: s.isActive }),
      ...(s.imageFileId !== undefined && { image_file_id: s.imageFileId }),
    };
    const row = await tx.updateTable('services').set({ ...set, updated_at: sql<Date>`now()` })
      .where('id', '=', id).where('deleted_at', 'is', null).returning('id').executeTakeFirst();
    return !!row;
  }

  /** Whether any appointment, plan, visit, waitlist entry or invoice line points at the service. */
  async used(tx: Tx, id: string): Promise<boolean> {
    for (const table of USED_BY) {
      if (await tx.selectFrom(table).select(sql<number>`1`.as('x')).where('service_id', '=', id).limit(1).executeTakeFirst()) return true;
    }
    return false;
  }

  /** Never used: the row goes (its doctor links cascade; FAQs and gallery items keep themselves, without the link). */
  async delete(tx: Tx, id: string): Promise<void> {
    await tx.deleteFrom('services').where('id', '=', id).execute();
  }

  /** Used: hidden everywhere and kept, so history still shows its name. The doctor links go: nobody can book it. */
  async markDeleted(tx: Tx, id: string): Promise<void> {
    await tx.updateTable('services')
      .set({ deleted_at: sql<Date>`now()`, is_active: false, show_on_website: false, bookable_online: false, updated_at: sql<Date>`now()` })
      .where('id', '=', id).execute();
    await tx.deleteFrom('doctor_services').where('service_id', '=', id).execute();
  }
}
