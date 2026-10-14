import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './database';

export type { DB } from './database';
export * from './database';
export { sql };
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
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

/**
 * Runs fn inside one transaction scoped to a clinic: RLS sees only that tenant's rows.
 * `set_config(..., true)` is transaction-local, so the setting can never leak to the next request
 * that reuses the pooled connection.
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(tx);
    return fn(tx);
  });
}
