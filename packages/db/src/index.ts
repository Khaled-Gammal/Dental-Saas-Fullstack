import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { Pool } from 'pg';
import { signContext, signHost, type ContextKey } from './context';
import type { DB } from './database';

export type { DB } from './database';
export * from './database';
export { sql };
export type { RawBuilder } from 'kysely';
export { DEV_TENANT_CONTEXT_KEY, signContext, signHost, type ContextKey } from './context';
export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;

export interface CreateDbOptions {
  /** Max pool size. Keep it small per process; PostgreSQL connections are expensive. */
  max?: number;
  applicationName?: string;
}

/** Creates a Kysely instance over a pg pool. One per process (API, worker). */
export function createDb(connectionString: string, opts: CreateDbOptions = {}): Db {
  const pool = new Pool({
    connectionString,
    max: opts.max ?? 10,
    application_name: opts.applicationName ?? 'dental-saas',
    connectionTimeoutMillis: 5_000, // under a burst, fail with an error instead of waiting forever for a connection
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000, // no single query may hold a connection longer than 15 s
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

/**
 * Who acts in a transaction. `memberId` turns on branch-scoped access (the member's branches only); the audit
 * triggers record `userId` and `actorType`. Leave both empty for work no signed-in member does (website, jobs).
 */
export interface TxActor {
  userId?: string | null;
  memberId?: string | null;
  actorType?: 'member' | 'patient' | 'system';
}

/**
 * Sets the clinic and the actor for the current transaction (transaction-local, so nothing leaks to the next request).
 * With a key (the API), the context is signed and enter_context() checks it (ARC-01); the database then believes these
 * settings only for this transaction. Without one (admin scripts, the worker), the plain settings are set: the database
 * believes them only for logins that bypass RLS anyway, or while the context mode is 'permissive'.
 */
export async function enterTenant(tx: Tx, tenantId: string, actor: TxActor = {}, key?: ContextKey): Promise<void> {
  if (key) {
    const c = signContext(key, { tenantId, memberId: actor.memberId, userId: actor.userId, actorType: actor.actorType });
    await sql`select enter_context(${c.tenantId}::uuid, ${c.memberId}::uuid, ${c.userId}::uuid, ${c.actorType}::text, ${c.issuedAt}::bigint,
      ${c.keyId}::smallint, ${c.sig}::text)`.execute(tx);
    return;
  }
  await sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${actor.userId ?? ''}, true),
    set_config('app.member_id', ${actor.memberId ?? ''}, true), set_config('app.actor_type', ${actor.actorType ?? ''}, true)`.execute(tx);
}

/** The public website: enters the clinic that owns the hostname, as the patient. Null (and no context) when none does. */
export async function enterHost(tx: Tx, host: string, key: ContextKey): Promise<string | null> {
  const h = signHost(key, host);
  const { rows } = await sql<{ tenant_id: string | null }>`
    select enter_host_context(${h.host}::text, ${h.issuedAt}::bigint, ${h.keyId}::smallint, ${h.sig}::text) as tenant_id`.execute(tx);
  return rows[0]?.tenant_id ?? null;
}

/**
 * Runs fn inside one transaction scoped to a clinic: RLS sees only that tenant's rows (and, with a member, only
 * that member's branches). `set_config(..., true)` is transaction-local, so the settings can never leak to the next
 * request that reuses the pooled connection.
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<T>, actor: TxActor = {}, key?: ContextKey): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await enterTenant(tx, tenantId, actor, key);
    return fn(tx);
  });
}
