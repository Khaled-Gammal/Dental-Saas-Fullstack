// Executes a .sql file as the admin role (used for seeds). Usage: node scripts/run-sql.mjs seeds/dev_seed.sql [--test]
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { need } from './env.mjs';

const file = process.argv[2];
const test = process.argv.includes('--test');
const client = new pg.Client({ connectionString: need(test ? 'TEST_DATABASE_ADMIN_URL' : 'DATABASE_ADMIN_URL') });
await client.connect();
try {
  await client.query(readFileSync(file, 'utf8'));
  console.log(`✓ ran ${file}`);
} finally {
  await client.end();
}
