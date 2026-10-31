import { Injectable } from '@nestjs/common';
import type { Tx } from '@dental/db';
import { Err } from '../../shared/errors/app-error';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { MediaService } from '../media';
import { LiveSiteWrite } from '../website/live-site';
import { CasesRepository, type CaseFields, type CaseRow } from './cases.repository';
import type { EditCaseInput, NewCaseInput } from './cases.schemas';

/** A clinic shows its best cases, not an archive. */
export const MAX_CASES = 100;
const notFound = () => Err.notFound('case_not_found', 'Case not found');

/** The rules a case must meet to be shown (the database checks them too; checked here first for clear messages). */
function assertShowable(c: { is_published: boolean; consent_confirmed: boolean; caption_ar: string | null; alt_ar: string | null; image_file_id: string; before_file_id: string | null }) {
  if (c.image_file_id === c.before_file_id) throw Err.badRequest('case_same_image', 'The before and after images must be different');
  if (!c.is_published) return;
  if (!c.consent_confirmed) throw Err.badRequest('consent_required', 'Confirm the patient\'s written consent before publishing');
  if (!c.caption_ar && !c.alt_ar) throw Err.badRequest('alt_required', 'Describe the case before publishing it');
}

/**
 * Phase 2C-2: before/after cases on the clinic website. Like photos, every change goes through LiveSiteWrite (the site's
 * cache is purged after commit) and the images' visibility follows: public exactly while a published case shows them.
 * Consent: who confirmed it and when is stamped by the database (the acting member); withdrawing it unpublishes the case.
 */
@Injectable()
export class CasesService {
  constructor(
    private readonly db: TenantDb,
    private readonly site: LiveSiteWrite,
    private readonly repo: CasesRepository,
    private readonly media: MediaService,
  ) {}

  private view(tenantId: string, r: CaseRow) {
    return {
      id: r.id, serviceId: r.service_id, serviceName: r.service_name, captionAr: r.caption_ar, altAr: r.alt_ar, isPublished: r.is_published,
      consentConfirmed: r.consent_confirmed, consentConfirmedAt: r.consent_confirmed_at, consentConfirmedBy: r.consent_confirmed_by_name,
      sortOrder: r.sort_order, updatedAt: r.updated_at,
      before: this.media.view(tenantId, { id: r.before_id, width: r.before_width, height: r.before_height, variant_widths: r.before_widths }),
      after: this.media.view(tenantId, { id: r.after_id, width: r.after_width, height: r.after_height, variant_widths: r.after_widths }),
    };
  }

  list() {
    return this.db.run(async (tx, tenantId) => (await this.repo.list(tx)).map((r) => this.view(tenantId, r)));
  }

  create(input: NewCaseInput) {
    return this.site.run(async (tx, tenantId) => {
      await this.repo.lockClinic(tx);
      if ((await this.repo.count(tx)) >= MAX_CASES) throw Err.conflict('case_limit', `A clinic shows ${MAX_CASES} cases at most`);
      await this.media.assertAttachable(tx, input.beforeFileId, 'case');
      await this.media.assertAttachable(tx, input.afterFileId, 'case');
      await this.assertService(tx, input.serviceId);
      const f = {
        image_file_id: input.afterFileId, before_file_id: input.beforeFileId, service_id: input.serviceId, caption_ar: input.captionAr, alt_ar: input.altAr,
        consent_confirmed: input.consentConfirmed, is_published: input.isPublished ?? false,
      };
      assertShowable(f);
      const { id } = await this.repo.create(tx, tenantId, f);
      await this.media.refreshVisibility(tx, [input.beforeFileId, input.afterFileId]);
      return this.view(tenantId, (await this.repo.get(tx, id))!);
    });
  }

  async update(id: string, input: EditCaseInput) {
    const { result, released, tenantId } = await this.site.run(async (tx, tenantId) => {
      const cur = await this.repo.lock(tx, id);
      if (!cur) throw notFound();
      const f: CaseFields = {
        ...(input.afterFileId !== undefined && { image_file_id: input.afterFileId }),
        ...(input.beforeFileId !== undefined && { before_file_id: input.beforeFileId }),
        ...(input.serviceId !== undefined && { service_id: input.serviceId }),
        ...(input.captionAr !== undefined && { caption_ar: input.captionAr }),
        ...(input.altAr !== undefined && { alt_ar: input.altAr }),
        ...(input.consentConfirmed !== undefined && { consent_confirmed: input.consentConfirmed }),
        ...(input.isPublished !== undefined && { is_published: input.isPublished }),
      };
      // new images need the patient's consent for those images: confirmed again in the same request, or the case loses
      // its consent and leaves the site (the database stamps a new confirmation with the acting member)
      const newImages = (!!f.image_file_id && f.image_file_id !== cur.image_file_id) || (!!f.before_file_id && f.before_file_id !== cur.before_file_id);
      if (newImages && input.consentConfirmed !== true) f.consent_confirmed = false;
      // withdrawing the consent takes the case off the site with it
      if (f.consent_confirmed === false && (cur.is_published || f.is_published)) f.is_published = false;
      for (const fileId of [f.image_file_id, f.before_file_id]) if (fileId && fileId !== cur.image_file_id && fileId !== cur.before_file_id) await this.media.assertAttachable(tx, fileId, 'case');
      await this.assertService(tx, f.service_id);
      assertShowable({ ...cur, ...f });
      await this.repo.update(tx, id, f);
      const now = new Set([f.image_file_id ?? cur.image_file_id, f.before_file_id ?? cur.before_file_id]);
      const released = [cur.image_file_id, cur.before_file_id].filter((x): x is string => !!x && !now.has(x));
      await this.media.refreshVisibility(tx, [...now, ...released].filter((x): x is string => !!x));
      return { result: this.view(tenantId, (await this.repo.get(tx, id))!), released, tenantId };
    });
    for (const fileId of released) await this.media.deleteIfUnused(tenantId, fileId); // a replaced image goes if nothing else uses it
    return result;
  }

  async remove(id: string): Promise<void> {
    const { files, tenantId } = await this.site.run(async (tx, tenantId) => {
      const gone = await this.repo.remove(tx, id);
      if (!gone) throw notFound();
      const files = [gone.image_file_id, gone.before_file_id].filter((x): x is string => !!x);
      await this.media.refreshVisibility(tx, files);
      return { files, tenantId };
    });
    for (const fileId of files) await this.media.deleteIfUnused(tenantId, fileId);
  }

  /** Sets the whole order: the list must name every case exactly once. */
  reorder(ids: string[]) {
    return this.site.run(async (tx, tenantId) => {
      await this.repo.lockClinic(tx);
      const all = new Set(await this.repo.ids(tx));
      if (all.size !== ids.length || ids.some((i) => !all.has(i))) {
        throw Err.badRequest('order_mismatch', 'The order must list every case exactly once; reload and try again');
      }
      await this.repo.reorder(tx, ids);
      return (await this.repo.list(tx)).map((r) => this.view(tenantId, r));
    });
  }

  private async assertService(tx: Tx, serviceId: string | null | undefined) {
    if (serviceId && !(await this.repo.serviceExists(tx, serviceId))) throw Err.badRequest('service_not_found', 'Service not found');
  }
}
