/**
 * CSV export of report tables (L10N-007: UTF-8 with a byte-order mark, so Excel shows Arabic). Pure except
 * `downloadCsv`, so the format is unit-tested. Numbers stay numbers (amounts in pounds, not formatted), dates stay
 * YYYY-MM-DD, and a text cell that a spreadsheet would run as a formula (=, +, -, @, tab, CR) is written as text.
 */
export type CsvCell = string | number | null | undefined;

const BOM = '﻿';

/** A spreadsheet runs a cell starting with these as a formula; a leading apostrophe keeps it text (OWASP CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const text = FORMULA_START.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Header row, data rows and an optional total row, CRLF-separated (what Excel expects), with the BOM in front. */
export function toCsv(head: readonly string[], rows: readonly (readonly CsvCell[])[], foot?: readonly CsvCell[]): string {
  const lines = [head, ...rows, ...(foot ? [foot] : [])].map((r) => r.map(csvCell).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** Minor units as a plain number of pounds for a spreadsheet (2 decimals at most). */
export const pounds = (minor: number): number => Math.round(minor) / 100;

/** A safe file name: letters, digits and dashes only, `.csv` added. */
export const csvFileName = (...parts: (string | undefined)[]): string =>
  `${parts.filter(Boolean).join('_').replace(/[^A-Za-z0-9_-]+/g, '-')}.csv`;

/** Saves the text as a file through a temporary link (no server round trip; the data is what the screen shows). */
export function downloadCsv(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
