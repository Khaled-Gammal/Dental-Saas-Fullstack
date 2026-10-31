/**
 * Patient form logic that mirrors the API rules. Pure functions (no React), unit-tested in __tests__/patient-model.test.ts.
 */
import { toAsciiDigits } from '@dental/ui/text';
import type { Gender, GuardianRelation, MedicalHistory, PatientDetail, PatientVisit } from './types';

export interface PatientForm {
  fullName: string;
  phone: string;
  phoneAlt: string;
  email: string;
  gender: Gender | '';
  dateOfBirth: string; // YYYY-MM-DD or ''
  city: string;
  address: string;
  occupation: string;
  referralSource: string;
  preferredBranchId: string;
  notes: string;
  tags: string;
  guardianName: string;
  guardianPhone: string;
  guardianRelation: GuardianRelation | '';
  marketingOptIn: boolean;
  isBlocked: boolean;
}

export const EMPTY_PATIENT: PatientForm = {
  fullName: '', phone: '', phoneAlt: '', email: '', gender: '', dateOfBirth: '', city: '', address: '', occupation: '', referralSource: '',
  preferredBranchId: '', notes: '', tags: '', guardianName: '', guardianPhone: '', guardianRelation: '', marketingOptIn: false, isBlocked: false,
};

export const toPatientForm = (p: PatientDetail): PatientForm => ({
  fullName: p.full_name, phone: p.phone, phoneAlt: p.phone_alt ?? '', email: p.email ?? '', gender: p.gender ?? '', dateOfBirth: p.date_of_birth ?? '',
  city: p.city ?? '', address: p.address ?? '', occupation: p.occupation ?? '', referralSource: p.referral_source ?? '',
  preferredBranchId: p.preferred_branch_id ?? '', notes: p.notes ?? '', tags: p.tags.filter((t) => t !== 'needs_review').join(', '),
  guardianName: p.guardian_name ?? '', guardianPhone: p.guardian_phone ?? '', guardianRelation: p.guardian_relation ?? '', marketingOptIn: p.marketing_opt_in, isBlocked: p.is_blocked,
});

/** "vip، ortho, vip" -> ['vip', 'ortho']: Arabic and Latin commas both split. */
export const parseTags = (s: string) => Array.from(new Set(s.split(/[,،]/).map((x) => x.trim()).filter(Boolean))).slice(0, 10);

/** Whole years on `today` (YYYY-MM-DD); null without a birth date. */
export function ageOn(dob: string, today: string): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

/** Children need a guardian (SRS DSH-16): the form opens that section for anyone under 18. */
export const isMinor = (dob: string, today: string) => { const a = ageOn(dob, today); return a !== null && a < 18; };

/** A mobile the API will accept: 010…, +20…, 0020…, Arabic digits (the API normalises to E.164). */
export const looksLikePhone = (s: string) => /^\+?\d{10,15}$/.test(toAsciiDigits(s).replace(/[\s()-]/g, '').replace(/^00/, '+'));

export type PatientProblem = 'name' | 'phone' | 'phoneAlt' | 'email' | 'guardianPhone' | 'guardianName';

/** Field problems the API would reject, so the form can point at them before saving. */
export function patientProblems(f: PatientForm): PatientProblem[] {
  const out: PatientProblem[] = [];
  if (f.fullName.trim().length < 2) out.push('name');
  if (!looksLikePhone(f.phone)) out.push('phone');
  if (f.phoneAlt.trim() && !looksLikePhone(f.phoneAlt)) out.push('phoneAlt');
  if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) out.push('email');
  if (f.guardianPhone.trim() && !looksLikePhone(f.guardianPhone)) out.push('guardianPhone');
  if (f.guardianRelation && f.guardianName.trim().length < 2) out.push('guardianName');
  return out;
}

const TEXT: [keyof PatientForm, string][] = [
  ['fullName', 'fullName'], ['phone', 'phone'], ['phoneAlt', 'phoneAlt'], ['email', 'email'], ['city', 'city'], ['address', 'address'],
  ['occupation', 'occupation'], ['referralSource', 'referralSource'], ['notes', 'notes'], ['guardianName', 'guardianName'], ['guardianPhone', 'guardianPhone'],
];
const CHOICE: [keyof PatientForm, string][] = [['gender', 'gender'], ['dateOfBirth', 'dateOfBirth'], ['preferredBranchId', 'preferredBranchId'], ['guardianRelation', 'guardianRelation']];

/**
 * The API body. A create sends what is filled in; an edit sends only what changed, with emptied fields as null.
 * The phone is required, so it is never sent empty.
 */
export function patientBody(f: PatientForm, orig: PatientForm | null): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const changed = (k: keyof PatientForm) => !orig || JSON.stringify(f[k]) !== JSON.stringify(orig[k]);
  for (const [k, api] of [...TEXT, ...CHOICE]) {
    const v = String(f[k]).trim();
    if (!changed(k) || (!orig && !v)) continue;
    body[api] = v ? (k.toLowerCase().includes('phone') ? toAsciiDigits(v) : v) : k === 'phone' || k === 'fullName' ? v : null;
  }
  const tags = parseTags(f.tags);
  if (!orig ? tags.length > 0 : JSON.stringify(tags) !== JSON.stringify(parseTags(orig.tags))) body.tags = tags;
  if (changed('marketingOptIn') && (orig || f.marketingOptIn)) body.marketingOptIn = f.marketingOptIn;
  if (orig && changed('isBlocked')) body.isBlocked = f.isBlocked; // only an existing record can be blocked
  return body;
}

// ---------- medical history ----------

export interface HistoryForm { allergies: string[]; conditions: string[]; medications: string[]; isPregnant: boolean | null; isSmoker: boolean | null; notes: string }

export const toHistoryForm = (h: MedicalHistory): HistoryForm => ({
  allergies: h.allergies, conditions: h.conditions, medications: h.medications, isPregnant: h.is_pregnant, isSmoker: h.is_smoker, notes: h.notes ?? '',
});

/** Adds an item unless it is blank or already there (case-insensitive), the same rule the API applies. */
export function addItem(list: string[], raw: string): string[] {
  const v = raw.trim().slice(0, 80);
  return !v || list.some((x) => x.toLowerCase() === v.toLowerCase()) || list.length >= 30 ? list : [...list, v];
}

export const historyBody = (h: HistoryForm) => ({ ...h, notes: h.notes.trim() || null });

/**
 * The safety facts every screen shows first, in one order (allergies, pregnancy, conditions), plus the current
 * medications as context. One rule for the patient profile, the visit and the history card, so they never disagree.
 */
export function medicalAlerts(h: MedicalHistory | null): { items: string[]; medications: string[] } {
  if (!h) return { items: [], medications: [] };
  return {
    items: [...h.allergies.map((a) => `${'حساسية من'} ${a}`), ...(h.is_pregnant ? ['حامل'] : []), ...h.conditions],
    medications: h.medications,
  };
}

/** Safety-relevant facts the dentist must see first (allergies, anticoagulants, pregnancy). */
export const hasAlerts = (h: MedicalHistory | null) => medicalAlerts(h).items.length > 0;

// ---------- the profile's tabs (redesign R6) ----------

export type ProfileTab = 'overview' | 'clinical' | 'billing' | 'appointments' | 'activity';

/**
 * The tabs of the patient profile this member sees, in order. `seesClinical`: the API returned the medical data (it
 * leaves it out for a role that may not see it). The billing tab follows the same rule as the account card.
 */
export function profileTabs(has: (p: string) => boolean, seesClinical: boolean): ProfileTab[] {
  return [
    'overview',
    ...(seesClinical ? ['clinical' as const] : []),
    ...(has('invoices:read') || has('invoices:read:own') ? ['billing' as const] : []),
    'appointments',
    ...(has('audit:read') ? ['activity' as const] : []),
  ];
}

/** The tab that opens: the one in the link if this member has it; else a doctor (clinical:write) lands on the clinical tab, everyone else on the overview. */
export function initialProfileTab(tabs: readonly ProfileTab[], asked: string | undefined, has: (p: string) => boolean): ProfileTab {
  if (tabs.includes(asked as ProfileTab)) return asked as ProfileTab;
  return has('clinical:write') && tabs.includes('clinical') ? 'clinical' : 'overview';
}

/** The patient's next appointment still to come (not cancelled, missed, done or an expired hold), or null. */
export function nextAppointment(list: readonly PatientVisit[], now: number): PatientVisit | null {
  const live = list.filter((a) => new Date(a.starts_at).getTime() > now && !['cancelled', 'no_show', 'completed', 'expired'].includes(a.status));
  return live.sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null;
}
