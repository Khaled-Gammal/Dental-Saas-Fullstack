import { describe, expect, it } from 'vitest';
import { bestSaving, EMPTY_LEAD, leadBody, leadError, leadProblems, limitLines, looksLikePhone, planPrice, trialDays, yearlySaving, type PublicPlan } from '../landing';
import { faqs } from '../landing-content';

const basic: PublicPlan = {
  id: 'a', code: 'basic', name_ar: 'الأساسية', price_monthly_minor: 50000, price_yearly_minor: 500000, currency: 'EGP', trial_days: 14,
  limits: { branches: 1, doctors: 3, staff: 5, patients: 2000, storage_mb: 2048 },
};
const pro: PublicPlan = { ...basic, id: 'b', code: 'pro', name_ar: 'الاحترافية', price_monthly_minor: 120000, price_yearly_minor: 1200000, limits: { branches: 5, staff: 30, patients: 50000, storage_mb: 20480 } };

describe('the pricing table (LND-02)', () => {
  it('shows the monthly price, or the yearly one with its monthly equivalent', () => {
    expect(planPrice(basic, 'monthly')).toEqual({ amount: '500 ج.م', per: 'شهريًا', note: null });
    expect(planPrice(basic, 'yearly')).toEqual({ amount: '5,000 ج.م', per: 'سنويًا', note: 'يعادل 416.67 ج.م شهريًا' });
  });
  it('the yearly saving is what twelve months would cost more, rounded down; none when yearly is not cheaper', () => {
    expect(yearlySaving(basic)).toBe(16);
    expect(yearlySaving({ ...basic, price_yearly_minor: 600000 })).toBe(0);
    expect(yearlySaving({ ...basic, price_monthly_minor: 0, price_yearly_minor: 0 })).toBe(0);
    expect(bestSaving([basic, pro])).toBe(16);
  });
  it('lists the limits in Arabic with the right noun forms; a missing limit reads as no limit', () => {
    expect(limitLines(basic.limits)).toEqual(['فرع واحد', 'حتى 3 أطباء', 'حتى 5 مستخدمين', 'حتى 2,000 ملف مريض', '2 جيجابايت للصور والملفات']);
    expect(limitLines(pro.limits)).toEqual(['حتى 5 فروع', 'أطباء بلا حد', 'حتى 30 مستخدمًا', 'حتى 50,000 ملف مريض', '20 جيجابايت للصور والملفات']);
    expect(limitLines({ branches: 2, staff: 11, storage_mb: 500 })).toEqual(['فرعان', 'أطباء بلا حد', 'حتى 11 مستخدمًا', 'ملفات مرضى بلا حد', '500 ميجابايت للصور والملفات']);
  });
  it('the trial in the FAQ comes from the plans; with no trial those answers are left out', () => {
    expect(trialDays([basic, { ...pro, trial_days: 30 }])).toBe(30);
    expect(faqs(14)[0].a).toContain('14 يومًا');
    expect(faqs(0).some((q) => q.q.includes('تجربة'))).toBe(false);
  });
});

describe('the contact form (LND-04)', () => {
  it('accepts Egyptian and international numbers, in any digits', () => {
    expect(looksLikePhone('01012345678')).toBe(true);
    expect(looksLikePhone('٠١٠١٢٣٤٥٦٧٨')).toBe(true);
    expect(looksLikePhone('+966 50 123 4567')).toBe(true);
    expect(looksLikePhone('12345')).toBe(false);
  });
  it('names what is missing before sending', () => {
    expect(leadProblems(EMPTY_LEAD)).toEqual({ fullName: expect.any(String), phone: expect.any(String) });
    expect(leadProblems({ ...EMPTY_LEAD, fullName: 'منى', phone: '01012345678', email: 'not-mail' })).toEqual({ email: expect.any(String) });
    expect(leadProblems({ ...EMPTY_LEAD, fullName: 'منى', phone: '01012345678' })).toEqual({});
  });
  it('sends only what was filled in', () => {
    expect(leadBody({ ...EMPTY_LEAD, fullName: ' منى ', phone: '01012345678', city: 'طنطا' }))
      .toEqual({ fullName: 'منى', phone: '01012345678', city: 'طنطا', source: 'landing' });
  });
  it('every message is Arabic', () => {
    for (const code of ['validation_failed', 'rate_limited', 'upstream_unavailable', 'unknown']) expect(leadError(code)).toMatch(/[\u0600-\u06FF]/);
  });
});
