import { describe, expect, it } from 'vitest';
import { amountMinor, filterClinics, filterLeads, parsePlatformRoute, planPriceText, platformHref, renewalPeriod, trialDaysLeft } from '../platform-model';

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

describe('recording a payment (Phase 2B)', () => {
  const now = Date.parse('2026-11-10T08:00:00Z');
  it('buys a month or a year from now, or from the end of a paid period still running (as the database does)', () => {
    expect(renewalPeriod('trialing', null, 'monthly', now)).toEqual({ start: new Date(now), end: new Date('2026-12-10T08:00:00Z') });
    expect(renewalPeriod('active', '2026-11-20T10:00:00Z', 'yearly', now).end).toEqual(new Date('2027-11-20T10:00:00Z'));
    // ran out (past due) or suspended: from now
    expect(renewalPeriod('past_due', '2026-11-01T10:00:00Z', 'monthly', now).start).toEqual(new Date(now));
    expect(renewalPeriod('active', '2026-11-01T10:00:00Z', 'monthly', now).start).toEqual(new Date(now));
    // the 31st plus a month is the last day of the next month
    expect(renewalPeriod('active', '2027-01-31T10:00:00Z', 'monthly', now).end).toEqual(new Date('2027-02-28T10:00:00Z'));
    expect(renewalPeriod('active', '2028-02-29T10:00:00Z', 'yearly', now).end).toEqual(new Date('2029-02-28T10:00:00Z'));
  });
  it('prefills the plan\'s price for the cycle', () => {
    const plan = { price_monthly_minor: 50000, price_yearly_minor: 500050 };
    expect(planPriceText(plan, 'monthly')).toBe('500');
    expect(planPriceText(plan, 'yearly')).toBe('5000.5');
    expect(planPriceText({ price_monthly_minor: 0, price_yearly_minor: 0 }, 'monthly')).toBe('');
    expect(planPriceText(undefined, 'monthly')).toBe('');
  });
  it('reads the amount typed in pounds', () => {
    expect(amountMinor('500')).toBe(50000);
    expect(amountMinor(' ١٢٥٠٫٥ ')).toBe(125050);
    expect(amountMinor('1,500')).toBe(150000);
    expect(amountMinor('1,5')).toBeNull();
    expect(amountMinor('0')).toBeNull();
    expect(amountMinor('12.345')).toBeNull();
    expect(amountMinor('-5')).toBeNull();
    expect(amountMinor('')).toBeNull();
  });
});
