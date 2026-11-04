import type { CSSProperties } from 'react';
import { themeVars } from './palette';
import { safeColor } from './site';

export { BRAND_TEXT_CONTRAST } from './palette';

/**
 * The clinic's one colour input and the two derived from it for text: on the colour (buttons) and in the colour (links,
 * prices, labels on white and on light tints). Every other tint and shade is mixed in CSS (app/site.css). Only a plain
 * #rrggbb reaches the style attribute (safeColor).
 */
export function brandStyle(primary?: string): CSSProperties {
  return themeVars(safeColor(primary));
}
