import { Injectable } from '@nestjs/common';
import type { Tx } from '@dental/db';
import { TenantDb } from '../../../shared/database/tenant-db.service';
import { Err } from '../../../shared/errors/app-error';
import { MediaService, type StoredImage } from '../../media';
import { LiveSiteWrite } from '../../website/live-site';
import { ServicesRepository, type ServiceInput } from './services.repository';

const notFound = () => Err.notFound('service_not_found', 'Service not found');

/**
 * The clinic's price list (wizard step 4). Every clinic types its own services (owner 2026-10-21: no ready-made list)
 * and can delete them. Prices are in piastres (minor units); the UI shows pounds.
 */
@Injectable()
export class ServicesService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: ServicesRepository,
    private readonly site: LiveSiteWrite,
    private readonly media: MediaService,
  ) {}

  /** The image goes out with short-lived signed links (it may not be public yet). */
  private present<T extends { image: StoredImage | null }>(s: T) {
    return { ...s, image: this.media.present(s.image) };
  }

  /** H9: a treatment can only need a consent text the clinic has (and has not archived). */
  private async assertConsent(tx: Tx, key: string | null | undefined): Promise<void> {
    if (key && !(await this.repo.consentExists(tx, key))) throw Err.badRequest('consent_not_found', 'No such consent text');
  }

  /** Every id must be one of this clinic's doctors. */
  private async assertDoctors(tx: Tx, ids: string[] | undefined): Promise<void> {
    if (ids?.length && (await this.repo.countDoctors(tx, ids)) !== ids.length) throw Err.badRequest('doctor_not_found', 'Doctor not found');
  }

  async list() {
    return (await this.db.run((tx) => this.repo.list(tx))).map((s) => this.present(s));
  }

  /** Adds a service. Without `doctorIds`, every active doctor performs it, so it can be booked straight away. */
  create(input: ServiceInput & { durationMinutes: number }) {
    return this.site.run(async (tx, tenantId) => {
      checkRules(input);
      await this.assertConsent(tx, input.consentKey);
      await this.assertDoctors(tx, input.doctorIds);
      await this.media.replace(tx, 'image', input.imageFileId, null);
      const { id } = await this.repo.create(tx, tenantId, input);
      await this.repo.setDoctors(tx, tenantId, id, input.doctorIds ?? (await this.repo.activeDoctorIds(tx)));
      return this.present((await this.repo.get(tx, id))!);
    });
  }

  /** Rules that span fields (a name, a sane price range) are checked on the merged row, so a PATCH gets the same 400 as a POST. */
  async update(id: string, patch: ServiceInput) {
    let released: string | null = null;
    const result = await this.site.run(async (tx, tenantId) => {
      const current = await this.repo.lock(tx, id);
      if (!current) throw notFound();
      released = await this.media.replace(tx, 'image', patch.imageFileId, current.image_file_id);
      checkRules({
        nameAr: patch.nameAr === undefined ? current.name_ar : patch.nameAr,
        nameEn: patch.nameEn === undefined ? current.name_en : patch.nameEn,
        priceMinor: patch.priceMinor ?? current.price_minor,
        priceMaxMinor: patch.priceMaxMinor === undefined ? current.price_max_minor : patch.priceMaxMinor,
      });
      await this.assertConsent(tx, patch.consentKey);
      await this.assertDoctors(tx, patch.doctorIds);
      if (!(await this.repo.update(tx, id, patch))) throw notFound();
      if (patch.doctorIds) await this.repo.setDoctors(tx, tenantId, id, patch.doctorIds);
      return { tenantId, service: (await this.repo.get(tx, id))! };
    });
    if (released) await this.media.deleteIfUnused(result.tenantId, released); // the previous image, after the commit
    return this.present(result.service);
  }

  /**
   * Deleting always succeeds for the clinic (owner 2026-10-21). A service nothing used is removed; one that appointments,
   * plans, visits, invoices or the waitlist point at is hidden everywhere and kept, so that history keeps its name.
   * The row lock makes a concurrent use wait for this decision.
   */
  async remove(id: string): Promise<void> {
    let released: string | null = null;
    const tenantId = await this.site.run(async (tx, tenant) => {
      const current = await this.repo.lock(tx, id);
      if (!current) throw notFound();
      if (await this.repo.used(tx, id)) {
        await this.repo.markDeleted(tx, id);
      } else {
        await this.repo.delete(tx, id);
        released = current.image_file_id;
      }
      return tenant;
    });
    if (released) await this.media.deleteIfUnused(tenantId, released); // its image, after the commit
  }
}

function checkRules(s: Pick<ServiceInput, 'nameAr' | 'nameEn' | 'priceMinor' | 'priceMaxMinor'>) {
  if (!s.nameAr && !s.nameEn) throw Err.badRequest('validation_failed', 'nameAr or nameEn is required');
  if (s.priceMaxMinor != null && s.priceMaxMinor < (s.priceMinor ?? 0)) throw Err.badRequest('validation_failed', 'priceMax must be >= price');
}
