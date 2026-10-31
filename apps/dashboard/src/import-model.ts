import type { SheetRow } from './xlsx-reader';

/**
 * Phase 2A (SRS ONB-03): the patient import in the dashboard — reading a CSV file, guessing which column is which,
 * turning the sheet into the rows the API checks, and the report. Pure, unit-tested; the API does the real checking.
 */

export const IMPORT_FIELDS = [
  'fullName', 'phone', 'phoneAlt', 'email', 'gender', 'dateOfBirth', 'address', 'city', 'occupation', 'referralSource', 'notes',
  'guardianName', 'guardianPhone',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const REQUIRED_FIELDS: ImportField[] = ['fullName', 'phone'];

export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  fullName: 'الاسم', phone: 'الموبايل', phoneAlt: 'موبايل آخر', email: 'البريد الإلكتروني', gender: 'النوع', dateOfBirth: 'تاريخ الميلاد',
  address: 'العنوان', city: 'المدينة', occupation: 'المهنة', referralSource: 'كيف عرف بالعيادة', notes: 'ملاحظات',
  guardianName: 'اسم ولي الأمر', guardianPhone: 'موبايل ولي الأمر',
};

/**
 * Rows sent per request: at most 500 (the API takes 1,000) and at most ~600 KB of JSON (the API's body limit is 1 MB;
 * Arabic text takes 2 bytes a letter), so one batch is one short transaction.
 */
export const BATCH = 500;
export const BATCH_BYTES = 600 * 1024;
export const MAX_ROWS = 20_000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * CSV as Excel and Google Sheets save it: UTF-8 with or without a BOM, quoted cells with "" and line breaks inside,
 * CRLF or LF, and comma, semicolon (Excel in Arabic or European settings) or tab, whichever the header line uses most.
 * Line numbers are the file's records (a quoted cell with line breaks counts once).
 */
export function parseCsv(text: string): SheetRow[] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  const delim = counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const rows: SheetRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  const endCell = () => { cells.push(cell); cell = ''; };
  const endRow = () => { endCell(); rows.push({ line, cells }); cells = []; line++; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) endCell();
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; endRow(); }
    else cell += ch;
  }
  if (cell !== '' || cells.length) endRow();
  return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.:]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

/** Header words seen in clinics' own sheets (Arabic and English), per field. Compared after `norm`. */
const SYNONYMS: Record<ImportField, string[]> = {
  fullName: ['الاسم', 'اسمالمريض', 'الاسمبالكامل', 'الاسمالكامل', 'اسم', 'المريض', 'name', 'fullname', 'patientname', 'patient'],
  phone: ['الموبايل', 'موبايل', 'رقمالموبايل', 'الهاتف', 'هاتف', 'رقمالهاتف', 'التليفون', 'تليفون', 'الجوال', 'جوال', 'رقمالتليفون', 'phone', 'mobile', 'phonenumber', 'mobilenumber', 'tel', 'telephone', 'cell'],
  phoneAlt: ['موبايلاخر', 'هاتفاخر', 'رقماخر', 'هاتف2', 'موبايل2', 'تليفون2', 'phone2', 'mobile2', 'altphone', 'otherphone', 'secondphone'],
  email: ['البريد', 'البريدالالكتروني', 'الايميل', 'ايميل', 'email', 'mail', 'emailaddress'],
  gender: ['النوع', 'الجنس', 'نوع', 'جنس', 'gender', 'sex'],
  dateOfBirth: ['تاريخالميلاد', 'الميلاد', 'تاريخميلاد', 'dob', 'dateofbirth', 'birthdate', 'birthday', 'birth'],
  address: ['العنوان', 'عنوان', 'address'],
  city: ['المدينه', 'مدينه', 'المحافظه', 'city', 'governorate'],
  occupation: ['المهنه', 'الوظيفه', 'مهنه', 'وظيفه', 'occupation', 'job', 'profession'],
  referralSource: ['كيفعرفنا', 'مصدرالحجز', 'المصدر', 'مصدر', 'referral', 'source', 'referralsource', 'howdidyouhear'],
  notes: ['ملاحظات', 'ملاحظه', 'notes', 'note', 'comments', 'remarks'],
  guardianName: ['وليالامر', 'اسموليالامر', 'guardian', 'guardianname', 'parent', 'parentname'],
  guardianPhone: ['موبايلوليالامر', 'هاتفوليالامر', 'guardianphone', 'parentphone'],
};

export type Mapping = Partial<Record<ImportField, number>>;

/**
 * Which column is which, from the header row: an exact synonym first, then a header that contains one (longest first,
 * so "موبايل ولي الأمر" goes to the guardian, not to the patient's phone). A column is used once.
 */
export function guessMapping(headers: string[]): Mapping {
  const h = headers.map((x) => norm(x ?? ''));
  const out: Mapping = {};
  const used = new Set<number>();
  const pick = (field: ImportField, i: number) => { out[field] = i; used.add(i); };
  for (const f of IMPORT_FIELDS) {
    const i = h.findIndex((x, idx) => !used.has(idx) && x !== '' && SYNONYMS[f].includes(x));
    if (i >= 0) pick(f, i);
  }
  const loose = IMPORT_FIELDS.flatMap((f) => SYNONYMS[f].map((s) => [f, s] as const)).filter(([, s]) => s.length >= 3).sort((a, b) => b[1].length - a[1].length);
  for (const [f, s] of loose) {
    if (out[f] !== undefined) continue;
    const i = h.findIndex((x, idx) => !used.has(idx) && x.includes(s));
    if (i >= 0) pick(f, i);
  }
  return out;
}

export type ImportRow = { row: number } & Partial<Record<ImportField, string>>;

/**
 * The rows after the header, as the API takes them: only mapped fields, blank rows left out, cells trimmed. Day/month
 * dates are turned into YYYY-MM-DD here with the column's order (`dates`), the one thing the API cannot know.
 */
export function toImportRows(sheet: SheetRow[], headerIndex: number, mapping: Mapping, dates: 'dmy' | 'mdy' = 'dmy'): ImportRow[] {
  const fields = IMPORT_FIELDS.filter((f) => mapping[f] !== undefined);
  return sheet.slice(headerIndex + 1).flatMap((r) => {
    const out: ImportRow = { row: r.line };
    let any = false;
    for (const f of fields) {
      let v = (r.cells[mapping[f]!] ?? '').trim();
      if (v && f === 'dateOfBirth') v = isoFromOrder(v, dates);
      if (v) { out[f] = v.slice(0, 2100); any = true; }
    }
    return any ? [out] : [];
  });
}

/** The first row that has something in it (a sheet may start with a title or blank lines above the header). */
export function headerRowIndex(sheet: SheetRow[]): number {
  const i = sheet.findIndex((r) => r.cells.filter((c) => c.trim()).length >= 2);
  return i < 0 ? 0 : i;
}

export function chunks<T>(xs: T[], size: number, maxBytes = Infinity): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  const enc = new TextEncoder();
  for (const x of xs) {
    const b = maxBytes === Infinity ? 0 : enc.encode(JSON.stringify(x)).length + 1;
    if (cur.length && (cur.length >= size || bytes + b > maxBytes)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(x);
    bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Arabic counting: مريض واحد، مريضان، 3–10 مرضى، 11–99 مريضًا، 100 مريض (and 0 مريض). */
export const patientsText = (n: number, fmt: (n: number) => string = String): string => {
  if (n === 1) return 'مريض واحد';
  if (n === 2) return 'مريضان';
  const r = n % 100;
  return `${fmt(n)} ${r >= 3 && r <= 10 ? 'مرضى' : r >= 11 ? 'مريضًا' : 'مريض'}`;
};

const DMY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T].*)?$/;

/**
 * How a date column is written: day first (Egypt), month first (a sheet saved with US settings), or unknown when every
 * value fits both (then the clinic is asked). Values over 12 decide it.
 */
export function dateOrder(values: string[]): 'dmy' | 'mdy' | 'ambiguous' | 'none' {
  let dayFirst = false, monthFirst = false, any = false;
  for (const v of values) {
    const m = DMY.exec(v.trim());
    if (!m) continue;
    any = true;
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[2]) > 12) monthFirst = true;
  }
  if (!any) return 'none';
  if (dayFirst && !monthFirst) return 'dmy';
  if (monthFirst && !dayFirst) return 'mdy';
  return 'ambiguous';
}

/** "15/3/1990" (dmy) or "3/15/1990" (mdy) -> "1990-03-15"; anything else is sent as it is (the API judges it). */
export function isoFromOrder(v: string, order: 'dmy' | 'mdy'): string {
  const m = DMY.exec(v.trim());
  if (!m) return v.trim();
  const [d, mo] = order === 'dmy' ? [m[1], m[2]] : [m[2], m[1]];
  return `${m[3]}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export type RowResult =
  | { row: number; status: 'new'; key: string }
  | { row: number; status: 'duplicate'; fileNo: number | null; sameAsRow: number | null }
  | { row: number; status: 'invalid'; errors: { field: ImportField; code: 'required' | 'invalid' | 'too_long' }[] };

/**
 * The whole file's report from its batches' reports. The API sees one batch at a time, so the same person in two
 * batches is "new" twice there; here the later one becomes a duplicate of the first (the import itself would skip it
 * anyway, the person exists by then).
 */
export function mergeReports(batches: RowResult[][]): { rows: RowResult[]; counts: { new: number; duplicate: number; invalid: number } } {
  const seen = new Map<string, number>();
  const rows = batches.flat().map((r): RowResult => {
    if (r.status !== 'new') return r;
    const first = seen.get(r.key);
    if (first !== undefined) return { row: r.row, status: 'duplicate', fileNo: null, sameAsRow: first };
    seen.set(r.key, r.row);
    return r;
  });
  const count = (s: RowResult['status']) => rows.filter((r) => r.status === s).length;
  return { rows, counts: { new: count('new'), duplicate: count('duplicate'), invalid: count('invalid') } };
}

const ERROR_TEXT: Record<'required' | 'invalid' | 'too_long', string> = { required: 'ناقص', invalid: 'غير صالح', too_long: 'أطول من المسموح' };

/** "الموبايل: ناقص، البريد الإلكتروني: غير صالح" */
export const rowProblem = (r: RowResult): string =>
  r.status === 'invalid' ? r.errors.map((e) => `${IMPORT_FIELD_LABEL[e.field]}: ${ERROR_TEXT[e.code]}`).join('، ')
    : r.status === 'duplicate' ? (r.fileNo ? `مسجّل بالفعل (ملف رقم ${r.fileNo})` : `مكرر للسطر ${r.sameAsRow} في الملف`) : '';

/** The template a clinic can fill in: the headers the guesser knows, and one example row. */
export const TEMPLATE_HEAD = ['الاسم', 'الموبايل', 'موبايل آخر', 'البريد الإلكتروني', 'النوع', 'تاريخ الميلاد', 'العنوان', 'المدينة', 'المهنة', 'ملاحظات'];
export const TEMPLATE_EXAMPLE = ['محمد أحمد علي', '01012345678', '', 'm.ahmed@example.com', 'ذكر', '15/03/1990', '12 شارع التحرير', 'القاهرة', 'مهندس', ''];
