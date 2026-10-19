/**
 * Arabic emails (L10N-004, CLR-08): one date-and-time wording for every message, and the right-to-left HTML part sent
 * next to the plain text. Pure; unit-tested.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

/** "الأحد 19 أكتوبر، 5:30 م": Latin digits, 12-hour clock with ص/م, in the given zone. */
export function emailWhen(at: Date | number, tz: string): string {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true });
    formatters.set(tz, f);
  }
  return f.format(at);
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The plain text as right-to-left HTML: escaped, lines kept, links clickable. */
export function rtlHtml(text: string): string {
  const body = escape(text).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" dir="ltr">${u}</a>`).replace(/\n/g, '<br>');
  return `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;padding:24px;background:#f6f7f9">`
    + `<div dir="rtl" style="max-width:560px;margin:0 auto;padding:24px;background:#fff;border-radius:12px;font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.8;color:#14213d;text-align:right">`
    + `${body}</div></body></html>`;
}
