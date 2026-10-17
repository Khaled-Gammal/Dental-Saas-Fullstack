import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './database';

export type { DB } from './database';
export * from './database';
export { sql };
export type { RawBuilder } from 'kysely';
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

/** Sets the clinic and the actor for the current transaction (transaction-local, so nothing leaks to the next request). */
export async function enterTenant(tx: Tx, tenantId: string, actor: TxActor = {}): Promise<void> {
  await sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${actor.userId ?? ''}, true),
    set_config('app.member_id', ${actor.memberId ?? ''}, true), set_config('app.actor_type', ${actor.actorType ?? ''}, true)`.execute(tx);
}

/**
 * Runs fn inside one transaction scoped to a clinic: RLS sees only that tenant's rows (and, with a member, only
 * that member's branches). `set_config(..., true)` is transaction-local, so the settings can never leak to the next
 * request that reuses the pooled connection.
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<T>, actor: TxActor = {}): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await enterTenant(tx, tenantId, actor);
    return fn(tx);
  });
}
