import { describe, expect, it } from 'vitest';
import { KEYS, t } from '../i18n';

/**
 * L10N-001: the dashboard shows Arabic only. Every text has an Arabic version written in Arabic letters; Latin letters
 * appear only for names and tokens on the allow-list (the owner allows brand names in English, CLR-07 note of
 * 2026-10-19). A new text without proper Arabic fails here.
 */
const ALLOWED_LATIN = /\b(QR|PDF|JPE?G|PNG|WEBP|HEIC|SVG|Enter|Mailpit|localhost|nasr-city|InstaPay|WhatsApp|Google|Maps|URL|ID|MB|PDPL|FDI|A4|A5|EGP|CSV|Excel|SMS|OTP|HTTPS?|www|clinic-a|lvh\.me|dental|example|com)\b/gi;

describe('Arabic only (L10N-001)', () => {
  it('every text has Arabic, written in Arabic letters', () => {
    const missing = KEYS.filter((k) => !t(k) || !/[\u0600-\u06FF]/.test(t(k)));
    expect(missing).toEqual([]);
  });
  it('no Arabic text carries English words outside the allow-list', () => {
    const latin = KEYS.filter((k) => /[A-Za-z]{2,}/.test(t(k).replace(ALLOWED_LATIN, '').replace(/\{[a-z]+\}/gi, '').replace(/#[0-9a-f]{6}/gi, '')))
      .map((k) => `${k}: ${t(k)}`);
    expect(latin).toEqual([]);
  });
});
