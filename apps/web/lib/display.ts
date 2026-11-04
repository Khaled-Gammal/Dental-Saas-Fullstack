/**
 * Layout helpers for the clinic website (pure, no React, unit-tested): how a list of cards fills the bento grid, and how
 * the clinic's name is split for the hero's underlined last word.
 */

/** The name before its last word, and the last word: "عيادة الابتسامة لطب الأسنان" -> ["عيادة الابتسامة لطب", "الأسنان"]. */
export function splitLastWord(name: string): [string, string] {
  const t = name.trim().replace(/\s+/g, ' ');
  const i = t.lastIndexOf(' ');
  return i < 0 ? ['', t] : [t.slice(0, i), t.slice(i + 1)];
}

/** How one card sits in the bento grid: two cells wide on three columns (`wide3`), on two columns (`wide2`), or the whole row. */
export interface BentoCell { wide3: boolean; wide2: boolean; full: boolean }

/**
 * Spans that leave no hole in any row. On three columns the first card spans two when one cell is missing, and the
 * first and the last when two are (a zigzag); on two columns the first spans both when the count is odd. A single card
 * takes the whole row.
 */
export function bentoCells(n: number): BentoCell[] {
  if (n <= 0) return [];
  if (n === 1) return [{ wide3: false, wide2: false, full: true }];
  const missing3 = (3 - (n % 3)) % 3;
  return Array.from({ length: n }, (_, i) => ({
    wide3: (missing3 >= 1 && i === 0) || (missing3 === 2 && i === n - 1),
    wide2: n % 2 === 1 && i === 0,
    full: false,
  }));
}

/** The class names of a bento cell. */
export const bentoClass = (c: BentoCell) => [c.wide3 && 'w3', c.wide2 && 'w2', c.full && 'wfull'].filter(Boolean).join(' ');

/** Enough copies of a short list for a strip that runs wider than any screen (the moving band under the hero). */
export function repeatToFill<T>(items: T[], min = 16): T[] {
  if (!items.length) return [];
  return Array.from({ length: Math.max(2, Math.ceil(min / items.length)) }, () => items).flat();
}
