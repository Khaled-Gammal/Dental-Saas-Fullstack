import { trialBucket, trialMessages, type TrialRow } from '../trial-reminders';

const now = new Date('2026-10-20T10:00:00Z').getTime();
const H = 3_600_000;
const row = (hoursLeft: number, owners: string[] | null = ['Owner@Clinic.test']): TrialRow => ({
  subscription_id: 's1', tenant_id: 't1', trial_ends_at: new Date(now + hoursLeft * H), clinic_ar: 'عيادة الابتسامة', clinic_en: null,
  timezone: 'Africa/Cairo', owners,
});

describe('trial ending warnings (review R11, NTF-03)', () => {
  it('warns about three days ahead, then again on the last day, and not otherwise', () => {
    expect(trialBucket(row(100).trial_ends_at, now)).toBeNull();
    expect(trialBucket(row(71).trial_ends_at, now)).toBe('3');
    expect(trialBucket(row(23).trial_ends_at, now)).toBe('1');
    expect(trialBucket(row(-1).trial_ends_at, now)).toBeNull();
  });
  it('one email per owner, keyed by subscription, end and warning, so each goes once', () => {
    const m = trialMessages(row(23, ['a@x.test', 'B@x.test']), now);
    expect(m.map((x) => x.recipient)).toEqual(['a@x.test', 'B@x.test']);
    expect(m[1].dedupe).toBe(`trial_ending:s1:${new Date(now + 23 * H).toISOString()}:1:b@x.test`);
  });
  it('an extended trial (a new end) is warned about again', () => {
    expect(trialMessages(row(70), now)[0].dedupe).not.toBe(trialMessages(row(71), now)[0].dedupe);
  });
  it('says what stops and that the data stays; links the pricing when the landing page is known', () => {
    const [m] = trialMessages(row(23), now, 'https://example.test/');
    expect(m.subject).toContain('خلال أقل من يوم');
    expect(m.body).toContain('بياناتك محفوظة');
    expect(m.body).toContain('https://example.test/#pricing');
    expect(trialMessages(row(23), now)[0].body).toContain('تواصل معنا');
  });
  it('no owner email: nothing', () => {
    expect(trialMessages(row(23, null), now)).toEqual([]);
  });
});
