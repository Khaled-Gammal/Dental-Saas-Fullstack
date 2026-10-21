import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * L10N-001: the dashboard shows Arabic only. Its texts are written where they are shown (there is no dictionary since
 * 2026-10-21), so this reads the source: what a member sees (JSX text, and every string with Arabic in it) carries no
 * English words outside the allow-list. Latin letters appear only for names and tokens the owner allows (brand names in
 * English, CLR-07 note of 2026-10-19). A new English text on screen fails here.
 */
const ALLOWED_LATIN = /\b(QR|PDF|JPE?G|PNG|WEBP|HEIC|SVG|Enter|Mailpit|localhost|nasr-city|InstaPay|WhatsApp|Google|Maps|URL|ID|KB|MB|PDPL|FDI|A4|A5|EGP|CSV|Excel|ZIP|JSON|SMS|OTP|HTTPS?|www|clinic-a|lvh\.me|dental|example|com)\b/gi;
const SRC = fileURLToPath(new URL('..', import.meta.url));
// shadcn/ui parts and tests are not screens; the demo sign-in list is for developers only
const SKIP = /[\\/](__tests__|components[\\/]ui)[\\/]/;
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []).filter((f) => !SKIP.test(f));

const englishIn = (s: string) => /[A-Za-z]{2,}/.test(s.replace(ALLOWED_LATIN, '').replace(/\{[a-z]+\}/gi, '').replace(/#[0-9a-f]{6}/gi, ''));

/** What a member reads: JSX text, and string literals that hold Arabic (labels, titles, messages). */
function texts(file: string): { at: string; text: string }[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { at: string; text: string }[] = [];
  const visit = (n: ts.Node) => {
    const at = `${file.slice(SRC.length)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
    if (ts.isJsxText(n) && n.text.trim()) out.push({ at, text: n.text.trim() });
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /[؀-ۿ]/.test(n.text)) out.push({ at, text: n.text });
    if (ts.isTemplateExpression(n)) {
      const parts = [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' ');
      if (/[؀-ۿ]/.test(parts)) out.push({ at, text: parts });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('Arabic only (L10N-001)', () => {
  const all = files(SRC).flatMap(texts);
  it('reads the screens (the scan still finds the texts)', () => {
    expect(all.length).toBeGreaterThan(1500);
  });
  it('no text on screen carries English words outside the allow-list', () => {
    expect(all.filter((x) => englishIn(x.text)).map((x) => `${x.at}  ${x.text}`)).toEqual([]);
  });
});
