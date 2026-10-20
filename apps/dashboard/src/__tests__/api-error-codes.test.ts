import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { errorLabel } from '../labels';

/**
 * L10N-003 acceptance: every error code the API can send has an Arabic text. Codes are read from the API source:
 * thrown ones (`Err.x('code'`, `new AppError('code'`) and the database-rule mappings (`code: 'code'`). Add the code's
 * Arabic to `errorLabel` in labels.ts when this fails.
 */
const API_SRC = fileURLToPath(new URL('../../../api/src', import.meta.url));
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === '__tests__' ? [] : files(join(dir, e.name))) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []);

describe('every API error code has Arabic (L10N-003)', () => {
  it('finds the codes and a text for each', () => {
    const codes = new Set<string>();
    for (const f of files(API_SRC)) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/Err\.\w+\(\s*'([a-z0-9_]+)'|new AppError\(\s*'([a-z0-9_]+)'|\bcode: '([a-z0-9_]+)'/g)) codes.add(m[1] ?? m[2] ?? m[3]);
    }
    expect(codes.size).toBeGreaterThan(150); // the scan still sees the API
    expect([...codes].filter((c) => !(c in errorLabel)).sort()).toEqual([]);
  });
});
