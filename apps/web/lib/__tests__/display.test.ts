import { describe, expect, it } from 'vitest';
import { bentoCells, bentoClass, repeatToFill, splitLastWord } from '../display';
import { brandStyle } from '../theme';

/** Cells each row of an n-column grid holds, given the spans. */
const rows = (n: number, cols: 2 | 3) => {
  const out: number[] = [];
  let row = 0;
  for (const c of bentoCells(n)) {
    const span = c.full ? cols : (cols === 3 ? c.wide3 : c.wide2) ? 2 : 1;
    if (row + span > cols) { out.push(row); row = 0; }
    row += span;
  }
  if (row) out.push(row);
  return out;
};

describe('the services bento grid', () => {
  it('every row is full on three and on two columns, for any count', () => {
    for (let n = 1; n <= 13; n++) {
      expect([n, rows(n, 3).every((r) => r === 3)]).toEqual([n, true]);
      expect([n, rows(n, 2).every((r) => r === 2)]).toEqual([n, true]);
    }
  });
  it('the wide cards: the first, and the last when two cells are missing', () => {
    expect(bentoCells(4).map(bentoClass)).toEqual(['w3', '', '', 'w3']);
    expect(bentoCells(5).map(bentoClass)).toEqual(['w3 w2', '', '', '', '']);
    expect(bentoCells(6).map(bentoClass)).toEqual(['', '', '', '', '', '']);
    expect(bentoCells(1).map(bentoClass)).toEqual(['wfull']);
    expect(bentoCells(0)).toEqual([]);
  });
});

describe('the hero name', () => {
  it('splits before the last word', () => {
    expect(splitLastWord('عيادة الابتسامة لطب الأسنان')).toEqual(['عيادة الابتسامة لطب', 'الأسنان']);
    expect(splitLastWord('  Smile   Dental ')).toEqual(['Smile', 'Dental']);
    expect(splitLastWord('سمايل')).toEqual(['', 'سمايل']);
  });
});

describe('the moving band', () => {
  it('repeats a short list to at least the minimum, never fewer than two copies', () => {
    expect(repeatToFill(['a', 'b', 'c'], 16)).toHaveLength(18);
    expect(repeatToFill(Array.from({ length: 20 }, (_, i) => i), 16)).toHaveLength(40);
    expect(repeatToFill([], 16)).toEqual([]);
  });
});

describe('the brand colours', () => {
  it('a dark brand is kept; a light one gets dark text on it and a darker shade for text', () => {
    const violet = brandStyle('#6d4ed6') as Record<string, string>;
    expect(violet).toEqual({ '--brand': '#6d4ed6', '--on-brand': '#ffffff', '--brand-text': '#6d4ed6' });
    const mint = brandStyle('#12b5a0') as Record<string, string>;
    expect(mint['--on-brand']).toBe('#14213d');
    expect(mint['--brand-text']).not.toBe('#12b5a0');
  });
  it('anything but #rrggbb falls back to the default colour', () => {
    expect((brandStyle('red; background: url(x)') as Record<string, string>)['--brand']).toBe('#4f46e5');
  });
});
