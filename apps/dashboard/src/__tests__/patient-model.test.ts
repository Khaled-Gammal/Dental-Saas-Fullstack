import { describe, expect, it } from 'vitest';
import { addItem, ageOn, EMPTY_PATIENT, hasAlerts, historyBody, isMinor, looksLikePhone, parseTags, patientBody, patientProblems, type PatientForm } from '../patient-model';

const filled: PatientForm = { ...EMPTY_PATIENT, fullName: 'Omar Khaled', phone: '01011111111', gender: 'male', dateOfBirth: '1990-01-02', city: 'Cairo', tags: 'vip, ortho' };

describe('patientBody', () => {
  it('a create sends only what is filled in', () => {
    expect(patientBody(filled, null)).toEqual({ fullName: 'Omar Khaled', phone: '01011111111', gender: 'male', dateOfBirth: '1990-01-02', city: 'Cairo', tags: ['vip', 'ortho'] });
  });
  it('an edit sends only what changed; emptied fields become null', () => {
    const next = { ...filled, city: '', occupation: 'Engineer' };
    expect(patientBody(next, filled)).toEqual({ city: null, occupation: 'Engineer' });
    expect(patientBody(filled, filled)).toEqual({});
  });
  it('Arabic-Indic digits in phones are converted', () => {
    expect(patientBody({ ...EMPTY_PATIENT, fullName: 'سارة', phone: '٠١٠١٢٣٤٥٦٧٨' }, null).phone).toBe('01012345678');
  });
  it('marketing consent: off is not sent on a create, any change is sent on an edit', () => {
    expect(patientBody(filled, null)).not.toHaveProperty('marketingOptIn');
    expect(patientBody({ ...filled, marketingOptIn: true }, null).marketingOptIn).toBe(true);
    expect(patientBody({ ...filled, marketingOptIn: false }, { ...filled, marketingOptIn: true })).toEqual({ marketingOptIn: false });
  });
  it('tags: reordering-insensitive only for real changes', () => {
    expect(patientBody({ ...filled, tags: 'vip, ortho, vip' }, filled)).toEqual({});
    expect(patientBody({ ...filled, tags: 'vip' }, filled)).toEqual({ tags: ['vip'] });
  });
});

describe('validation', () => {
  it('points at the fields the API would reject', () => {
    expect(patientProblems(EMPTY_PATIENT)).toEqual(['name', 'phone']);
    expect(patientProblems(filled)).toEqual([]);
    expect(patientProblems({ ...filled, email: 'not-an-email', guardianRelation: 'mother' })).toEqual(['email', 'guardianName']);
  });
  it('phones in every common spelling', () => {
    for (const p of ['01012345678', '+201012345678', '00201012345678', '٠١٠١٢٣٤٥٦٧٨', '010 1234 5678']) expect(looksLikePhone(p)).toBe(true);
    expect(looksLikePhone('123')).toBe(false);
  });
});

describe('age and guardians', () => {
  it('whole years; children are minors', () => {
    expect(ageOn('2010-10-17', '2026-10-16')).toBe(15);
    expect(ageOn('', '2026-10-16')).toBeNull();
    expect(isMinor('2015-01-01', '2026-10-16')).toBe(true);
    expect(isMinor('1990-01-01', '2026-10-16')).toBe(false);
    expect(isMinor('', '2026-10-16')).toBe(false);
  });
});

describe('medical history', () => {
  it('items are unique case-insensitively and never blank', () => {
    expect(addItem(['Penicillin'], ' penicillin ')).toEqual(['Penicillin']);
    expect(addItem(['Penicillin'], '  ')).toEqual(['Penicillin']);
    expect(addItem([], 'Latex')).toEqual(['Latex']);
  });
  it('blank notes become null; alerts need something safety-relevant', () => {
    expect(historyBody({ allergies: [], conditions: [], medications: [], isPregnant: null, isSmoker: null, notes: '  ' }).notes).toBeNull();
    expect(hasAlerts({ allergies: ['Latex'], conditions: [], medications: [], is_pregnant: null, is_smoker: null, notes: null, updated_at: null })).toBe(true);
    expect(hasAlerts({ allergies: [], conditions: [], medications: ['Vitamin D'], is_pregnant: false, is_smoker: true, notes: null, updated_at: null })).toBe(false);
    expect(hasAlerts(null)).toBe(false);
  });
  it('tags parse with both comma styles', () => expect(parseTags('vip، ortho, vip')).toEqual(['vip', 'ortho']));
});

describe('zonedToUtc (dashboard copy)', async () => {
  const { zonedToUtc } = await import('../util');
  it('Cairo summer and winter time', () => {
    expect(new Date(zonedToUtc('2026-07-01', '17:00', 'Africa/Cairo')).toISOString()).toBe('2026-07-01T14:00:00.000Z');
    expect(new Date(zonedToUtc('2026-12-01', '17:00', 'Africa/Cairo')).toISOString()).toBe('2026-12-01T15:00:00.000Z');
  });
});

describe('blocking', () => {
  it('is sent only for an existing record, and only when it changed', () => {
    expect(patientBody({ ...filled, isBlocked: true }, null)).not.toHaveProperty('isBlocked');
    expect(patientBody({ ...filled, isBlocked: true }, filled)).toEqual({ isBlocked: true });
    expect(patientBody(filled, filled)).toEqual({});
  });
});
