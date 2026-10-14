import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { BranchesRepository, type NewBranch } from './branches.repository';

@Injectable()
export class BranchesService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: BranchesRepository,
  ) {}

  list() {
    return this.db.run((tx) => this.repo.list(tx));
  }

  create(input: NewBranch) {
    // tenant_id must still be sent; RLS WITH CHECK rejects any value other than the caller's clinic
    return this.db.run((tx, tenantId) => this.repo.create(tx, tenantId, input));
  }
}
