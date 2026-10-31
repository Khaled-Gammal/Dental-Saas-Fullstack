import { databaseErrorText, logAlerts, logKey, redact, redactDeep, scrubEvent, throttle } from '../scrub';

describe('what may be sent to the error tracker (Phase 1B)', () => {
  it('masks emails, phone-like numbers and tokens, keeps ids and dates readable', () => {
    expect(redact('Key (phone)=(+201012345678) already exists')).toBe('Key (phone)=([number]) already exists');
    expect(redact('رقم ٠١٠١٢٣٤٥٦٧٨ للحجز')).toBe('رقم [number] للحجز');
    expect(redact('no mailbox for Omar.Ali@example.test')).toBe('no mailbox for [email]');
    expect(redact('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF_123')).toBe('Bearer [token]');
    expect(redact('appointment 123e4567-e89b-12d3-a456-426614174000 on 2026-10-31 at 10:30, invoice 12345'))
      .toBe('appointment 123e4567-e89b-12d3-a456-426614174000 on 2026-10-31 at 10:30, invoice 12345');
    expect(redact('call 010-1234-5678 or +20 100 123 4567 at 2026-10-31 10:30')).toBe('call [number] or [number] at 2026-10-31 10:30');
  });
  it('a database error is sent as its code and schema names only: its message quotes what was typed', () => {
    const pg = Object.assign(new Error('invalid input syntax for type uuid: "أحمد محمد"'), { code: '22P02', severity: 'ERROR', routine: 'string_to_uuid' });
    expect(databaseErrorText(pg)).toBe('PostgreSQL error 22P02 routine=string_to_uuid');
    expect(databaseErrorText(new Error('boom'))).toBeUndefined();
    expect(databaseErrorText(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBeUndefined();
    const e = scrubEvent({ exception: { values: [{ value: 'invalid input syntax for type uuid: "أحمد محمد"' }] } }, pg);
    expect(e.exception).toEqual({ values: [{ value: 'PostgreSQL error 22P02 routine=string_to_uuid' }] });
  });
  it('contexts: paths and URLs lose their query strings, other text is masked', () => {
    const e = scrubEvent({ contexts: { nextjs: { request_path: '/book?phone=01012345678', router_kind: 'App Router' }, os: { name: 'Linux' } } });
    expect(e.contexts).toEqual({ nextjs: { request_path: '/book', router_kind: 'App Router' }, os: { name: 'Linux' } });
  });
  it('masks every string inside log fields', () => {
    expect(redactDeep({ notification: 7, error: '550 omar@x.test unknown', nested: { to: ['+201000000000'] } }))
      .toEqual({ notification: 7, error: '550 [email] unknown', nested: { to: ['[number]'] } });
  });
  it('drops the request body, query string, headers, cookies, user and breadcrumbs; keeps method and path', () => {
    const e = scrubEvent({
      request: { method: 'POST', url: 'https://api.example/patients?q=Ahmed', data: { name: 'Ahmed', phone: '01012345678' }, query_string: 'q=Ahmed', cookies: { rt: 'x' }, headers: { authorization: 'Bearer x' }, env: { REMOTE_ADDR: '1.2.3.4' } },
      user: { email: 'a@b.test', ip_address: '1.2.3.4' },
      breadcrumbs: [{ message: 'console: patient Ahmed' }],
      exception: { values: [{ value: 'duplicate phone +201012345678' }] },
      message: 'for a@b.test',
      extra: { line: 'to a@b.test' },
    });
    expect(e).toEqual({
      request: { method: 'POST', url: 'https://api.example/patients' },
      exception: { values: [{ value: 'duplicate phone [number]' }] },
      message: 'for [email]',
      extra: { line: 'to [email]' },
    });
  });
  it('masks a phone number in the path itself', () => {
    expect(scrubEvent({ request: { url: '/public/lookup/01012345678?x=1' } }).request).toEqual({ url: '/public/lookup/[number]' });
  });
});

describe('worker error lines become alerts without flooding (Phase 1B)', () => {
  it('throttle: first in a window only, per key', () => {
    let t = 0;
    const first = throttle(1000, () => t);
    expect([first('a'), first('a'), first('b')]).toEqual([true, false, true]);
    t = 1000;
    expect(first('a')).toBe(true);
  });
  it('only error lines; one per kind per window; a new kind or a later window alerts again', () => {
    let t = 0;
    const sent: string[] = [];
    const alert = logAlerts((key) => sent.push(key), 1000, () => t);
    expect(alert({ level: 'warn', outbox: 1, error: 'x' })).toBe(false);
    expect(alert({ level: 'error', outbox_dead: 3, hint: 'h' })).toBe(true);
    t = 500;
    expect(alert({ level: 'error', outbox_dead: 4, hint: 'h' })).toBe(false); // same kind, values differ
    expect(alert({ level: 'error', notification: 9, attempt: 5, failed: true, error: 'smtp' })).toBe(true);
    t = 1500;
    expect(alert({ level: 'error', outbox_dead: 4, hint: 'h' })).toBe(true);
    expect(sent).toEqual(['hint,outbox_dead', 'attempt,error,failed,notification', 'hint,outbox_dead']);
  });
  it('the kind is the field names plus the event type, never the values', () => {
    expect(logKey({ level: 'error', type: 'payment.received', outbox: 5, dead: true })).toBe('dead,outbox,type:payment.received');
  });
});
