import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../../shared/database/tenant-db.service';
import { Err } from '../../../shared/errors/app-error';
import { ProfileRepository, type ProfilePatch } from './profile.repository';

const toDto = (r: NonNullable<Awaited<ReturnType<ProfileRepository['get']>>>) => ({
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
  brandColor: r.brand_color,
});
export type ClinicProfile = ReturnType<typeof toDto>;

/** Clinic profile (wizard step 1): what the website hero and footer show. */
@Injectable()
export class ProfileService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: ProfileRepository,
  ) {}

  get(): Promise<ClinicProfile> {
    return this.db.run(async (tx) => {
      const row = await this.repo.get(tx);
      if (!row) throw Err.notFound('clinic_not_found', 'Clinic not found');
      return toDto(row);
    });
  }

  /** Profile fields and the brand colour change together or not at all. */
  update(patch: ProfilePatch & { brandColor?: string }): Promise<ClinicProfile> {
    const { brandColor, ...profile } = patch;
    return this.db.run(async (tx) => {
      await this.repo.update(tx, profile);
      if (brandColor) await this.repo.setBrandColor(tx, brandColor.toLowerCase());
      const row = await this.repo.get(tx);
      if (!row) throw Err.notFound('clinic_not_found', 'Clinic not found');
      return toDto(row);
    });
  }
}
