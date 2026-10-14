import { Injectable } from '@nestjs/common';
import { sql, type Json, type Tx } from '@dental/db';

export interface ProfilePatch {
  nameAr?: string | null;
  nameEn?: string | null;
  aboutAr?: string | null;
  aboutEn?: string | null;
  primaryPhone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  specialties?: string[];
  defaultLocale?: 'ar' | 'en';
}

/**
 * The clinic's own row (tenants has FORCE RLS: id = current clinic, so no WHERE is needed or trusted)
 * plus the draft theme colour on its site. The app role may only update the profile columns (column GRANTs).
 */
@Injectable()
export class ProfileRepository {
  get(tx: Tx) {
    return tx.selectFrom('tenants as t')
      .leftJoin('sites as s', 's.tenant_id', 't.id')
      .select([
        't.slug', 't.status', 't.name_ar', 't.name_en', 't.about_ar', 't.about_en', 't.primary_phone', 't.whatsapp', 't.email',
        't.specialties', 't.default_locale',
        sql<string | null>`s.draft_theme->>'primary'`.as('brand_color'),
      ])
      .executeTakeFirst();
  }

  async update(tx: Tx, p: ProfilePatch): Promise<void> {
    const set = {
      ...(p.nameAr !== undefined && { name_ar: p.nameAr }),
      ...(p.nameEn !== undefined && { name_en: p.nameEn }),
      ...(p.aboutAr !== undefined && { about_ar: p.aboutAr }),
      ...(p.aboutEn !== undefined && { about_en: p.aboutEn }),
      ...(p.primaryPhone !== undefined && { primary_phone: p.primaryPhone }),
      ...(p.whatsapp !== undefined && { whatsapp: p.whatsapp }),
      ...(p.email !== undefined && { email: p.email }),
      ...(p.specialties !== undefined && { specialties: p.specialties }),
      ...(p.defaultLocale !== undefined && { default_locale: p.defaultLocale }),
    };
    if (!Object.keys(set).length) return;
    await tx.updateTable('tenants').set({ ...set, updated_at: sql<Date>`now()` }).execute();
  }

  /** Merges the colour into the draft theme; the DB CHECK accepts only #rrggbb. */
  async setBrandColor(tx: Tx, color: string): Promise<void> {
    await tx.updateTable('sites')
      .set({ draft_theme: sql<Json>`draft_theme || jsonb_build_object('primary', ${color}::text)`, updated_at: sql<Date>`now()` })
      .execute();
  }
}
