import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { enterHost, enterTenant, withTenant, type ContextKey, type Db, type Tx, type TxActor } from '@dental/db';
import type { RequestContext } from '../context/request-context';
import { Err } from '../errors/app-error';
import { CONTEXT_KEY, DB } from './tokens';

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
 * Every context is signed with the context key (ARC-01): the database believes it for this transaction only, and SQL
 * running as the API role cannot switch to another clinic.
 *
 * - `platform`   — ONLY for tables without RLS (users, otp_codes, refresh_tokens, auth_events) and the
 *                  SECURITY DEFINER lookup functions. Never for clinic tables: RLS would hide every row.
 */
@Injectable()
export class TenantDb {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly cls: ClsService<RequestContext>,
    @Inject(CONTEXT_KEY) private readonly key: ContextKey,
  ) {}

  run<T>(fn: (tx: Tx, tenantId: string) => Promise<T>): Promise<T> {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) throw Err.forbidden('no_clinic', 'No clinic selected for this request');
    const actor = { userId: this.cls.get('userId'), memberId: this.cls.get('memberId'), actorType: 'member' as const };
    return withTenant(this.db, tenantId, (tx) => fn(tx, tenantId), actor, this.key);
  }

  runAs<T>(tenantId: string, fn: (tx: Tx) => Promise<T>, actor?: TxActor): Promise<T> {
    return withTenant(this.db, tenantId, fn, actor, this.key);
  }

  /** Names who acts for the rest of the transaction (e.g. a login created inside it), for the audit triggers. */
  async actAs(tx: Tx, tenantId: string, userId: string): Promise<void> {
    await enterTenant(tx, tenantId, { userId, actorType: 'member' }, this.key);
  }

  /** Enters a clinic inside a transaction opened elsewhere (e.g. the one that consumes a one-time code), signed. */
  async enter(tx: Tx, tenantId: string, actor: TxActor): Promise<void> {
    await enterTenant(tx, tenantId, actor, this.key);
  }

  /** Resolves the clinic from a website hostname and runs `fn` in its context; null when no clinic owns the host. */
  runForHost<T>(hostname: string, fn: (tx: Tx, tenantId: string) => Promise<T>): Promise<T | null> {
    return this.db.transaction().execute(async (tx) => {
      // resolve + enter in one round trip; suspended clinics and unverified domains resolve to nothing
      const tenantId = await enterHost(tx, hostname, this.key);
      return tenantId ? fn(tx, tenantId) : null;
    });
  }

  platform(): Db {
    return this.db;
  }
}
