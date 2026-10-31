import { normalizePhone, toAsciiDigits } from '../../shared/phone';

/**
 * Phase 2A (SRS ONB-03): reading one row of a clinic's patient list from Excel/CSV. Pure, unit-tested.
 *
 * The dashboard maps the file's columns to these fields and sends each row's text as typed in the file; everything is
 * normalised here, once, so the dry run and the import judge a row the same way. Lenient where spreadsheets are
 * messy (Arabic digits, a phone that lost its leading 0 when Excel stored it as a number, "ذكر"/"M", 15/3/1990),
 * strict where a wrong value would mislead (an impossible date, an email without a domain).
 */
export const IMPORT_FIELDS = [
  'fullName', 'phone', 'phoneAlt', 'email', 'gender', 'dateOfBirth', 'address', 'city', 'occupation', 'referralSource', 'notes',
  'guardianName', 'guardianPhone',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type RawRow = Partial<Record<ImportField, string | null>>;

export type ImportErrorCode = 'required' | 'invalid' | 'too_long';
export interface FieldError { field: ImportField; code: ImportErrorCode }

/** A row ready to store (patients columns). */
export interface ImportPatient {
  full_name: string; phone: string; phone_alt: string | null; email: string | null; gender: 'male' | 'female' | null;
  date_of_birth: string | null; address: string | null; city: string | null; occupation: string | null; referral_source: string | null;
  notes: string | null; guardian_name: string | null; guardian_phone: string | null;
}

const TEXT_MAX: Partial<Record<ImportField, number>> = { address: 300, city: 80, occupation: 80, referralSource: 60, notes: 2000 };

const clean = (v: string | null | undefined): string => (v ?? '').replace(/\s+/g, ' ').trim();
/** Notes and addresses keep their line breaks (as the patient form does); spaces inside each line are tidied. */
const cleanLines = (v: string | null | undefined): string =>
  (v ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const MULTILINE: ImportField[] = ['address', 'notes'];

/**
 * A phone as spreadsheets mangle it: Excel keeps 01012345678 as the number 1012345678, and +20 numbers often arrive
 * without the "+". Then the API's one normaliser (E.164).
 */
export function importPhone(raw: string): string | null {
  let p = toAsciiDigits(raw).replace(/[\s\-().]/g, '');
  if (/^1[0125]\d{8}$/.test(p)) p = `0${p}`; // an Egyptian mobile that lost its leading 0
  else if (/^201[0125]\d{8}$/.test(p)) p = `+${p}`; // 20 1x… without the plus
  return normalizePhone(p);
}

const GENDER = new Map<string, 'male' | 'female'>([
  ['male', 'male'], ['m', 'male'], ['ذكر', 'male'], ['ذ', 'male'], ['رجل', 'male'], ['ولد', 'male'],
  ['female', 'female'], ['f', 'female'], ['أنثى', 'female'], ['انثى', 'female'], ['انثي', 'female'], ['أنثي', 'female'], ['ث', 'female'], ['امرأة', 'female'], ['بنت', 'female'],
]); // a Map, not an object: "constructor" or "__proto__" in a cell is not a gender
export const importGender = (raw: string): 'male' | 'female' | null | undefined => {
  const v = clean(raw).toLowerCase();
  return v === '' ? null : GENDER.get(v); // undefined = not understood
};

/**
 * A birth date: 1990-03-15, 1990/3/15, 15/3/1990, 15-03-1990, 15.3.1990 (day first, as Egypt writes it). Must be a
 * real day, after 1900 and not in the future. Excel's own date numbers are turned into YYYY-MM-DD by the dashboard.
 */
export function importDate(raw: string, today: string): string | null | undefined {
  const v = toAsciiDigits(clean(raw)).replace(/[ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i, ''); // "1990-03-15 00:00:00"
  if (!v) return null;
  let y: number, m: number, d: number;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return undefined;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined; // 31/2
  const iso = date.toISOString().slice(0, 10);
  return iso >= '1900-01-01' && iso <= today ? iso : undefined;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** One row: the record to store, or what is wrong with it (every problem, not just the first). */
export function parseImportRow(raw: RawRow, today: string): { patient: ImportPatient; errors: [] } | { patient: null; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const err = (field: ImportField, code: ImportErrorCode) => errors.push({ field, code });
  const text = (field: ImportField): string | null => {
    const v = MULTILINE.includes(field) ? cleanLines(raw[field]) : clean(raw[field]);
    if (!v) return null;
    const max = TEXT_MAX[field];
    if (max && v.length > max) { err(field, 'too_long'); return null; }
    return v;
  };
  const name = (field: 'fullName' | 'guardianName', required: boolean): string | null => {
    const v = clean(raw[field]);
    if (!v) { if (required) err(field, 'required'); return null; }
    if (v.length < 2) { err(field, 'invalid'); return null; }
    if (v.length > 120) { err(field, 'too_long'); return null; }
    return v;
  };
  const phone = (field: 'phone' | 'phoneAlt' | 'guardianPhone', required: boolean): string | null => {
    const v = clean(raw[field]);
    if (!v) { if (required) err(field, 'required'); return null; }
    const p = importPhone(v);
    if (!p) err(field, 'invalid');
    return p;
  };

  const full_name = name('fullName', true);
  const mainPhone = phone('phone', true);
  const phone_alt = phone('phoneAlt', false);
  const guardian_phone = phone('guardianPhone', false);
  const guardian_name = name('guardianName', false);
  const emailRaw = clean(raw.email).toLowerCase();
  const email = emailRaw ? (EMAIL.test(emailRaw) && emailRaw.length <= 254 ? emailRaw : (err('email', 'invalid'), null)) : null;
  const gender = importGender(raw.gender ?? '');
  if (gender === undefined) err('gender', 'invalid');
  const dob = importDate(raw.dateOfBirth ?? '', today);
  if (dob === undefined) err('dateOfBirth', 'invalid');
  const patient = {
    full_name: full_name ?? '', phone: mainPhone ?? '', phone_alt: phone_alt === mainPhone ? null : phone_alt, email,
    gender: gender ?? null, date_of_birth: dob ?? null,
    address: text('address'), city: text('city'), occupation: text('occupation'), referral_source: text('referralSource'), notes: text('notes'),
    guardian_name, guardian_phone,
  };
  return errors.length ? { patient: null, errors } : { patient, errors: [] };
}
