// Rebuilds the test database (migrations + seed) and runs every test/*.sql file.
// Uses a local `psql` if you have one, otherwise the psql inside the Docker container,
// so on Windows you only need Docker Desktop.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { need } from './env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, '..');
const repoRoot = path.join(pkg, '../..');
const adminUrl = need('TEST_DATABASE_ADMIN_URL');
const dbName = new URL(adminUrl).pathname.slice(1);

// No shell: arguments are passed as-is, so paths with spaces (C:\Program Files\nodejs\node.exe) work on Windows.
// node, psql and docker are real executables, so they are found on PATH without a shell.
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts });
}
const node = (script, ...args) => run(process.execPath, [path.join(here, script), ...args], { cwd: pkg, stdio: 'inherit' });

console.log(`Rebuilding ${dbName} ...`);
if (node('dbmate.mjs', '--test', 'drop').status !== 0) process.exit(1);
if (node('dbmate.mjs', '--test', 'up').status !== 0) process.exit(1);
if (node('run-sql.mjs', path.join(pkg, 'seeds/dev_seed.sql'), '--test').status !== 0) process.exit(1);
// placeholder legal documents (H6) and the demo members' acceptances, so the API tests sign in as usual
if (node('run-sql.mjs', path.join(pkg, 'seeds/legal_placeholders.sql'), '--test').status !== 0) process.exit(1);

const hasLocalPsql = run('psql', ['--version']).status === 0;
function psql(file) {
  const sql = readFileSync(file, 'utf8');
  if (hasLocalPsql) {
    return run('psql', [adminUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: sql });
  }
  return run('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-X', '-q', '-U', 'postgres', '-d', dbName,
    '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: sql, cwd: repoRoot });
}

const files = readdirSync(path.join(pkg, 'test')).filter((f) => f.endsWith('.sql')).sort();
let passed = 0;
let failedFiles = 0;
for (const f of files) {
  const r = psql(path.join(pkg, 'test', f));
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const oks = out.split('\n').filter((l) => l.includes('NOTICE:  ok - ')).map((l) => l.split('ok - ')[1]);
  passed += oks.length;
  const errors = out.split('\n').filter((l) => l.includes('ERROR'));
  if (r.status !== 0 || errors.length) {
    failedFiles += 1;
    console.log(`✗ ${f}  (${oks.length} passed before the failure)`);
    for (const e of errors) console.log(`    ${e.replace(/^psql:[^:]*:\d+: /, '')}`);
    if (r.error) console.log(`    ${r.error.message}`);
  } else {
    console.log(`✓ ${f}  ${oks.length ? `(${oks.length} checks)` : ''}`);
  }
}
console.log(`\n${passed} checks passed${failedFiles ? `, ${failedFiles} file(s) failed` : ''}`);
process.exit(failedFiles ? 1 : 0);
