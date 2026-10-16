import { describe, expect, it } from 'vitest';
import { href, parseRoute, to } from '../router';

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
    expect(parseRoute('#/services/new?catalog=rct')).toEqual({ page: 'services', action: 'new', query: { catalog: 'rct' } });
  });
});

describe('href', () => {
  it('round-trips every route shape', () => {
    for (const r of [to.list('overview'), to.list('doctors'), to.create('doctors'), to.edit('services', 'x'), to.hours('b'), to.schedule('d'), to.create('services', { catalog: 'rct' }), to.view('patients', 'p'), to.edit('patients', 'p'), to.create('appointments', { patient: 'p' })]) {
      expect(parseRoute(href(r))).toEqual(r);
    }
  });
});
