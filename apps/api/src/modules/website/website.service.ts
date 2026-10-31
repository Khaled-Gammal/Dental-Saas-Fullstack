import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { PlanLimits } from '../../shared/plans/plan-limits.service';
import { MediaService } from '../media';
import type { SeoInput } from './faqs.schemas';
import { LiveSiteWrite } from './live-site';
import { normalizeSections, type SectionSetting } from './sections';
import { SiteCache } from './site-cache';
import { WebsiteRepository } from './website.repository';

@Injectable()
export class WebsiteService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: WebsiteRepository,
    private readonly cache: SiteCache,
    private readonly plan: PlanLimits,
    private readonly live: LiveSiteWrite,
    private readonly media: MediaService,
  ) {}

  /**
   * `showPoweredBy`: the clinic's choice; `canRemoveBadge`: whether its plan lets it hide the badge (WEB-10). The site
   * shows the badge unless both say otherwise.
   */
  async status() {
    const { row, canRemoveBadge, tenantId } = await this.db.run(async (tx, tenantId) => ({ row: await this.repo.status(tx), canRemoveBadge: await this.plan.feature(tx, 'remove_badge'), tenantId }));
    if (!row) throw Err.notFound('site_not_found', 'This clinic has no website yet');
    return {
      status: row.status, version: row.published_version, publishedAt: row.published_at, pendingChanges: row.pending_changes,
      showPoweredBy: row.show_powered_by, canRemoveBadge, sections: normalizeSections(row.sections),
      // Phase 2C-3
      hostname: row.hostname,
      seo: {
        title: row.seo_title, description: row.seo_description,
        shareImage: row.share_file_id && row.share_widths?.length
          ? this.media.view(tenantId, { id: row.share_file_id, width: row.share_width, height: row.share_height, variant_widths: row.share_widths }) : null,
      },
    };
  }

  /**
   * Phase 2C-3: how the site shows in search results and when shared. Live at once (the site's cache is purged); a
   * replaced share image is deleted after the commit if nothing else uses it.
   */
  async setSeo(input: SeoInput) {
    const { previous, tenantId, next } = await this.live.run(async (tx, tenantId) => {
      if (input.shareFileId) await this.media.assertAttachable(tx, input.shareFileId, 'image');
      const r = await this.repo.setSeo(tx, {
        ...(input.title !== undefined && { seo_title: input.title }),
        ...(input.description !== undefined && { seo_description: input.description }),
        ...(input.shareFileId !== undefined && { share_file_id: input.shareFileId }),
      });
      if (!r) throw Err.notFound('site_not_found', 'This clinic has no website yet');
      return { previous: r.previousShare, tenantId, next: input.shareFileId };
    });
    if (previous && next !== undefined && previous !== next) await this.media.deleteIfUnused(tenantId, previous);
    return this.status();
  }

  /**
   * Phase 1D (WEB-10): show or hide the "powered by" badge. Hiding it needs a plan with `remove_badge`; showing it is
   * always allowed. Applies to the live site at once (not a draft change), so the website cache is purged.
   */
  async setPoweredBy(show: boolean) {
    await this.live.run(async (tx) => {
      if (!show) await this.plan.assertFeature(tx, 'remove_badge');
      if (!(await this.repo.setPoweredBy(tx, show))) throw Err.notFound('site_not_found', 'This clinic has no website yet');
    });
    return this.status();
  }

  /** Phase 2C-1: the order of the website's sections and which are shown; applies to the live site at once. */
  async setSections(sections: SectionSetting[]) {
    await this.live.run(async (tx) => {
      if (!(await this.repo.setSections(tx, sections))) throw Err.notFound('site_not_found', 'This clinic has no website yet');
    });
    return this.status();
  }

  /** Copies the draft to the live site, then purges the website cache (outside the transaction). */
  async publish() {
    const { version, hostnames } = await this.db.run(async (tx) => {
      const row = await this.repo.publish(tx);
      if (!row) throw Err.notFound('site_not_found', 'This clinic has no website yet');
      return { version: row.published_version, hostnames: await this.repo.hostnames(tx) };
    });
    await this.cache.purge(hostnames);
    return this.status().then((s) => ({ ...s, version }));
  }
}
