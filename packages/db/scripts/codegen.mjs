// Regenerates src/database.ts (Kysely types) from the live database. Run after every migration.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { need } from './env.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
// npm workspaces hoist tools to the repo root; check both places
const binDir = [path.join(here, '..', 'node_modules', '.bin'), path.join(here, '..', '..', '..', 'node_modules', '.bin')].join(path.delimiter);
const r = spawnSync('kysely-codegen', ['--dialect', 'postgres', '--out-file', 'src/database.ts',
  '--exclude-pattern', 'public.schema_migrations'], {
  stdio: 'inherit', shell: true, cwd: path.join(here, '..'),
  env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, DATABASE_URL: need('DATABASE_ADMIN_URL') },
});
process.exit(r.status ?? 1);
