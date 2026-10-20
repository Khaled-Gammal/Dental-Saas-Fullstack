/**
 * The DataTable's logic (redesign R2): sorting, search and paging of rows already in the browser. Pure, unit-tested.
 * Lists that can be large page on the server instead (the table then shows what the API returns).
 */
import { toAsciiDigits } from './util';

export type SortDir = 'asc' | 'desc';
export interface SortState { id: string; dir: SortDir }
export type SortValue = string | number | Date | null | undefined;

const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });

/** Ascending → descending → back to the table's own order. */
export function nextSort(current: SortState | null, id: string): SortState | null {
  if (current?.id !== id) return { id, dir: 'asc' };
  return current.dir === 'asc' ? { id, dir: 'desc' } : null;
}

/** Sorted copy; empty values always last; Arabic and Latin text in dictionary order, numbers by value. */
export function sortRows<T>(rows: readonly T[], value: ((row: T) => SortValue) | undefined, dir: SortDir): T[] {
  if (!value) return [...rows];
  const sign = dir === 'asc' ? 1 : -1;
  const key = (v: SortValue) => (v instanceof Date ? v.getTime() : v);
  return [...rows].sort((ra, rb) => {
    const a = key(value(ra));
    const b = key(value(rb));
    const emptyA = a === null || a === undefined || a === '';
    const emptyB = b === null || b === undefined || b === '';
    if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * sign;
    return collator.compare(String(a), String(b)) * sign;
  });
}

/**
 * Search text in a form that ignores what people type differently: Arabic-Indic digits, the alef/ya/ta-marbuta
 * variants, tashkeel and tatweel, letter case.
 */
export function searchKey(s: string): string {
  return toAsciiDigits(s)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '') // tashkeel, tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rows whose text holds every word of the query (in any order). */
export function searchRows<T>(rows: readonly T[], query: string, text: (row: T) => string): T[] {
  const words = searchKey(query).split(' ').filter(Boolean);
  if (!words.length) return [...rows];
  return rows.filter((r) => { const hay = searchKey(text(r)); return words.every((w) => hay.includes(w)); });
}

export interface Page<T> { rows: T[]; page: number; pages: number; total: number; from: number; to: number }

/** One page of rows (1-based); a page past the end shows the last one. */
export function paginate<T>(rows: readonly T[], page: number, size: number): Page<T> {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * size;
  const slice = rows.slice(start, start + size);
  return { rows: slice, page: p, pages, total, from: total ? start + 1 : 0, to: start + slice.length };
}
