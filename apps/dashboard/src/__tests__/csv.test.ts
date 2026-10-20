import { describe, expect, it } from 'vitest';
import { csvCell, csvFileName, pounds, toCsv } from '../csv';

describe('CSV export (L10N-007)', () => {
  it('starts with the byte-order mark and separates lines with CRLF, so Excel shows Arabic', () => {
    const out = toCsv(['المريض', 'الرصيد'], [['منى عبد الله', 1250.5]], ['الإجمالي', 1250.5]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out.slice(1)).toBe('المريض,الرصيد\r\nمنى عبد الله,1250.5\r\nالإجمالي,1250.5\r\n');
  });
  it('quotes commas, quotes, line breaks and edge spaces; empty cells stay empty', () => {
    expect(csvCell('مدينة نصر، القاهرة')).toBe('مدينة نصر، القاهرة'); // the Arabic comma is not a separator
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('قال "تمام"')).toBe('"قال ""تمام"""');
    expect(csvCell('سطر\nسطر')).toBe('"سطر\nسطر"');
    expect(csvCell(' x')).toBe('" x"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
  });
  it('a text that a spreadsheet would run as a formula stays text; numbers, negative ones too, stay numbers', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
    expect(csvCell('+201001234567')).toBe("'+201001234567");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(-150.25)).toBe('-150.25');
  });
  it('amounts are pounds; file names are plain', () => {
    expect(pounds(125050)).toBe(1250.5);
    expect(pounds(-2000)).toBe(-20);
    expect(csvFileName('revenue', 'by-method', '2026-10-01', '2026-10-20')).toBe('revenue_by-method_2026-10-01_2026-10-20.csv');
    expect(csvFileName('outstanding', undefined, 'x/y z')).toBe('outstanding_x-y-z.csv');
  });
});
