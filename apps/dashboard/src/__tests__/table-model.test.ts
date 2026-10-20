import { describe, expect, it } from 'vitest';
import { nextSort, paginate, searchKey, searchRows, sortRows } from '../table-model';

const people = [
  { name: 'منى عبد الله', file: 5, visit: '2026-10-01' },
  { name: 'أحمد صلاح', file: 12, visit: null },
  { name: 'Omar Khaled', file: 1, visit: '2026-09-15' },
  { name: 'إيمان مصطفى', file: 2, visit: '2026-10-20' },
];

describe('the data table logic (redesign R2)', () => {
  it('a header click sorts ascending, then descending, then back to the table\'s order', () => {
    expect(nextSort(null, 'name')).toEqual({ id: 'name', dir: 'asc' });
    expect(nextSort({ id: 'name', dir: 'asc' }, 'name')).toEqual({ id: 'name', dir: 'desc' });
    expect(nextSort({ id: 'name', dir: 'desc' }, 'name')).toBeNull();
    expect(nextSort({ id: 'name', dir: 'desc' }, 'file')).toEqual({ id: 'file', dir: 'asc' });
  });
  it('sorts numbers by value, text in dictionary order, and keeps empty values last either way', () => {
    expect(sortRows(people, (p) => p.file, 'asc').map((p) => p.file)).toEqual([1, 2, 5, 12]); // 12 after 5, not before
    expect(sortRows(people, (p) => p.file, 'desc').map((p) => p.file)).toEqual([12, 5, 2, 1]);
    expect(sortRows(people, (p) => p.visit, 'asc').map((p) => p.visit)).toEqual(['2026-09-15', '2026-10-01', '2026-10-20', null]);
    expect(sortRows(people, (p) => p.visit, 'desc').map((p) => p.visit)).toEqual(['2026-10-20', '2026-10-01', '2026-09-15', null]);
    expect(sortRows(people, (p) => p.name, 'asc')[0].name).toBe('أحمد صلاح');
    expect(sortRows(people, undefined, 'asc')).toEqual(people); // not sortable: as given
  });
  it('search ignores how a word was typed: alef forms, ya/alef maqsura, ta marbuta, tashkeel, Arabic digits, case', () => {
    expect(searchKey('إيمان')).toBe(searchKey('ايمان'));
    expect(searchKey('مصطفى')).toBe(searchKey('مصطفي'));
    expect(searchKey('عيادة')).toBe(searchKey('عياده'));
    expect(searchKey('مُنى')).toBe('مني');
    expect(searchKey('٠١٠١٢')).toBe('01012');
    expect(searchRows(people, 'ايمان', (p) => p.name).map((p) => p.name)).toEqual(['إيمان مصطفى']);
    expect(searchRows(people, 'omar KHALED', (p) => p.name)).toHaveLength(1);
    expect(searchRows(people, 'عبد منى', (p) => p.name)).toHaveLength(1); // every word, any order
    expect(searchRows(people, '  ', (p) => p.name)).toHaveLength(4);
  });
  it('pages: the range shown, and a page past the end shows the last one', () => {
    const rows = Array.from({ length: 23 }, (_, i) => i + 1);
    expect(paginate(rows, 1, 10)).toMatchObject({ page: 1, pages: 3, total: 23, from: 1, to: 10 });
    expect(paginate(rows, 3, 10)).toMatchObject({ rows: [21, 22, 23], from: 21, to: 23 });
    expect(paginate(rows, 9, 10).page).toBe(3);
    expect(paginate([], 1, 10)).toMatchObject({ rows: [], pages: 1, total: 0, from: 0, to: 0 });
  });
});
