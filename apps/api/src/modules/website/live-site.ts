import { Injectable } from '@nestjs/common';
import type { Tx } from '@dental/db';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { SiteCache } from './site-cache';
import { WebsiteRepository } from './website.repository';

/**
 * A write that changes what visitors see right away (doctors, services): the same `TenantDb.run`,
 * plus a cache purge of the clinic's website once the transaction has committed.
 * The theme goes through the draft/publish flow instead (WebsiteService).
 */
@Injectable()
export class LiveSiteWrite {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: WebsiteRepository,
    private readonly cache: SiteCache,
  ) {}

  async run<T>(fn: (tx: Tx, tenantId: string) => Promise<T>): Promise<T> {
    const { result, hostnames } = await this.db.run(async (tx, tenantId) => ({
      result: await fn(tx, tenantId),
      hostnames: await this.repo.hostnames(tx),
    }));
    await this.cache.purge(hostnames); // best effort, never fails the request
    return result;
  }
}
