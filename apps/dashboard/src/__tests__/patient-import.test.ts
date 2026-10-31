import { describe, expect, it } from 'vitest';
import { chunks, dateOrder, guessMapping, headerRowIndex, isoFromOrder, mergeReports, parseCsv, patientsText, rowProblem, toImportRows, type RowResult } from '../import-model';
import { readXlsx, serialToIso, sharedStrings, XlsxError } from '../xlsx-reader';
import { LIBREOFFICE_XLSX, OPENPYXL_XLSX } from './fixtures-xlsx';

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

describe('reading .xlsx files (Phase 2A)', () => {
  for (const [name, file] of [['openpyxl', OPENPYXL_XLSX], ['LibreOffice', LIBREOFFICE_XLSX]] as const) {
    it(`reads the first sheet of a ${name} workbook: Arabic text, entities, numbers without float noise, dates as YYYY-MM-DD`, async () => {
      const rows = await readXlsx(bytes(file));
      const byLine = Object.fromEntries(rows.map((r) => [r.line, r.cells]));
      expect(byLine[1][0]).toBe('قائمة مرضى العيادة');
      expect(byLine[3]).toEqual(['الاسم', 'رقم الموبايل', 'النوع', 'تاريخ الميلاد', 'ملاحظات', 'المدينة']);
      expect(byLine[4]).toEqual(['سارة محمود', '1012345678', 'أنثى', '1990-03-15', 'حساسية & "بنسلين" <مهم>', 'القاهرة']);
      expect(byLine[5].slice(0, 4)).toEqual(['Omar Khaled', '01098765432', 'M', '1985-12-01']);
      expect(byLine[7].slice(0, 5)).toEqual(['كريم', '201055555555', '', '15/3/1990', '12.5']);
      expect(rows.some((r) => r.cells.includes('should'))).toBe(false); // the second sheet is not read
    });
  }
  it('the formula keeps its computed value where the file has one (LibreOffice)', async () => {
    const rows = await readXlsx(bytes(LIBREOFFICE_XLSX));
    expect(rows.find((r) => r.line === 7)?.cells[5]).toBe('القاهرة');
  });
  it('refuses what is not a workbook', async () => {
    await expect(readXlsx(new TextEncoder().encode('name,phone\nx,y'))).rejects.toBeInstanceOf(XlsxError);
  });
  it('shared strings: an empty item keeps its place, rich-text runs join, phonetic guides are dropped, any namespace prefix', () => {
    expect(sharedStrings('<sst><si><t>A</t></si><si/><si><r><t>B</t></r><r><t xml:space="preserve"> C</t></r><rPh><t>x</t></rPh></si><x:si><x:t>D&amp;E</x:t></x:si><si><t/></si></sst>'))
      .toEqual(['A', '', 'B C', 'D&E', '']);
  });
  it('an unclosed tag stops the scan instead of taking forever', () => {
    const started = Date.now();
    expect(sharedStrings('<si><t>A'.repeat(50_000))).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
  });
  it('the old .xls format and password-protected workbooks are told apart from a broken file', async () => {
    await expect(readXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).rejects.toBeInstanceOf(XlsxError);
  });
  it('Excel day numbers, both date systems', () => {
    expect(serialToIso(32947)).toBe('1990-03-15');
    expect(serialToIso(31485, true)).toBe('1990-03-15');
  });
});

describe('reading CSV files (Phase 2A)', () => {
  it('BOM, quotes with commas, "" and line breaks inside, CRLF', () => {
    const rows = parseCsv('﻿الاسم,الموبايل,ملاحظات\r\n"علي, محمد",01012345678,"قال ""مرحبا""\r\nسطر ثان"\r\nمنى,010,\r\n');
    expect(rows).toEqual([
      { line: 1, cells: ['الاسم', 'الموبايل', 'ملاحظات'] },
      { line: 2, cells: ['علي, محمد', '01012345678', 'قال "مرحبا"\r\nسطر ثان'] },
      { line: 3, cells: ['منى', '010', ''] },
    ]);
  });
  it('semicolons or tabs when the header uses them (Excel in other regional settings)', () => {
    expect(parseCsv('name;phone\nA;1').map((r) => r.cells)).toEqual([['name', 'phone'], ['A', '1']]);
    expect(parseCsv('name\tphone\nA\t1').map((r) => r.cells)).toEqual([['name', 'phone'], ['A', '1']]);
  });
});

describe('mapping the columns and building the rows (Phase 2A)', () => {
  it('guesses Arabic and English headers; the guardian\'s phone is not the patient\'s', () => {
    expect(guessMapping(['م', 'اسم المريض', 'رقم الموبايل', 'موبايل ولي الأمر', 'تاريخ الميلاد', 'Gender', 'E-mail', 'ملاحظة'])).toEqual({
      fullName: 1, phone: 2, guardianPhone: 3, dateOfBirth: 4, gender: 5, email: 6, notes: 7,
    });
    expect(guessMapping(['Name', 'Mobile', 'Phone 2', 'City'])).toEqual({ fullName: 0, phone: 1, phoneAlt: 2, city: 3 });
  });
  it('finds the header under a title, keeps the file\'s line numbers, skips blank rows', () => {
    const sheet = [{ line: 1, cells: ['قائمة المرضى'] }, { line: 3, cells: ['الاسم', 'الموبايل', 'المدينة'] },
      { line: 4, cells: ['سارة', '1012345678', ' القاهرة '] }, { line: 5, cells: ['', '', ''] }, { line: 6, cells: ['منى', '01012345679'] }];
    const h = headerRowIndex(sheet);
    expect(h).toBe(1);
    expect(toImportRows(sheet, h, { fullName: 0, phone: 1, city: 2 })).toEqual([
      { row: 4, fullName: 'سارة', phone: '1012345678', city: 'القاهرة' }, { row: 6, fullName: 'منى', phone: '01012345679' },
    ]);
  });
  it('date columns: the order is read from values over 12; asked when every value fits both', () => {
    expect(dateOrder(['15/3/1990', '1/2/1980'])).toBe('dmy');
    expect(dateOrder(['3/15/1990', '1/2/1980 00:00'])).toBe('mdy');
    expect(dateOrder(['5/3/1990', '1/2/1980'])).toBe('ambiguous');
    expect(dateOrder(['1990-03-05', ''])).toBe('none');
    expect([isoFromOrder('5/3/1990', 'dmy'), isoFromOrder('5/3/1990', 'mdy'), isoFromOrder('1990-03-05', 'mdy')]).toEqual(['1990-03-05', '1990-05-03', '1990-03-05']);
    const sheet = [{ line: 1, cells: ['الاسم', 'تاريخ الميلاد'] }, { line: 2, cells: ['سارة', '5/3/1990'] }];
    expect(toImportRows(sheet, 0, { fullName: 0, dateOfBirth: 1 }, 'mdy')).toEqual([{ row: 2, fullName: 'سارة', dateOfBirth: '1990-05-03' }]);
  });
  it('batches by count and by size (Arabic text is 2 bytes a letter)', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    const big = Array.from({ length: 6 }, (_, i) => ({ row: i, notes: 'ب'.repeat(100) }));
    expect(chunks(big, 100, 500).map((c) => c.length)).toEqual([2, 2, 2]);
    expect([patientsText(1), patientsText(2), patientsText(7), patientsText(25)]).toEqual(['مريض واحد', 'مريضان', '7 مرضى', '25 مريضًا']);
  });
  it('the whole-file report: the same person in two batches counts once', () => {
    const a: RowResult[] = [{ row: 2, status: 'new', key: 'k1' }, { row: 3, status: 'invalid', errors: [{ field: 'phone', code: 'required' }] }];
    const b: RowResult[] = [{ row: 4, status: 'new', key: 'k1' }, { row: 5, status: 'duplicate', fileNo: 7, sameAsRow: null }];
    const r = mergeReports([a, b]);
    expect(r.counts).toEqual({ new: 1, duplicate: 2, invalid: 1 });
    expect(r.rows[2]).toEqual({ row: 4, status: 'duplicate', fileNo: null, sameAsRow: 2 });
    expect(rowProblem(r.rows[1])).toBe('الموبايل: ناقص');
    expect(rowProblem(r.rows[2])).toBe('مكرر للسطر 2 في الملف');
    expect(rowProblem(r.rows[3])).toBe('مسجّل بالفعل (ملف رقم 7)');
  });
});
