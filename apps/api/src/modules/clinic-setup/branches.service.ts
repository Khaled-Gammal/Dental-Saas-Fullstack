import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { PlanLimits } from '../../shared/plans/plan-limits.service';
import { MediaService, type StoredImage } from '../media';
import { LiveSiteWrite } from '../website/live-site';
import { BranchesRepository, type BranchPatch, type NewBranch } from './branches.repository';
import { toRows, type WeeklyHoursInput } from './hours';

const notFound = () => Err.notFound('branch_not_found', 'Branch not found');

/** Branch use cases: one TenantDb.run each, so every write commits or rolls back as a unit. */
@Injectable()
export class BranchesService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: BranchesRepository,
    private readonly plan: PlanLimits,
    private readonly site: LiveSiteWrite,
    private readonly media: MediaService,
  ) {}

  /** The photo goes out with short-lived signed links (it may not be public yet). */
  private present<T extends { photo: StoredImage | null }>(b: T) {
    return { ...b, photo: this.media.present(b.photo) };
  }

  async list() {
    return (await this.db.run((tx) => this.repo.list(tx))).map((b) => this.present(b));
  }

  async get(id: string) {
    const branch = await this.db.run((tx) => this.repo.get(tx, id));
    if (!branch) throw notFound(); // also what another clinic's branch id looks like: RLS hides it
    return this.present(branch);
  }

  create(input: NewBranch) {
    // tenant_id must still be sent; RLS WITH CHECK rejects any value other than the caller's clinic
    return this.db.run(async (tx, tenantId) => {
      await this.plan.assertCanAdd(tx, tenantId, 'branches', () => this.repo.countActive(tx));
      return this.repo.create(tx, tenantId, input);
    });
  }

  /**
   * Reactivating a branch takes a seat again, so it is checked against the plan like a create. Branches are on the
   * website, so the edit purges its cache (LiveSiteWrite).
   */
  async update(id: string, patch: BranchPatch) {
    let released: string | null = null;
    const result = await this.site.run(async (tx, tenantId) => {
      const current = await this.repo.lock(tx, id);
      if (!current) throw notFound();
      if (patch.isActive === true && !current.is_active) await this.plan.assertCanAdd(tx, tenantId, 'branches', () => this.repo.countActive(tx));
      released = await this.media.replace(tx, 'image', patch.photoFileId, current.photo_file_id);
      if (!(await this.repo.update(tx, id, patch))) throw notFound();
      return { tenantId, branch: (await this.repo.get(tx, id))! };
    });
    if (released) await this.media.deleteIfUnused(result.tenantId, released); // the previous photo, after the commit
    return this.present(result.branch);
  }

  async makeMain(id: string) {
    return this.db.run(async (tx, tenantId) => {
      await this.repo.lockAll(tx);
      const current = await this.repo.lock(tx, id);
      if (!current) throw notFound();
      if (!current.is_active) await this.plan.assertCanAdd(tx, tenantId, 'branches', () => this.repo.countActive(tx)); // main is always active
      await this.repo.makeMain(tx, id);
      return (await this.repo.list(tx)).map((b) => this.present(b));
    });
  }

  async replaceHours(id: string, week: WeeklyHoursInput) {
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.repo.lock(tx, id))) throw notFound();
      await this.repo.replaceHours(tx, tenantId, id, toRows(week));
      return this.present((await this.repo.get(tx, id))!);
    });
  }
}
