import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';
import { TenantDb } from '../../shared/database/tenant-db.service';

/** An image on the site: id, original size (aspect ratio) and the WebP widths that exist; served by /public/media. */
const img = (col: string) => sql`(select json_build_object('id', f.id, 'width', f.width, 'height', f.height, 'widths', f.variant_widths)
  from files f where f.id = ${sql.raw(col)})`;

export interface SitePayload {
  clinic: { id: string; slug: string; name_en: string | null; name_ar: string | null; about_en: string | null; about_ar: string | null;
    primary_phone: string | null; whatsapp: string | null; specialties: string[]; default_locale: string; timezone: string; currency: string;
    logo: { id: string; width: number; height: number; widths: number[] } | null } | null;
  [key: string]: unknown;
}

/** Everything a clinic website shows, in ONE query. Runs inside the clinic's context (TenantDb.runForHost). */
@Injectable()
export class PublicSiteRepository {
  constructor(private readonly db: TenantDb) {}

  /** null when no clinic owns the hostname (or it is suspended / its domain unverified). */
  loadForHost(hostname: string): Promise<SitePayload | null> {
    return this.db.runForHost(hostname, async (tx) => this.load(tx));
  }

  private async load(tx: Tx): Promise<SitePayload | null> {
    // RLS limits every subquery to this clinic; JSON keeps bigint prices as numbers.
    // Only fields a visitor may see: no fees/commissions, no member ids, no private files.
    const { rows: site } = await sql<{ site: SitePayload }>`
        select json_build_object(
          'clinic', (select json_build_object('id', t.id, 'slug', t.slug, 'name_en', t.name_en, 'name_ar', t.name_ar,
                       'about_en', t.about_en, 'about_ar', t.about_ar, 'primary_phone', t.primary_phone, 'whatsapp', t.whatsapp,
                       'specialties', t.specialties, 'default_locale', t.default_locale, 'timezone', t.timezone, 'currency', t.currency,
                       'logo', ${img('t.logo_file_id')}) from tenants t),
          'theme', coalesce((select case when s.status = 'published' then s.published_theme else s.draft_theme end from sites s), '{}'::jsonb),
          'showPoweredBy', coalesce((select s.show_powered_by from sites s), true),
          'onlineBooking', exists (select 1 from services s where s.bookable_online and s.is_active and s.show_on_website)
                           and exists (select 1 from doctors d join doctor_branches db on db.doctor_id = d.id join branches b on b.id = db.branch_id
                                       where d.is_active and d.accepts_online_booking and b.is_active),
          'branches', coalesce((
            select json_agg(json_build_object('id', b.id, 'name_en', b.name_en, 'name_ar', b.name_ar, 'address_en', b.address_en,
                     'address_ar', b.address_ar, 'city', b.city, 'phone', b.phone, 'whatsapp', b.whatsapp, 'timezone', b.timezone,
                     'latitude', b.latitude, 'longitude', b.longitude, 'is_main', b.is_main, 'photo', ${img('b.photo_file_id')},
                     'hours', coalesce((select json_agg(json_build_object('weekday', h.weekday, 'opens_at', h.opens_at, 'closes_at', h.closes_at)
                                         order by h.weekday, h.opens_at)
                                        from branch_hours h where h.branch_id = b.id), '[]'::json))
                   order by b.is_main desc, b.sort_order, b.name_en)
            from branches b where b.is_active), '[]'::json),
          'holidays', coalesce((
            select json_agg(json_build_object('date', h.date, 'branch_id', h.branch_id, 'name', h.name) order by h.date)
            from holidays h where h.date between current_date - 1 and current_date + 14), '[]'::json),
          'services', coalesce((
            select json_agg(json_build_object('id', s.id, 'name_en', s.name_en, 'name_ar', s.name_ar,
                     'description_en', s.description_en, 'description_ar', s.description_ar,
                     'category', (select c.category from service_catalog c where c.code = s.catalog_code),
                     'price_minor', s.price_minor, 'price_max_minor', s.price_max_minor, 'duration_minutes', s.duration_minutes,
                     'image', ${img('s.image_file_id')})
                   order by s.sort_order, s.name_en)
            from services s where s.show_on_website and s.is_active), '[]'::json),
          'doctors', coalesce((
            select json_agg(json_build_object('id', d.id, 'name_en', d.name_en, 'name_ar', d.name_ar, 'title_en', d.title_en,
                     'title_ar', d.title_ar, 'bio_en', d.bio_en, 'bio_ar', d.bio_ar, 'specialties', d.specialties,
                     'photo', ${img('d.photo_file_id')}) order by d.sort_order, d.name_en)
            from doctors d where d.show_on_website and d.is_active), '[]'::json)
        ) as site`.execute(tx);
    return site[0]?.site ?? null;
  }
}
