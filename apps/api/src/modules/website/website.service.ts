import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { SiteCache } from './site-cache';
import { WebsiteRepository } from './website.repository';

@Injectable()
export class WebsiteService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: WebsiteRepository,
    private readonly cache: SiteCache,
  ) {}

  async status() {
    const row = await this.db.run((tx) => this.repo.status(tx));
    if (!row) throw Err.notFound('site_not_found', 'This clinic has no website yet');
    return { status: row.status, version: row.published_version, publishedAt: row.published_at, pendingChanges: row.pending_changes };
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
