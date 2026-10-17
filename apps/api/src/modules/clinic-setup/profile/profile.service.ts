import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../../shared/database/tenant-db.service';
import { Err } from '../../../shared/errors/app-error';
import { MediaService, type MediaView } from '../../media';
import { LiveSiteWrite } from '../../website/live-site';
import { ProfileRepository, type ProfilePatch } from './profile.repository';

type Row = NonNullable<Awaited<ReturnType<ProfileRepository['get']>>>;

const toDto = (r: Row, logo: MediaView | null) => ({
  slug: r.slug,
  status: r.status,
  nameAr: r.name_ar,
  nameEn: r.name_en,
  aboutAr: r.about_ar,
  aboutEn: r.about_en,
  primaryPhone: r.primary_phone,
  whatsapp: r.whatsapp,
  email: r.email,
  specialties: r.specialties,
  defaultLocale: r.default_locale,
  currency: r.currency,
  brandColor: r.brand_color,
  logo,
});
export type ClinicProfile = ReturnType<typeof toDto>;

/** Clinic profile (wizard step 1): what the website hero and footer show. */
@Injectable()
export class ProfileService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: ProfileRepository,
    private readonly site: LiveSiteWrite,
    private readonly media: MediaService,
  ) {}

  get(): Promise<ClinicProfile> {
    return this.db.run(async (tx) => {
      const row = await this.repo.get(tx);
      if (!row) throw Err.notFound('clinic_not_found', 'Clinic not found');
      return toDto(row, this.media.present(row.logo));
    });
  }

  /**
   * Profile fields, the logo and the brand colour change together or not at all. The name, contacts and logo are
   * on the website, so the save purges its cache; a replaced logo is deleted after the commit if nothing else uses it.
   */
  async update(patch: ProfilePatch & { brandColor?: string }): Promise<ClinicProfile> {
    const { brandColor, ...profile } = patch;
    let released: string | null = null;
    const { row, tenantId } = await this.site.run(async (tx, tenantId) => {
      const before = await this.repo.get(tx);
      if (!before) throw Err.notFound('clinic_not_found', 'Clinic not found');
      released = await this.media.replace(tx, 'logo', profile.logoFileId, before.logo_file_id);
      await this.repo.update(tx, profile);
      if (brandColor) await this.repo.setBrandColor(tx, brandColor.toLowerCase());
      return { row: (await this.repo.get(tx))!, tenantId };
    });
    if (released) await this.media.deleteIfUnused(tenantId, released);
    return toDto(row, this.media.present(row.logo));
  }
}
