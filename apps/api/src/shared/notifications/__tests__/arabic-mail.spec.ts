import { emailWhen, rtlHtml } from '../arabic-mail';

describe('Arabic emails (L10N-004, CLR-08)', () => {
  it('dates read in Arabic with Latin digits and a 12-hour clock', () => {
    const s = emailWhen(Date.UTC(2026, 9, 18, 14, 30), 'Africa/Cairo'); // 17:30 in Cairo (summer time)
    expect(s).toContain('أكتوبر');
    expect(s).toMatch(/5:30/);
    expect(s).toMatch(/م/);
    expect(s).not.toMatch(/[٠-٩]/);
  });
  it('the HTML part is right to left, escaped, with lines and links kept', () => {
    const h = rtlHtml('مرحبًا <b>\nhttps://x.test/#/invite/abc');
    expect(h).toContain('lang="ar" dir="rtl"');
    expect(h).toContain('&lt;b&gt;<br>');
    expect(h).toContain('<a href="https://x.test/#/invite/abc" dir="ltr">');
  });
});
