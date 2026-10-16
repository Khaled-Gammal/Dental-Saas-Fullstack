import { describe, expect, it } from 'vitest';
import { clientIp } from '../client-ip';

const h = (o: Record<string, string>) => new Headers(o);

describe('booking proxy clientIp', () => {
  it('uses the right-most X-Forwarded-For entry (the one our edge proxy wrote)', () => {
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(h({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });
  it('falls back to X-Real-IP, then to nothing', () => {
    expect(clientIp(h({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientIp(h({}))).toBeNull();
  });
  it('rejects junk instead of passing it on', () => {
    expect(clientIp(h({ 'x-forwarded-for': 'evil<script>' }))).toBeNull();
  });
});
