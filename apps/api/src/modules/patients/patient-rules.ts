/** Pure patient rules: no Nest, no database. Unit-tested in __tests__/patient-rules.spec.ts. */
import { toAsciiDigits } from '../../shared/phone';

export type PatientSearch =
  | { kind: 'all' }
  /** a full mobile number, normalised to E.164 */
  | { kind: 'phone'; e164: string }
  /** the start of a number typed in local form ("0101…" -> "+20101") or the start of an E.164 number */
  | { kind: 'phonePrefix'; prefix: string }
  /** a short number: the clinic's file number, or the start of a phone */
  | { kind: 'fileOrPhone'; fileNo: number; prefix: string }
  | { kind: 'name'; text: string };

/**
 * What the receptionist typed: a name, a file number or (part of) a phone. Arabic-Indic digits work.
 * Egyptian mobiles are +20 1x xxxx xxxx; "01012345678", "201012345678" and "+201012345678" are the same number.
 */
export function classifySearch(raw: string | undefined): PatientSearch {
  const q = toAsciiDigits(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!q) return { kind: 'all' };
  const digits = q.replace(/[\s()-]/g, '');
  if (/^\+?\d+$/.test(digits)) {
    const d = digits.replace(/^\+/, '');
    const local = d.startsWith('0') ? `+20${d.slice(1)}` : d.startsWith('20') ? `+${d}` : null;
    if (local && /^\+201\d{9}$/.test(local)) return { kind: 'phone', e164: local };
    // a leading "+" or "0" can only be a phone; a short bare number is most likely a file number
    if (d.length <= 7 && !digits.startsWith('+') && !d.startsWith('0')) return { kind: 'fileOrPhone', fileNo: Number(d), prefix: `+${d}` };
    return { kind: 'phonePrefix', prefix: local ?? `+${d}` };
  }
  return { kind: 'name', text: q.slice(0, 120) };
}

/** `%`, `_` and `\` are literal in a name search. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Opaque keyset cursor for the newest-first list: created_at + id, so equal timestamps never skip or repeat rows. */
export const encodeCursor = (createdAt: Date, id: string) => Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
export function decodeCursor(c: string | undefined): { createdAt: Date; id: string } | null {
  if (!c) return null;
  const [iso, id] = Buffer.from(c, 'base64url').toString().split('|');
  const createdAt = new Date(iso ?? '');
  return !Number.isNaN(createdAt.getTime()) && /^[0-9a-f-]{36}$/i.test(id ?? '') ? { createdAt, id } : null;
}

/** Whole years between a 'YYYY-MM-DD' birth date and `today` (also 'YYYY-MM-DD'). */
export function ageOn(dob: string | null, today: string): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

/** Fields whose values are personal free text: the audit row says they changed, not what they say. */
const SECRET_FIELDS = new Set(['notes', 'address', 'allergies', 'conditions', 'medications', 'is_pregnant', 'is_smoker']);

/**
 * The audit `changes` object for an update: {"field": [old, new]} for fields that really changed, `true` for
 * free-text and medical fields (SRS 6.9: no medical free text in the audit log).
 */
export function auditChanges(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) {
    const old = before[k];
    if (JSON.stringify(old ?? null) === JSON.stringify(v ?? null)) continue;
    out[k] = SECRET_FIELDS.has(k) ? true : [old ?? null, v ?? null];
  }
  return out;
}

/** Booking-created patients carry this tag until reception checks the record (SRS BOOK-11). */
export const NEEDS_REVIEW = 'needs_review';

/** Tags from free text: trimmed, unique, at most 10 of 30 characters; the review tag is managed by the API only. */
export const cleanTags = (tags: string[]) =>
  Array.from(new Set(tags.map((t) => t.trim()).filter((t) => t && t !== NEEDS_REVIEW).map((t) => t.slice(0, 30)))).slice(0, 10);

/** Medical list items ("penicillin", "diabetes"): trimmed, unique case-insensitively, at most 30 of 80 characters. */
export function cleanList(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.trim().slice(0, 80);
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.slice(0, 30);
}

/** The record fields a merge compares (SRS PATIENT-003): the survivor's value is kept, a different one is listed. */
export const MERGE_FIELDS = ['full_name', 'phone', 'phone_alt', 'email', 'date_of_birth', 'gender', 'address', 'city', 'occupation',
  'guardian_name', 'guardian_phone', 'guardian_relation', 'notes'] as const;

const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const empty = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

/**
 * CLR-15: fields where both records have a value and the values differ. The survivor keeps its own; the user sees
 * the other before confirming (the merged record keeps it too, it is never deleted).
 */
export function mergeConflicts<T extends Record<string, unknown>>(survivor: T, merged: T, fields: readonly (keyof T & string)[]) {
  return fields.filter((f) => !empty(survivor[f]) && !empty(merged[f]) && !same(survivor[f], merged[f]))
    .map((f) => ({ field: f, survivor: survivor[f], merged: merged[f] }));
}

/** Two lists as one, the first spelling kept, no repeats ignoring case and spaces (same rule as `text_array_union`). */
export function unionList(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((x) => { const k = x.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
