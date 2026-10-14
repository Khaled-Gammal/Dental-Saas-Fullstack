// Runs dbmate (installed from npm into node_modules/.bin, no global install needed)
// against DATABASE_ADMIN_URL, or TEST_DATABASE_ADMIN_URL with --test.
// Settings go through env vars, so URLs with special characters are safe on Windows too.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { need } from './env.mjs';

const args = process.argv.slice(2);
const test = args.includes('--test');
const here = path.dirname(fileURLToPath(import.meta.url));
// npm workspaces hoist tools to the repo root; check both places
const binDir = [path.join(here, '..', 'node_modules', '.bin'), path.join(here, '..', '..', '..', 'node_modules', '.bin')].join(path.delimiter);
const r = spawnSync('dbmate', args.filter((a) => a !== '--test'), {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    DATABASE_URL: need(test ? 'TEST_DATABASE_ADMIN_URL' : 'DATABASE_ADMIN_URL'),
    DBMATE_MIGRATIONS_DIR: path.join(here, '..', 'migrations'),
    DBMATE_NO_DUMP_SCHEMA: 'true',
    DBMATE_WAIT: 'true',
  },
});
process.exit(r.status ?? 1);
