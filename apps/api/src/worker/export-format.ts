/**
 * The shape of a clinic's data export (H8, NFR-08): which tables and columns go in, and how a value is written. Pure;
 * unit-tested. The ZIP holds `csv/<table>.csv` (opens in Excel), `json/<table>.json` (for moving to another system),
 * `files/<kind>/<id>.<ext>` (every uploaded file) and an Arabic `README.txt`.
 */

/** Tables with a tenant_id that are the platform's or the system's, not the clinic's data. */
export const EXPORT_SKIP_TABLES = new Set([
  'refresh_tokens', 'outbox_events', 'webhook_events', 'platform_audit_log', 'platform_tenant_notes', 'platform_invoices',
  'tenant_counters', 'usage_counters', 'data_exports', 'in_app_notifications', 'legal_acceptances',
]);

/** Never exported: password hashes, encrypted secrets, tokens and codes (an export is read outside the system). */
const SECRET_COLUMN = /(hash|_enc$|secret|token|password|credentials)/i;
export const isSecretColumn = (name: string) => SECRET_COLUMN.test(name);

/** The columns of one table that go into the export, in the table's order. */
export function exportColumns(columns: { name: string; type: string }[]): string[] {
  return columns.filter((c) => c.type !== 'bytea' && !isSecretColumn(c.name)).map((c) => c.name);
}

/** One value as text: dates in ISO 8601 (UTC), JSON values as JSON, nothing for NULL. */
export function textValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * A CSV cell: quoted when needed, and a value starting with = + - @ or a tab/return is prefixed with ' so a spreadsheet
 * shows it as text and never runs it as a formula (the same rule as the dashboard's report export).
 */
export function csvCell(v: unknown): string {
  let s = textValue(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvLine = (cells: unknown[]) => `${cells.map(csvCell).join(',')}\r\n`;
/** UTF-8 byte order mark: Excel then reads the Arabic text correctly. */
export const CSV_BOM = '﻿';

/** A row as JSON, values in the same form as the CSV (dates ISO, numbers as stored). */
export function jsonRow(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) {
    const v = row[c];
    out[c] = v instanceof Date ? v.toISOString() : v ?? null;
  }
  return out;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/gif': 'gif', 'application/pdf': 'pdf',
};
const SAFE = /^[a-z0-9_-]+$/;

/**
 * Where an uploaded file goes in the ZIP and which stored object it is read from. Website images keep only their
 * renditions (the original is not stored): the widest one is exported.
 */
export function exportedFile(f: { id: string; kind: string; object_key: string; mime_type: string; variant_widths: number[] | null }): { key: string; path: string } {
  const kind = SAFE.test(f.kind) ? f.kind : 'other';
  const widths = f.variant_widths ?? [];
  if (widths.length) return { key: `${f.object_key}/${Math.max(...widths)}.webp`, path: `files/${kind}/${f.id}.webp` };
  return { key: f.object_key, path: `files/${kind}/${f.id}.${EXT[f.mime_type] ?? 'bin'}` };
}

/** What a clinic owner reads first when they open the ZIP. */
export function readme(clinicName: string, createdAt: Date, tables: { name: string; rows: number }[], files: number, missing: number): string {
  const lines = [
    `نسخة كاملة من بيانات «${clinicName}»`,
    `أُنشئت في ${createdAt.toISOString()} (بالتوقيت العالمي UTC).`,
    '',
    'محتويات الملف:',
    '- المجلد csv: ملف لكل نوع من البيانات، يفتح في Excel.',
    '- المجلد json: نفس البيانات بصيغة JSON، لنقلها إلى نظام آخر.',
    '- المجلد files: كل الملفات المرفوعة (الأشعة والصور والمستندات)، ودليلها في csv/files_index.csv.',
    '',
    'ملاحظات:',
    '- المبالغ المالية في الأعمدة المنتهية بـ _minor مكتوبة بالقرش: اقسمها على 100 لتحصل على الجنيه.',
    '- التواريخ والأوقات بالتوقيت العالمي (UTC)؛ توقيت القاهرة يزيد ساعتين أو ثلاثًا.',
    '- كلمات المرور والرموز السرية لا تُصدَّر أبدًا.',
    '- هذا الملف يحتوي على بيانات طبية وشخصية للمرضى: احفظه في مكان آمن ولا ترسله لأحد.',
    '',
    `الجداول (${tables.length}):`,
    ...tables.map((t) => `- ${t.name}: ${t.rows}`),
    '',
    `الملفات: ${files}${missing ? ` (تعذّر العثور على ${missing} منها في التخزين؛ مذكورة في csv/files_index.csv)` : ''}`,
  ];
  return `${lines.join('\r\n')}\r\n`;
}
