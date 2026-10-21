import { describe, expect, it } from 'vitest';
import { href, invitationToken, parseRoute, signupLink, to } from '../router';

describe('parseRoute', () => {
  it('maps hashes to routes', () => {
    expect(parseRoute('')).toEqual({ page: 'overview' });
    expect(parseRoute('#/')).toEqual({ page: 'overview' });
    expect(parseRoute('#/doctors')).toEqual({ page: 'doctors' });
    expect(parseRoute('#/doctors/new')).toEqual({ page: 'doctors', action: 'new' });
    expect(parseRoute('#/doctors/abc/edit')).toEqual({ page: 'doctors', id: 'abc', action: 'edit' });
    expect(parseRoute('#/doctors/abc/schedule')).toEqual({ page: 'doctors', id: 'abc', action: 'schedule' });
    expect(parseRoute('#/branches/abc/hours')).toEqual({ page: 'branches', id: 'abc', action: 'hours' });
    expect(parseRoute('#/patients/abc/view')).toEqual({ page: 'patients', id: 'abc', action: 'view' });
    expect(parseRoute('#/appointments/new?patient=p1')).toEqual({ page: 'appointments', action: 'new', query: { patient: 'p1' } });
  });

  it('rejects actions a page does not offer, and unknown pages', () => {
    expect(parseRoute('#/profile/new')).toEqual({ page: 'not-found' });
    expect(parseRoute('#/services/abc/schedule')).toEqual({ page: 'not-found' });
    expect(parseRoute('#/doctors/abc/new')).toEqual({ page: 'not-found' });
    expect(parseRoute('#/doctors/abc')).toEqual({ page: 'not-found' });
    expect(parseRoute('#/nope')).toEqual({ page: 'not-found' });
    expect(parseRoute('#/doctors/abc/view')).toEqual({ page: 'not-found' });
    expect(parseRoute('#main')).toEqual({ page: 'not-found' });
  });

  it('keeps a query on create pages', () => {
    expect(parseRoute('#/roles/new?from=r1')).toEqual({ page: 'roles', action: 'new', query: { from: 'r1' } });
  });
});

describe('staff and invitation links', () => {
  it('has invite and edit pages', () => {
    expect(parseRoute('#/staff')).toEqual({ page: 'staff' });
    expect(parseRoute('#/staff/new')).toEqual({ page: 'staff', action: 'new' });
    expect(parseRoute('#/staff/m1/edit')).toEqual({ page: 'staff', id: 'm1', action: 'edit' });
    expect(parseRoute('#/staff/m1/schedule')).toEqual({ page: 'not-found' });
  });

  it('reads the token of an invitation link only', () => {
    const token = 'A'.repeat(43);
    expect(invitationToken(`#/invite/${token}`)).toBe(token);
    expect(invitationToken('#/invite/short')).toBeNull();
    expect(invitationToken(`#/invite/${token}/x`)).toBeNull();
    expect(invitationToken('#/staff')).toBeNull();
    expect(parseRoute(`#/invite/${token}`)).toEqual({ page: 'not-found' }); // never a dashboard page
  });
});

describe('calendar routes (Phase D2)', () => {
  it('has move, time-off, rooms, holidays and booking pages', () => {
    expect(parseRoute('#/appointments/a1/edit')).toEqual({ page: 'appointments', id: 'a1', action: 'edit' });
    expect(parseRoute('#/doctors/d1/timeoff')).toEqual({ page: 'doctors', id: 'd1', action: 'timeoff' });
    expect(parseRoute('#/branches/b1/rooms')).toEqual({ page: 'branches', id: 'b1', action: 'rooms' });
    expect(parseRoute('#/holidays')).toEqual({ page: 'holidays' });
    expect(parseRoute('#/booking')).toEqual({ page: 'booking' });
    expect(parseRoute('#/holidays/new')).toEqual({ page: 'not-found' });
    for (const r of [to.timeOff('d1'), to.rooms('b1'), to.edit('appointments', 'a1')]) expect(parseRoute(href(r))).toEqual(r);
  });
});

describe('href', () => {
  it('round-trips every route shape', () => {
    for (const r of [to.list('overview'), to.list('doctors'), to.create('doctors'), to.edit('services', 'x'), to.hours('b'), to.schedule('d'), to.view('patients', 'p'), to.edit('patients', 'p'), to.create('appointments', { patient: 'p' })]) {
      expect(parseRoute(href(r))).toEqual(r);
    }
  });
});

describe('clinical routes (Phase D4)', () => {
  it('visit, plan, printable prescription and the follow-up list round-trip', () => {
    for (const r of [to.visit('v1'), to.plan('p1'), to.printPrescription('rx1'), to.list('followups'), { page: 'followups' as const, query: { view: 'upcoming' } },
      to.create('appointments', { patient: 'p', doctor: 'd', branch: 'b', service: 's', plan: 'pl', item: 'i' })]) {
      expect(parseRoute(href(r))).toEqual(r);
    }
    expect(parseRoute('#/visits/v1/edit')).toEqual({ page: 'not-found' });
    expect(parseRoute('#/prescriptions/rx1/view')).toEqual({ page: 'not-found' });
    expect(parseRoute('#/patients/p1/merge')).toEqual({ page: 'patients', id: 'p1', action: 'merge' });
    for (const r of [to.invoice('i1'), to.printInvoice('i1'), to.printReceipt('p1'), to.create('invoices', { patient: 'p', visit: 'v' }), { page: 'invoices' as const, query: { status: 'open' } }]) {
      expect(parseRoute(href(r))).toEqual(r);
    }
    expect(parseRoute('#/payments/p1/view')).toEqual({ page: 'not-found' });
    expect(parseRoute('#/discounts')).toEqual({ page: 'discounts' });
    expect(parseRoute('#/invoices?status=overdue')).toEqual({ page: 'invoices', query: { status: 'overdue' } });
  });
});

describe('the landing page sign-up link (H7)', () => {
  it('opens the sign-up form for #/signup only', () => {
    expect(signupLink('#/signup')).toEqual({});
    expect(signupLink('#/signup/x')).toBeNull();
    expect(signupLink('#/')).toBeNull();
  });
  it('«اشترك الآن» carries the plan and the billing cycle; anything malformed opens a plain sign-up', () => {
    expect(signupLink('#/signup?plan=pro&cycle=yearly')).toEqual({ subscribe: { planCode: 'pro', cycle: 'yearly' } });
    expect(signupLink('#/signup?plan=pro&cycle=weekly')).toEqual({});
    expect(signupLink('#/signup?plan=<b>&cycle=monthly')).toEqual({});
    expect(signupLink('#/signup?cycle=monthly')).toEqual({});
  });
});
