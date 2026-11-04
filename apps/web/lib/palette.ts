import type { CSSProperties } from 'react';
import { onColor, readableOnWhite } from '@dental/ui/text';

/** Text in the brand colour stays at least this readable on white, so it still passes on the site's light brand tints. */
export const BRAND_TEXT_CONTRAST = 5.2;

/**
 * The CSS variables of a brand colour (a plain #rrggbb): the colour, text on it, and text in it. Pure and browser-safe,
 * so the landing page's colour demo computes them live with the same rules as the clinic sites (lib/theme.ts).
 */
export function themeVars(brand: string): CSSProperties {
  return { '--brand': brand, '--on-brand': onColor(brand), '--brand-text': readableOnWhite(brand, undefined, BRAND_TEXT_CONTRAST) } as CSSProperties;
}
