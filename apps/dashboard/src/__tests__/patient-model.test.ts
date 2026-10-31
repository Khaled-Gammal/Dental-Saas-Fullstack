import { describe, expect, it } from 'vitest';
import { addItem, ageOn, EMPTY_PATIENT, hasAlerts, historyBody, initialProfileTab, isMinor, looksLikePhone, medicalAlerts, nextAppointment, profileTabs, parseTags, patientBody, patientProblems, type PatientForm } from '../patient-model';

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

describe('medicalAlerts', () => {
  const h = { allergies: ['Penicillin'], conditions: ['سكر'], medications: ['Warfarin'], is_pregnant: true, is_smoker: null, notes: null, updated_at: null };
  it('lists allergies, pregnancy and conditions in one order, with medications beside them', () => {
    expect(medicalAlerts(h)).toEqual({ items: ['حساسية من Penicillin', 'حامل', 'سكر'], medications: ['Warfarin'] });
  });
  it('medications alone are not an alert; no history means nothing to show', () => {
    expect(medicalAlerts({ ...h, allergies: [], conditions: [], is_pregnant: false }).items).toEqual([]);
    expect(hasAlerts({ ...h, allergies: [], conditions: [], is_pregnant: null })).toBe(false);
    expect(medicalAlerts(null)).toEqual({ items: [], medications: [] });
  });
});

describe('profile tabs (redesign R6)', () => {
  const as = (perms: string[]) => (p: string) => perms.includes('*') || perms.includes(p);
  it('shows each member the tabs whose data they may read', () => {
    expect(profileTabs(as(['*']), true)).toEqual(['overview', 'clinical', 'billing', 'appointments', 'activity']);
    expect(profileTabs(as(['patients:read', 'invoices:read']), false)).toEqual(['overview', 'billing', 'appointments']);
    expect(profileTabs(as(['patients:read', 'clinical:write', 'invoices:read:own']), true)).toEqual(['overview', 'clinical', 'billing', 'appointments']);
  });
  it('opens the asked tab if shown; else the doctor lands on the clinical tab and reception on the overview', () => {
    const doctor = as(['clinical:write']);
    const doctorTabs = profileTabs(doctor, true);
    expect(initialProfileTab(doctorTabs, undefined, doctor)).toBe('clinical');
    expect(initialProfileTab(doctorTabs, 'appointments', doctor)).toBe('appointments');
    expect(initialProfileTab(doctorTabs, 'activity', doctor)).toBe('clinical'); // not theirs: ignored
    const reception = as(['patients:read', 'invoices:read']);
    expect(initialProfileTab(profileTabs(reception, false), undefined, reception)).toBe('overview');
  });
});

describe('nextAppointment', () => {
  const at = (iso: string, status: string) => ({ id: iso, status, starts_at: iso }) as never;
  const now = Date.parse('2026-11-01T10:00:00Z');
  it('is the earliest one still to come that will happen', () => {
    const list = [at('2026-11-09T10:00:00Z', 'confirmed'), at('2026-11-03T10:00:00Z', 'cancelled'), at('2026-11-05T10:00:00Z', 'pending'), at('2026-10-20T10:00:00Z', 'completed')];
    expect(nextAppointment(list, now)).toMatchObject({ starts_at: '2026-11-05T10:00:00Z' });
    expect(nextAppointment([at('2026-10-20T10:00:00Z', 'confirmed')], now)).toBeNull();
  });
});
