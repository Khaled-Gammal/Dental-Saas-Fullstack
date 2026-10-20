import { describe, expect, it } from 'vitest';
import { filterClinics, filterLeads, parsePlatformRoute, platformHref, trialDaysLeft } from '../platform-model';

const ID = '22222222-2222-2222-2222-222222222222';

describe('platform panel routes (H5)', () => {
  it('opens the panel only on #/platform…; the clinic app keeps every other hash', () => {
    expect(parsePlatformRoute('#/platform')).toEqual({ page: 'clinics' });
    expect(parsePlatformRoute(`#/platform/clinics/${ID}`)).toEqual({ page: 'clinic', id: ID });
    expect(parsePlatformRoute('#/platform/plans')).toEqual({ page: 'plans' });
    expect(parsePlatformRoute('#/platform/activity')).toEqual({ page: 'activity' });
    expect(parsePlatformRoute('#/platform/clinics/not-an-id')).toEqual({ page: 'clinics' });
    expect(parsePlatformRoute('#/patients')).toBeNull();
    expect(parsePlatformRoute('#/')).toBeNull();
  });
  it('builds the links it parses', () => {
    for (const r of [{ page: 'clinics' }, { page: 'clinic', id: ID }, { page: 'plans' }, { page: 'activity' }] as const) {
      expect(parsePlatformRoute(platformHref(r))).toEqual(r);
    }
  });
});

describe('clinics list', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  it('counts trial days left only for a clinic on a trial', () => {
    expect(trialDaysLeft('2026-10-30T12:00:00Z', 'trialing', now)).toBe(10);
    expect(trialDaysLeft('2026-10-19T12:00:00Z', 'trialing', now)).toBe(-1);
    expect(trialDaysLeft('2026-10-30T12:00:00Z', 'active', now)).toBeNull();
    expect(trialDaysLeft(null, 'trialing', now)).toBeNull();
  });
  it('searches name, subdomain and owner email; filters by status', () => {
    const rows = [
      { slug: 'clinic-a', name_ar: 'عيادة الابتسامة', name_en: null, owner_email: 'owner.a@demo.test', status: 'trialing' },
      { slug: 'clinic-b', name_ar: null, name_en: 'Bright', owner_email: 'b@x.test', status: 'suspended' },
    ];
    expect(filterClinics(rows, 'الابتسامة', 'all').map((r) => r.slug)).toEqual(['clinic-a']);
    expect(filterClinics(rows, 'BRIGHT', 'all').map((r) => r.slug)).toEqual(['clinic-b']);
    expect(filterClinics(rows, 'owner.a', 'all').map((r) => r.slug)).toEqual(['clinic-a']);
    expect(filterClinics(rows, '', 'suspended').map((r) => r.slug)).toEqual(['clinic-b']);
  });
});

describe('landing-page requests in the panel (H7)', () => {
  const leads = [
    { full_name: 'د. منى حسن', clinic_name: 'عيادة النور', city: 'طنطا', phone: '+201012345678', email: null, status: 'new' },
    { full_name: 'Ahmed Ali', clinic_name: null, city: 'القاهرة', phone: '+201198765432', email: 'ahmed@example.test', status: 'contacted' },
  ];
  it('has its own route', () => {
    expect(parsePlatformRoute('#/platform/leads')).toEqual({ page: 'leads' });
    expect(platformHref({ page: 'leads' })).toBe('#/platform/leads');
  });
  it('finds a request by name, clinic, city or email, and by phone written either way', () => {
    expect(filterLeads(leads, 'النور', 'all')).toHaveLength(1);
    expect(filterLeads(leads, 'ahmed@', 'all')).toHaveLength(1);
    expect(filterLeads(leads, '01012345678', 'all')[0].full_name).toBe('د. منى حسن');
    expect(filterLeads(leads, '٠١١٩٨', 'all')[0].full_name).toBe('Ahmed Ali');
    expect(filterLeads(leads, '', 'contacted')).toHaveLength(1);
    expect(filterLeads(leads, 'طنطا', 'contacted')).toHaveLength(0);
  });
});
