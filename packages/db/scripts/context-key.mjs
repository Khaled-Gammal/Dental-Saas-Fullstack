// ARC-01: writes the API's clinic-context key (TENANT_CONTEXT_KEY, id TENANT_CONTEXT_KEY_ID) into app_context_keys, as the
// admin role. The key never goes into a migration. Run it once per environment, and again when the key rotates (a new
// id; retire the old one with `update app_context_keys set retired_at = now() where id = <old>` once no API uses it).
// Usage: node scripts/context-key.mjs [--test]
import pg from 'pg';
import { need } from './env.mjs';

// must equal DEV_TENANT_CONTEXT_KEY in src/context.ts (apps/api refuses it in production)
const DEV_KEY = 'dev-only-tenant-context-key-change-me-in-production';

const test = process.argv.includes('--test');
const secret = process.env.TENANT_CONTEXT_KEY || DEV_KEY;
const id = Number(process.env.TENANT_CONTEXT_KEY_ID || 1);
if (Buffer.byteLength(secret, 'utf8') < 32) { console.error('TENANT_CONTEXT_KEY must be at least 32 bytes'); process.exit(1); }
if (!Number.isInteger(id) || id < 1 || id > 32767) { console.error('TENANT_CONTEXT_KEY_ID must be 1..32767'); process.exit(1); }

const client = new pg.Client({ connectionString: need(test ? 'TEST_DATABASE_ADMIN_URL' : 'DATABASE_ADMIN_URL') });
await client.connect();
try {
  await client.query(
    `insert into app_context_keys (id, key) values ($1, convert_to($2, 'UTF8'))
     on conflict (id) do update set key = excluded.key, retired_at = null`, [id, secret]);
  console.log(`✓ clinic context key ${id} written${secret === DEV_KEY ? ' (development key)' : ''}`);
} finally {
  await client.end();
}
