import { Injectable } from '@nestjs/common';
import type { Tx } from '@dental/db';
import { TenantDb } from '../../../shared/database/tenant-db.service';
import { Err } from '../../../shared/errors/app-error';
import { MediaService, type StoredImage } from '../../media';
import { LiveSiteWrite } from '../../website/live-site';
import { ServicesRepository, type ServiceInput } from './services.repository';

const notFound = () => Err.notFound('service_not_found', 'Service not found');

/** The clinic's price list (wizard step 4). Prices are in piastres (minor units); the UI shows pounds. */
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

  async list() {
    return (await this.db.run((tx) => this.repo.list(tx))).map((s) => this.present(s));
  }

  catalog() {
    return this.db.run((tx) => this.repo.catalog(tx));
  }

  /**
   * Adds a service. With `catalogCode`, the catalogue supplies the names and default duration unless overridden,
   * so a clinic can build its price list in a few clicks.
   */
  create(input: ServiceInput) {
    return this.site.run(async (tx, tenantId) => {
      let s = { ...input };
      if (s.catalogCode) {
        const c = await this.repo.catalogEntry(tx, s.catalogCode);
        if (!c) throw Err.badRequest('catalog_code_unknown', 'Unknown catalogue service');
        s = { nameAr: c.name_ar, nameEn: c.name_en, durationMinutes: c.default_duration_minutes, ...stripUndefined(s) };
      }
      if (!s.durationMinutes) throw Err.badRequest('validation_failed', 'durationMinutes is required');
      checkRules(s);
      await this.assertConsent(tx, s.consentKey);
      await this.media.replace(tx, 'image', s.imageFileId, null);
      const { id } = await this.repo.create(tx, tenantId, { ...s, durationMinutes: s.durationMinutes });
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
      if (!(await this.repo.update(tx, id, patch))) throw notFound();
      return { tenantId, service: (await this.repo.get(tx, id))! };
    });
    if (released) await this.media.deleteIfUnused(result.tenantId, released); // the previous image, after the commit
    return this.present(result.service);
  }
}

function checkRules(s: Pick<ServiceInput, 'nameAr' | 'nameEn' | 'priceMinor' | 'priceMaxMinor'>) {
  if (!s.nameAr && !s.nameEn) throw Err.badRequest('validation_failed', 'nameAr or nameEn is required');
  if (s.priceMaxMinor != null && s.priceMaxMinor < (s.priceMinor ?? 0)) throw Err.badRequest('validation_failed', 'priceMax must be >= price');
}

/** `{ a: undefined }` must not override a catalogue default when spread. */
function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
