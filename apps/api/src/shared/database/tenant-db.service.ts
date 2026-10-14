import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { withTenant, type Db, type Tx } from '@dental/db';
import type { RequestContext } from '../context/request-context';
import { DB } from './tokens';

/**
 * The only way module code reaches clinic data.
 * `run` opens one transaction, sets app.tenant_id from the authenticated request, and lets RLS
 * filter every query. A use case = one call to `run`, so its writes commit or roll back together.
 */
@Injectable()
export class TenantDb {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) throw new ForbiddenException('No clinic selected for this request');
    return withTenant(this.db, tenantId, fn);
  }

  /** For public website requests, where the tenant comes from the hostname instead of a token. */
  runAs<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.db, tenantId, fn);
  }

  /** Queries that need no tenant (lookup functions, users table). */
  get raw(): Db {
    return this.db;
  }
}
