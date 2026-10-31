import { renewalMessages, renewalStep, type RenewalRow } from '../renewal-reminders';

const now = new Date('2026-11-01T10:00:00Z').getTime();
const H = 3_600_000;
const row = (status: 'active' | 'past_due', hoursToEnd: number, over: Partial<RenewalRow> = {}): RenewalRow => ({
  subscription_id: 's1', tenant_id: 't1', status, current_period_end: new Date(now + hoursToEnd * H), grace_ends_at: null, billing_cycle: 'monthly',
  price_monthly_minor: '50000', price_yearly_minor: '500000', currency: 'EGP', plan_ar: 'الأساسية', clinic_ar: 'عيادة الابتسامة', clinic_en: null,
  timezone: 'Africa/Cairo', owners: ['Owner@Clinic.test'], ...over,
});

describe('subscription renewal reminders (Phase 2B)', () => {
  it('a week before, on the last day, when it ran out, and the day before the suspension; nothing otherwise', () => {
    const step = (status: string, hours: number) => renewalStep(status, new Date(now + hours * H), now, 7, 7);
    expect(step('active', 8 * 24)).toBeNull();
    expect(step('active', 6 * 24)).toBe('r7');
    expect(step('active', 23)).toBe('r1');
    expect(step('active', -1)).toBeNull(); // the worker makes it past due first
    expect(step('past_due', -1)).toBe('due');
    expect(step('past_due', -6 * 24 + 1)).toBe('due');
    expect(step('past_due', -6 * 24 - 1)).toBe('g1');
    expect(step('past_due', -7 * 24 - 1)).toBeNull(); // suspended at the next run
    expect(step('trialing', 23)).toBeNull();
  });

  it('one email per owner, keyed by subscription, period end and step, so each goes once and a renewed period is reminded again', () => {
    const m = renewalMessages(row('active', 23, { owners: ['a@x.test', 'B@x.test'] }), now, null, 7);
    expect(m.map((x) => x.recipient)).toEqual(['a@x.test', 'B@x.test']);
    expect(m[1].dedupe).toBe(`renewal:s1:${new Date(now + 23 * H).toISOString()}:r1:b@x.test`);
    expect(renewalMessages(row('active', 100), now, null, 7)[0].dedupe).not.toBe(renewalMessages(row('active', 101), now, null, 7)[0].dedupe);
  });

  it('says what it costs, how to pay (the platform\'s text), and what stops and when', () => {
    const [m] = renewalMessages(row('active', 5 * 24), now, '  InstaPay: clinic@instapay  ', 7);
    expect(m.subject).toContain('خلال أيام');
    expect(m.body).toContain('500 ج.م');
    expect(m.body).toContain('للشهر');
    expect(m.body).toContain('InstaPay: clinic@instapay');
    expect(m.body).toContain('7 أيام');
    expect(m.body).toContain('بياناتك محفوظة');
    const yearly = renewalMessages(row('active', 5 * 24, { billing_cycle: 'yearly' }), now, null, 7)[0];
    expect(yearly.body).toContain('5,000 ج.م');
    expect(yearly.body).toContain('للسنة');
    expect(yearly.body).toContain('تواصل معنا');
  });

  it('after the end: still working until the suspension day, then the last warning', () => {
    const [due] = renewalMessages(row('past_due', -2), now, null, 7);
    expect(due.subject).toContain('انتهى اشتراك');
    expect(due.body).toContain('تستمر العيادة في العمل حتى');
    const [last] = renewalMessages(row('past_due', -(6 * 24 + 2)), now, null, 7);
    expect(last.subject).toContain('تنبيه أخير');
    expect(last.dedupe).toContain(':g1@');
  });

  it('after the end the grace the worker set decides (a period that ended long ago gets its full 7 days); a fresh grace is told again', () => {
    const graced = row('past_due', -40 * 24, { grace_ends_at: new Date(now + 5 * 24 * H) });
    const [due] = renewalMessages(graced, now, null, 7);
    expect(due.dedupe).toContain(':due@');
    expect(renewalStep('past_due', graced.current_period_end, now, 7, 7, graced.grace_ends_at)).toBe('due');
    expect(renewalStep('past_due', graced.current_period_end, now, 7, 7, new Date(now + 3 * H))).toBe('g1');
    expect(renewalStep('past_due', graced.current_period_end, now, 7, 7, new Date(now - H))).toBeNull();
    const again = renewalMessages({ ...graced, grace_ends_at: new Date(now + 6 * 24 * H) }, now, null, 7)[0];
    expect(again.dedupe).not.toBe(due.dedupe);
  });

  it('a free plan has no amount line; no owner email: nothing', () => {
    expect(renewalMessages(row('active', 23, { price_monthly_minor: 0 }), now, null, 7)[0].body).not.toContain('قيمة التجديد');
    expect(renewalMessages(row('active', 23, { owners: null }), now, null, 7)).toEqual([]);
  });
});
