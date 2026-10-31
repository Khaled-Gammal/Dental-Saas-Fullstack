import { describe, expect, it } from 'vitest';
import { redact, scrubServerEvent } from '../sentry-scrub';

describe('what the websites may send to the error tracker (Phase 1B)', () => {
  it('masks a visitor\'s phone and email in error text', () => {
    expect(redact('booking failed for +201012345678 / mona@x.test')).toBe('booking failed for [number] / [email]');
  });
  it('keeps only method and path; drops the booking form, headers, cookies, user and breadcrumbs', () => {
    const e = scrubServerEvent({
      request: { method: 'POST', url: 'https://clinic-a.example/book?ref=x', data: 'name=Mona&phone=01012345678', headers: { cookie: 'x' }, cookies: { a: 'b' } },
      user: { ip_address: '1.2.3.4' },
      breadcrumbs: [{ message: 'x' }],
      extra: { body: 'x' },
      message: 'for 01012345678',
    });
    expect(e).toEqual({ request: { method: 'POST', url: 'https://clinic-a.example/book' }, message: 'for [number]' });
  });
  it('the patient\'s own booking link never leaves with its key (Phase 2E)', () => {
    const token = 'Ab3_dEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd';
    const e = scrubServerEvent({ request: { method: 'GET', url: `https://clinic-a.example/appointment/${token}` }, contexts: { nextjs: { request_path: `/appointment/${token}` } }, message: `API 500 for /appointment/${token}` });
    expect(JSON.stringify(e)).not.toContain(token);
    expect(e.request?.url).toBe('https://clinic-a.example/appointment/[token]');
  });
  it('the request path Next.js reports in contexts loses its query string', () => {
    const e = scrubServerEvent({ contexts: { nextjs: { request_path: '/book?name=Mona&phone=010-1234-5678', route_type: 'render' } } });
    expect(e.contexts).toEqual({ nextjs: { request_path: '/book', route_type: 'render' } });
  });
});
