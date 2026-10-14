import { Injectable } from '@nestjs/common';
import type { Tx } from '@dental/db';

export interface NewBranch {
  nameEn?: string;
  nameAr?: string;
  slug: string;
  city?: string;
  phone?: string;
}

/** Plain Kysely queries. RLS adds "WHERE tenant_id = current clinic" to every one of them. */
@Injectable()
export class BranchesRepository {
  list(tx: Tx) {
    return tx
      .selectFrom('branches')
      .select(['id', 'name_en', 'name_ar', 'slug', 'city', 'phone', 'is_main', 'is_active'])
      .orderBy('sort_order')
      .orderBy('name_en')
      .execute();
  }

  create(tx: Tx, tenantId: string, b: NewBranch) {
    return tx
      .insertInto('branches')
      .values({ tenant_id: tenantId, name_en: b.nameEn ?? null, name_ar: b.nameAr ?? null, slug: b.slug, city: b.city ?? null, phone: b.phone ?? null })
      .returning(['id', 'name_en', 'name_ar', 'slug'])
      .executeTakeFirstOrThrow();
  }
}
