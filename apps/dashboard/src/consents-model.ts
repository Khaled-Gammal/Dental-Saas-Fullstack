/**
 * Patient consents on the dashboard (H9, DSH-16): the clinic's texts, the consents a patient signed, and who signs.
 * Pure parts, unit-tested.
 */
import { isMinor } from './patient-model';
import type { GuardianRelation } from './types';

export type SignerRelation = 'self' | GuardianRelation;
export const SIGNER_RELATIONS: SignerRelation[] = ['self', 'father', 'mother', 'sibling', 'spouse', 'legal_guardian', 'other'];

export interface ConsentText {
  id: string; key: string; version: number; title_ar: string; body_ar: string; is_active: boolean; is_draft: boolean;
  reviewed_at: string | null; reviewed_by_name: string | null; created_at: string; signed?: number;
}
export interface ConsentTextDetail { key: string; current: ConsentText; versions: ConsentText[] }

export interface PatientConsent {
  id: string; key: string; version: number; title: string; method: 'screen' | 'paper'; signer_name: string; signer_relation: SignerRelation;
  visit_id: string | null; signed_at: string; recorded_by_name: string | null; revoked_at: string | null; revoke_reason: string | null;
  revoked_by_name: string | null; file_id: string; file_url: string; body_snapshot?: string;
}

/** A visit's treatments that need a consent (from GET /visits/:id); consent_id null = not signed yet. */
export interface VisitConsent { key: string; title: string | null; consent_id: string | null }
export const missingConsents = (list: readonly VisitConsent[] | undefined) => (list ?? []).filter((c) => !c.consent_id);

/** Texts a patient can sign now: reviewed (not a draft) and not archived. */
export const signable = (texts: readonly ConsentText[]) => texts.filter((t) => t.is_active && !t.is_draft);

/**
 * Who signs by default: the patient; for a minor with a guardian on file, the guardian (the form still lets staff
 * change it). `today` is YYYY-MM-DD.
 */
export function defaultSigner(p: { full_name: string; date_of_birth: string | null; guardian_name: string | null; guardian_relation: GuardianRelation | null }, today: string):
  { name: string; relation: SignerRelation; minor: boolean } {
  const minor = !!p.date_of_birth && isMinor(p.date_of_birth, today);
  if (minor && p.guardian_name) return { name: p.guardian_name, relation: p.guardian_relation ?? 'legal_guardian', minor };
  return { name: minor ? '' : p.full_name, relation: minor ? 'legal_guardian' : 'self', minor };
}

/** The signing form can be sent: a name, a signer who is not the minor patient themself, the text read, a signature. */
export function signProblems(f: { name: string; relation: SignerRelation; read: boolean; signed: boolean; minor: boolean }): ('name' | 'relation' | 'read' | 'signature')[] {
  const out: ('name' | 'relation' | 'read' | 'signature')[] = [];
  if (f.name.trim().length < 2) out.push('name');
  if (f.minor && f.relation === 'self') out.push('relation');
  if (!f.read) out.push('read');
  if (!f.signed) out.push('signature');
  return out;
}

/** The consent's state for its badge. */
export const consentState = (c: Pick<PatientConsent, 'revoked_at'>) => (c.revoked_at ? 'revoked' : 'valid') as 'revoked' | 'valid';
