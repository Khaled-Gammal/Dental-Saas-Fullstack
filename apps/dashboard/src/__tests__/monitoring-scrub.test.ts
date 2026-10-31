import { describe, expect, it } from 'vitest';
import { redact, scrubBreadcrumb, scrubBrowserEvent, stripQuery } from '../monitoring/scrub';

describe('what the dashboard may send to the error tracker (Phase 1B)', () => {
  it('masks emails, phones and tokens; keeps ids and dates', () => {
    expect(redact('Omar 01012345678 omar@x.test')).toBe('Omar [number] [email]');
    expect(redact('patient 7f0c2a1e-1111-4222-8333-426614174000 on 2026-10-31')).toBe('patient 7f0c2a1e-1111-4222-8333-426614174000 on 2026-10-31');
  });
  it('drops query strings, also inside the hash route (a patient search is #/patients?q=<name>)', () => {
    expect(stripQuery('https://app.example/?v=2#/patients?q=Ahmed')).toBe('https://app.example/#/patients');
    expect(stripQuery('https://app.example/#/patients/7f0c2a1e-1111-4222-8333-426614174000')).toBe('https://app.example/#/patients/7f0c2a1e-1111-4222-8333-426614174000');
    expect(stripQuery('https://api.example/patients?q=Ahmed')).toBe('https://api.example/patients');
    expect(redact('call 010-1234-5678')).toBe('call [number]');
  });
  it('keeps only the page path; drops headers, user and extra data', () => {
    const e = scrubBrowserEvent({
      request: { url: 'https://app.example/#/patients/42?q=Ahmed', headers: { Referer: 'https://app.example/x?q=y' } },
      user: { id: 'u1' },
      extra: { form: { name: 'Ahmed' } },
      exception: { values: [{ value: 'cannot read name of 01012345678' }] },
    });
    expect(e).toEqual({ request: { url: 'https://app.example/#/patients/42' }, exception: { values: [{ value: 'cannot read name of [number]' }] } });
  });
  it('drops console and typing breadcrumbs; API calls keep method, path and status only', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'patient Ahmed' })).toBeNull();
    expect(scrubBreadcrumb({ category: 'ui.input', message: 'input[name=phone]' })).toBeNull();
    expect(scrubBreadcrumb({ category: 'ui.click', message: 'button[aria-label="إزالة السكري"]' })).toEqual({ category: 'ui.click' });
    expect(scrubBreadcrumb({ category: 'fetch', data: { method: 'GET', url: 'https://api.example/patients?q=Ahmed', status_code: 500, request_body_size: 10 } }))
      .toEqual({ category: 'fetch', data: { method: 'GET', url: 'https://api.example/patients', status_code: 500 } });
    expect(scrubBreadcrumb({ category: 'navigation', data: { from: '/#/patients?q=a', to: '/#/patients/1' } }))
      .toEqual({ category: 'navigation', data: { from: '/#/patients', to: '/#/patients/1' } });
  });
});
