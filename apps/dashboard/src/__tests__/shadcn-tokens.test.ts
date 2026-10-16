import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * shadcn/ui's theme variables live in the same :root as the design tokens. A shadcn variable with a token's name
 * silently overwrites the token for the whole dashboard (this happened with --muted and --ring), so the two sets
 * must never share a name.
 */
describe('shadcn.css never redefines a design token', () => {
  const read = (p: string) => readFileSync(path.resolve(__dirname, p), 'utf8');
  const defined = (css: string) => new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));
  const rootBlock = (css: string) => /:root\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '';

  it('no :root variable in shadcn.css is also a token', () => {
    const tokens = defined(read('../../../../packages/ui/tokens.css'));
    const shadcn = defined(rootBlock(read('../shadcn.css')));
    expect([...shadcn].filter((v) => tokens.has(v))).toEqual([]);
  });
});
