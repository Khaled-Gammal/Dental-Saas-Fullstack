/**
 * Phase 2A (SRS ONB-03): reads the first sheet of an .xlsx file in the browser, as text cells, for the patient import.
 *
 * Why not a library: the import needs only "the first sheet's cell values", and the common choices are either a large
 * dependency for that (exceljs, ~1 MB in the bundle) or a package whose npm release is old and has open advisories
 * (SheetJS 0.18, its maintained builds are not on npm). An .xlsx file is a ZIP of XML parts; the browser unzips with
 * DecompressionStream, and the few XML parts read here have a fixed, simple shape. Unit-tested against files written by
 * openpyxl and LibreOffice.
 *
 * Limits: the file is refused when the parts read would unpack past 60 MB (a "zip bomb"), when it is encrypted, or
 * when it is not a workbook. Formulas give their last computed value; dates come out as YYYY-MM-DD.
 */

export interface SheetRow { line: number; cells: string[] }

export class XlsxError extends Error {
  constructor(readonly code: 'not_xlsx' | 'encrypted' | 'too_large' | 'no_sheet' | 'too_many_rows') { super(code); }
}

const MAX_UNPACKED = 60 * 1024 * 1024;
/** Columns read per row: patient lists are a dozen columns; a stray cell at XFD (or a hostile ref) is ignored. */
export const MAX_COLS = 256;

interface ZipEntry { name: string; method: number; flags: number; compSize: number; size: number; localOffset: number }

function zipEntries(b: Uint8Array): Map<string, ZipEntry> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxError('not_xlsx');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, ZipEntry>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || v.getUint32(p, true) !== 0x02014b50) throw new XlsxError('not_xlsx');
    const nameLen = v.getUint16(p + 28, true);
    const e: ZipEntry = {
      flags: v.getUint16(p + 8, true), method: v.getUint16(p + 10, true), compSize: v.getUint32(p + 20, true),
      size: v.getUint32(p + 24, true), localOffset: v.getUint32(p + 42, true), name: dec.decode(b.subarray(p + 46, p + 46 + nameLen)),
    };
    out.set(e.name, e);
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return out;
}

async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel(); throw new XlsxError('too_large'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

class Zip {
  private budget = MAX_UNPACKED;
  constructor(private readonly bytes: Uint8Array, private readonly entries: Map<string, ZipEntry>) {}
  has(name: string) { return this.entries.has(name); }
  async text(name: string): Promise<string | null> {
    const e = this.entries.get(name);
    if (!e) return null;
    if (e.flags & 1) throw new XlsxError('encrypted');
    const v = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    const lo = e.localOffset;
    if (lo + 30 > this.bytes.length || v.getUint32(lo, true) !== 0x04034b50) throw new XlsxError('not_xlsx');
    const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
    const raw = this.bytes.subarray(start, start + e.compSize);
    let data: Uint8Array;
    if (e.method === 0) data = raw;
    else if (e.method === 8) data = await inflate(raw, this.budget);
    else throw new XlsxError('not_xlsx');
    this.budget -= data.length;
    if (this.budget < 0) throw new XlsxError('too_large');
    return new TextDecoder().decode(data);
  }
}

/**
 * The elements named `name` (any namespace prefix: x:row, row), in order, with their attribute text and inner XML
 * (null when self-closing). Linear: each element's end is found once, from where its start tag ends, so a file with an
 * unclosed tag cannot make the scan quadratic (an unclosed one stops the scan).
 */
function* elements(xml: string, name: string): Generator<{ attrs: string; inner: string | null; start: number; end: number }> {
  const open = new RegExp(`<(?:[\\w.-]+:)?${name}\\b([^>]*?)(/?)>`, 'g');
  const close = new RegExp(`</(?:[\\w.-]+:)?${name}\\s*>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml))) {
    if (m[2] === '/') { yield { attrs: m[1], inner: null, start: m.index, end: open.lastIndex }; continue; }
    close.lastIndex = open.lastIndex;
    const c = close.exec(xml);
    if (!c) return;
    yield { attrs: m[1], inner: xml.slice(open.lastIndex, c.index), start: m.index, end: close.lastIndex };
    open.lastIndex = close.lastIndex;
  }
}
const first = (xml: string, name: string) => { for (const e of elements(xml, name)) return e; return undefined; };

const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export const xmlText = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITY[e]);

/** The attributes of one start tag: `<c r="A1" t="s">` -> { r: 'A1', t: 's' } (namespace prefixes kept). */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = xmlText(m[3] ?? m[4] ?? '');
  return out;
}

/** All the text runs of a string item, without its phonetic guide (<rPh>). */
function runsText(xml: string): string {
  const skip = [...elements(xml, 'rPh')];
  let out = '';
  for (const t of elements(xml, 't')) if (!skip.some((r) => t.start >= r.start && t.end <= r.end)) out += xmlText(t.inner ?? '');
  return out;
}

/** The workbook's shared strings, in order (an empty <si/> keeps its place: the cells index into this list). */
export const sharedStrings = (xml: string): string[] => [...elements(xml, 'si')].map((e) => runsText(e.inner ?? ''));

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
/** A custom number format that shows a date: has d, m or y outside quotes and brackets (and is not just elapsed time). */
const isDateFormat = (code: string): boolean => {
  const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  return /[dy]/i.test(bare) || (/m/i.test(bare) && !/^[hms:.\s0]+$/i.test(bare));
};

function dateStyles(styles: string | null): boolean[] {
  if (!styles) return [];
  const custom = new Map<number, string>();
  for (const e of elements(styles, 'numFmt')) { const a = attrs(e.attrs); custom.set(Number(a.numFmtId), a.formatCode ?? ''); }
  const xfs = first(styles, 'cellXfs')?.inner ?? '';
  return [...elements(xfs, 'xf')].map((e) => {
    const id = Number(attrs(e.attrs).numFmtId ?? 0);
    return BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!));
  });
}

/** Excel's day number -> YYYY-MM-DD (1900 system: day 1 = 1900-01-01, with its 29 Feb 1900; or the 1904 system). */
export function serialToIso(serial: number, date1904 = false): string {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(base + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

const colIndex = (ref: string): number => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** A stored number as text without float noise or exponent: 1012345678, 12.5. */
const numberText = (v: string): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (Number.isInteger(n)) return Math.abs(n) < 1e21 ? n.toFixed(0) : v;
  return String(Number(n.toPrecision(15)));
};

function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = `xl/${target}`.split('/');
  const out: string[] = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
  return out.join('/');
}

/**
 * The first sheet of the workbook (in the workbook's order), as rows of text cells with their line numbers. Rows with
 * nothing in them (formatting only) are left out; more than `maxRows` rows with something in them is refused.
 */
export async function readXlsx(data: ArrayBuffer | Uint8Array, maxRows = Infinity): Promise<SheetRow[]> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // a password-protected workbook, and the old .xls format, are OLE compound files, not ZIPs
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) throw new XlsxError('encrypted');
  const zip = new Zip(bytes, zipEntries(bytes));
  const workbook = await zip.text('xl/workbook.xml');
  if (!workbook) throw new XlsxError('not_xlsx');
  const sheetTag = first(workbook, 'sheet');
  if (!sheetTag) throw new XlsxError('no_sheet');
  const rid = Object.entries(attrs(sheetTag.attrs)).find(([k]) => /(^|:)id$/.test(k) && k !== 'sheetId')?.[1];
  const rels = (await zip.text('xl/_rels/workbook.xml.rels')) ?? '';
  const rel = [...elements(rels, 'Relationship')].map((e) => attrs(e.attrs)).find((a) => a.Id === rid);
  const sheetPath = rel ? resolveTarget(rel.Target) : 'xl/worksheets/sheet1.xml';
  const sheet = await zip.text(sheetPath);
  if (!sheet) throw new XlsxError('no_sheet');
  const pr = first(workbook, 'workbookPr');
  const date1904 = !!pr && /^(1|true)$/.test(attrs(pr.attrs).date1904 ?? '');
  const shared = sharedStrings((await zip.text('xl/sharedStrings.xml')) ?? '');
  const isDate = dateStyles(await zip.text('xl/styles.xml'));

  const rows: SheetRow[] = [];
  let nextLine = 1;
  for (const r of elements(sheet, 'row')) {
    const ra = attrs(r.attrs);
    const line = ra.r ? Number(ra.r) : nextLine;
    nextLine = line + 1;
    const cells: string[] = [];
    let nextCol = 0;
    for (const c of elements(r.inner ?? '', 'c')) {
      const a = attrs(c.attrs);
      const col = a.r ? colIndex(a.r) : nextCol;
      nextCol = col + 1;
      if (col < 0 || col >= MAX_COLS) continue;
      const inner = c.inner ?? '';
      const v = first(inner, 'v')?.inner ?? undefined;
      let text = '';
      switch (a.t) {
        case 's': text = v !== undefined ? shared[Number(v)] ?? '' : ''; break;
        case 'inlineStr': text = runsText(first(inner, 'is')?.inner ?? ''); break;
        case 'str': text = v !== undefined ? xmlText(v) : ''; break;
        case 'b': text = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : ''; break;
        case 'e': text = ''; break; // #N/A, #REF!: nothing usable
        case 'd': text = v ? xmlText(v).slice(0, 10) : ''; break; // ISO date cell (rare)
        default:
          if (v === undefined) break;
          text = a.s !== undefined && isDate[Number(a.s)] && Number.isFinite(Number(v)) ? serialToIso(Number(v), date1904) : numberText(xmlText(v));
      }
      cells[col] = text;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    if (!cells.some((x) => x.trim())) continue; // formatting only
    if (rows.length >= maxRows) throw new XlsxError('too_many_rows');
    rows.push({ line, cells });
  }
  return rows;
}
