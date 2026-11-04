import { describe, expect, it } from 'vitest';
import { brandVars, PLATFORM_BRAND } from '../theme-model';

/** WCAG contrast of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b2] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

// the colours a clinic picks from in its profile (screens/profile.tsx PRESETS), plus a light one typed by hand
const COLOURS = ['#1d6fd8', '#0e9aa7', '#12b5a0', '#0f2f5c', '#6d4ed6', '#d6457a', '#facc15'];

describe('the dashboard palette from the clinic colour (2026-11-04)', () => {
  it('white text reads on the fill, and the text shade reads on white, for every colour', () => {
    for (const c of COLOURS) {
      const v = brandVars(c);
      expect([c, contrast(v['--brand-fill'], '#ffffff') >= 4.5]).toEqual([c, true]);
      expect([c, contrast(v['--brand-text'], '#ffffff') >= 5.2]).toEqual([c, true]);
    }
  });
  it('a colour that already reads keeps itself as the fill; a light one is darkened, the colour stays for shapes', () => {
    expect(brandVars('#6d4ed6')).toEqual({ '--brand': '#6d4ed6', '--brand-fill': '#6d4ed6', '--brand-text': '#6d4ed6' });
    const mint = brandVars('#12B5A0');
    expect(mint['--brand']).toBe('#12b5a0');
    expect(mint['--brand-fill']).not.toBe('#12b5a0');
  });
  it('no colour, or anything but #rrggbb, is the platform colour', () => {
    expect(brandVars(null)['--brand']).toBe(PLATFORM_BRAND);
    expect(brandVars(undefined)['--brand']).toBe(PLATFORM_BRAND);
    expect(brandVars('red; background: url(x)')['--brand']).toBe(PLATFORM_BRAND);
    expect(brandVars('#12b5a')['--brand']).toBe(PLATFORM_BRAND);
  });
});
