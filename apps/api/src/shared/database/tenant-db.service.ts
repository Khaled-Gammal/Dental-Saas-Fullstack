import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { sql, withTenant, type Db, type Tx } from '@dental/db';
import type { RequestContext } from '../context/request-context';
import { Err } from '../errors/app-error';
import { DB } from './tokens';

/**
 * The only door to the database for module code. Nothing else imports `withTenant` or the raw Kysely instance.
 *
 * - `run`        — clinic data for the signed-in request: one transaction, app.tenant_id from the access token,
 *                  RLS filters every query. One use case = one `run`, so its writes commit or roll back together.
 *                  The member is set too: RLS limits a branch-limited member to their branches, and the audit
 *                  triggers record who acted.
 * - `runAs`      — clinic data for a clinic chosen by the server (sign-up, session start, token refresh).
 * - `runForHost` — clinic data for a public website request: the clinic comes from the hostname, the actor is the
 *                  visitor (audited as the patient).
 * - `platform`   — ONLY for tables without RLS (users, otp_codes, refresh_tokens, auth_events) and the
 *                  SECURITY DEFINER lookup functions. Never for clinic tables: RLS would hide every row.
 */
@Injectable()
export class TenantDb {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  run<T>(fn: (tx: Tx, tenantId: string) => Promise<T>): Promise<T> {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) throw Err.forbidden('no_clinic', 'No clinic selected for this request');
    const actor = { userId: this.cls.get('userId'), memberId: this.cls.get('memberId'), actorType: 'member' as const };
    return withTenant(this.db, tenantId, (tx) => fn(tx, tenantId), actor);
  }

  runAs<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.db, tenantId, fn);
  }

  /** Resolves the clinic from a website hostname and runs `fn` in its context; null when no clinic owns the host. */
  runForHost<T>(hostname: string, fn: (tx: Tx, tenantId: string) => Promise<T>): Promise<T | null> {
    return this.db.transaction().execute(async (tx) => {
      // resolve + set in one round trip; suspended clinics and unverified domains resolve to nothing
      const { rows } = await sql<{ tenant_id: string | null }>`
        select nullif(set_config('app.tenant_id', coalesce(resolve_tenant_by_host(${hostname})::text, ''), true), '') as tenant_id,
               set_config('app.actor_type', 'patient', true)`.execute(tx);
      const tenantId = rows[0]?.tenant_id;
      return tenantId ? fn(tx, tenantId) : null;
    });
  }

  platform(): Db {
    return this.db;
  }
}
