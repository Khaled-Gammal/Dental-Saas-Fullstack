import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../shared/context/request-context';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { BranchesRepository, type NewBranch } from './branches.repository';

@Injectable()
export class BranchesService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: BranchesRepository,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  list() {
    return this.db.run((tx) => this.repo.list(tx));
  }

  create(input: NewBranch) {
    // tenant_id must still be sent; RLS WITH CHECK rejects any value other than the caller's clinic
    return this.db.run((tx) => this.repo.create(tx, this.cls.get('tenantId')!, input));
  }
}
