import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { BranchesRepository, type BranchPatch, type NewBranch } from './branches.repository';
import { toRows, type WeeklyHoursInput } from './hours';

const notFound = () => Err.notFound('branch_not_found', 'Branch not found');

/** Branch use cases: one TenantDb.run each, so every write commits or rolls back as a unit. */
@Injectable()
export class BranchesService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: BranchesRepository,
  ) {}

  list() {
    return this.db.run((tx) => this.repo.list(tx));
  }

  async get(id: string) {
    const branch = await this.db.run((tx) => this.repo.get(tx, id));
    if (!branch) throw notFound(); // also what another clinic's branch id looks like: RLS hides it
    return branch;
  }

  create(input: NewBranch) {
    // tenant_id must still be sent; RLS WITH CHECK rejects any value other than the caller's clinic
    return this.db.run((tx, tenantId) => this.repo.create(tx, tenantId, input));
  }

  async update(id: string, patch: BranchPatch) {
    return this.db.run(async (tx) => {
      if (!(await this.repo.update(tx, id, patch))) throw notFound();
      return this.repo.get(tx, id);
    });
  }

  async makeMain(id: string) {
    return this.db.run(async (tx) => {
      await this.repo.lockAll(tx);
      if (!(await this.repo.exists(tx, id))) throw notFound();
      await this.repo.makeMain(tx, id);
      return this.repo.list(tx);
    });
  }

  async replaceHours(id: string, week: WeeklyHoursInput) {
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.repo.lock(tx, id))) throw notFound();
      await this.repo.replaceHours(tx, tenantId, id, toRows(week));
      return this.repo.get(tx, id);
    });
  }
}
