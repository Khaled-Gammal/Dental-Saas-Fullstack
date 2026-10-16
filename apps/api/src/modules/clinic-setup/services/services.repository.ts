import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';
import { imageJson } from '../../media';

export interface ServiceInput {
  nameAr?: string | null;
  nameEn?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  catalogCode?: string | null;
  priceMinor?: number;
  priceMaxMinor?: number | null;
  durationMinutes?: number;
  bookableOnline?: boolean;
  showOnWebsite?: boolean;
  isActive?: boolean;
  imageFileId?: string | null;
}

const plain = ['id', 'catalog_code', 'name_ar', 'name_en', 'description_ar', 'description_en', 'duration_minutes', 'bookable_online', 'show_on_website', 'is_active', 'sort_order'] as const;
// bigint prices come back from pg as strings; cast to int so JSON carries numbers (prices here never exceed 2^31 piastres)
const columns = () => [...plain, sql<number>`price_minor::int`.as('price_minor'), sql<number | null>`price_max_minor::int`.as('price_max_minor'),
  imageJson('services.image_file_id').as('image')];

@Injectable()
export class ServicesRepository {
  list(tx: Tx) {
    return tx.selectFrom('services').select(columns()).orderBy('sort_order').orderBy('name_en').execute();
  }

  get(tx: Tx, id: string) {
    return tx.selectFrom('services').select(columns()).where('id', '=', id).executeTakeFirst();
  }

  /** Locks the row for the rest of the transaction and returns what cross-field rules need (null = not this clinic's). */
  lock(tx: Tx, id: string) {
    return tx.selectFrom('services').select(['name_ar', 'name_en', 'image_file_id', sql<number>`price_minor::int`.as('price_minor'), sql<number | null>`price_max_minor::int`.as('price_max_minor')])
      .where('id', '=', id).forUpdate().executeTakeFirst();
  }

  /** The platform's dental catalogue (shared, read-only for clinics). */
  catalog(tx: Tx) {
    return tx.selectFrom('service_catalog').select(['code', 'category', 'name_en', 'name_ar', 'default_duration_minutes'])
      .orderBy('sort_order').execute();
  }

  catalogEntry(tx: Tx, code: string) {
    return tx.selectFrom('service_catalog').select(['code', 'name_en', 'name_ar', 'default_duration_minutes']).where('code', '=', code).executeTakeFirst();
  }

  create(tx: Tx, tenantId: string, s: Required<Pick<ServiceInput, 'durationMinutes'>> & ServiceInput) {
    return tx.insertInto('services')
      .values({
        tenant_id: tenantId, catalog_code: s.catalogCode ?? null, name_ar: s.nameAr ?? null, name_en: s.nameEn ?? null,
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
    const row = await tx.updateTable('services').set({ ...set, updated_at: sql<Date>`now()` }).where('id', '=', id).returning('id').executeTakeFirst();
    return !!row;
  }
}
