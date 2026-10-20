import { describe, expect, it } from 'vitest';
import { canOpen, canSee } from '../access';
import { consentState, defaultSigner, missingConsents, signable, signProblems, type ConsentText } from '../consents-model';
import { parseRoute } from '../router';
import { toBody, toForm } from '../service-model';
import type { Service } from '../types';

const text = (over: Partial<ConsentText>): ConsentText => ({
  id: 'x', key: 'general', version: 1, title_ar: 'موافقة', body_ar: 'نص', is_active: true, is_draft: false, reviewed_at: null, reviewed_by_name: null,
  created_at: '2026-10-20T00:00:00Z', ...over,
});
const child = { full_name: 'يوسف', date_of_birth: '2016-05-01', guardian_name: 'سمير', guardian_relation: 'father' as const };

describe('patient consents (H9)', () => {
  it('only reviewed, active texts can be signed', () => {
    const texts = [text({ key: 'a' }), text({ key: 'b', is_draft: true }), text({ key: 'c', is_active: false })];
    expect(signable(texts).map((x) => x.key)).toEqual(['a']);
  });
  it('a child\'s guardian signs by default; an adult signs for themself', () => {
    expect(defaultSigner(child, '2026-10-20')).toEqual({ name: 'سمير', relation: 'father', minor: true });
    expect(defaultSigner({ ...child, guardian_name: null, guardian_relation: null }, '2026-10-20')).toEqual({ name: '', relation: 'legal_guardian', minor: true });
    expect(defaultSigner({ ...child, date_of_birth: '1990-01-01' }, '2026-10-20')).toEqual({ name: 'يوسف', relation: 'self', minor: false });
    expect(defaultSigner({ ...child, date_of_birth: null }, '2026-10-20').relation).toBe('self');
  });
  it('the signing form needs a name, the text read, a signature — and a minor never signs for themself', () => {
    expect(signProblems({ name: 'سمير', relation: 'father', read: true, signed: true, minor: true })).toEqual([]);
    expect(signProblems({ name: ' ', relation: 'self', read: false, signed: false, minor: true })).toEqual(['name', 'relation', 'read', 'signature']);
    expect(signProblems({ name: 'يوسف', relation: 'self', read: true, signed: true, minor: false })).toEqual([]);
  });
  it('the visit warns about the treatments whose consent is missing', () => {
    expect(missingConsents([{ key: 'a', title: 'أ', consent_id: null }, { key: 'b', title: 'ب', consent_id: 'c1' }]).map((c) => c.key)).toEqual(['a']);
    expect(missingConsents(undefined)).toEqual([]);
    expect(consentState({ revoked_at: null })).toBe('valid');
    expect(consentState({ revoked_at: '2026-10-20T00:00:00Z' })).toBe('revoked');
  });
  it('who opens what: the texts are the clinic settings\'; signing needs a write right, reading only patients:read', () => {
    const reception = (p: string) => ['patients:read', 'patients:write'].includes(p);
    const accountant = (p: string) => ['patients:read', 'invoices:read'].includes(p);
    const owner = () => true;
    expect(canSee(owner, 'consents')).toBe(true);
    expect(canSee(reception, 'consents')).toBe(false);
    expect(canOpen(reception, parseRoute('#/patients/p1/sign'))).toBe(true);
    expect(canOpen(accountant, parseRoute('#/patients/p1/sign'))).toBe(false);
    expect(canOpen(accountant, parseRoute('#/patients/p1/consent?c=x'))).toBe(true);
    expect(parseRoute('#/consents/extraction/edit')).toEqual({ page: 'consents', id: 'extraction', action: 'edit' });
  });
  it('a service sends its consent only when it changed, null to clear it', () => {
    const s = { name_ar: 'خلع', name_en: null, description_ar: null, description_en: null, price_minor: 30000, price_max_minor: null, duration_minutes: 30,
      bookable_online: true, show_on_website: true, is_active: true, image: null, consent_key: 'extraction' } as unknown as Service;
    const orig = toForm(s);
    expect(orig.consentKey).toBe('extraction');
    expect(toBody({ ...orig }, orig)).toEqual({});
    expect(toBody({ ...orig, consentKey: '' }, orig)).toEqual({ consentKey: null });
    expect(toBody({ ...orig, consentKey: 'implant' }, orig)).toEqual({ consentKey: 'implant' });
  });
});
