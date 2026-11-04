import { readableOnWhite } from '@dental/ui/text';

/**
 * The platform's colour: the dashboard's palette before a clinic is known (sign-in, the platform panel) and for a
 * clinic that picked none. The same as the clinic websites' default (apps/web lib/site.ts DEFAULT_PRIMARY).
 */
export const PLATFORM_BRAND = '#4f46e5';

/** Text in the brand colour stays at least this readable on white, so it still reads on the light tints (as on the websites). */
const TEXT_CONTRAST = 5.2;

const HEX = /^#[0-9a-f]{6}$/i;

export type BrandVars = Record<'--brand' | '--brand-fill' | '--brand-text', string>;

/**
 * The three values the dashboard's palette is mixed from (theme.css), from the clinic's website colour (2026-11-04):
 * the colour itself, for shapes and glows; a fill that keeps white text readable (buttons, active states), darkened
 * only as far as that needs; and a shade for text on white and on the tints. Anything but a plain #rrggbb falls back
 * to the platform colour, so a stored value can never inject styles.
 */
export function brandVars(color?: string | null): BrandVars {
  const brand = color && HEX.test(color) ? color.toLowerCase() : PLATFORM_BRAND;
  return {
    '--brand': brand,
    '--brand-fill': readableOnWhite(brand),
    '--brand-text': readableOnWhite(brand, undefined, TEXT_CONTRAST),
  };
}
