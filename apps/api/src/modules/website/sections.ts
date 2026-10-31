/**
 * Phase 2C-1: the clinic website's sections, in their default order. The hero, the trust figures and the closing
 * booking call stay where they are; these are the ones the clinic orders and hides. Pure, unit-tested.
 */
export const SECTION_KEYS = ['services', 'doctors', 'gallery', 'faq', 'branches'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export interface SectionSetting { key: SectionKey; visible: boolean }

/**
 * The full layout from what is stored: the stored order and visibility for the keys it names (unknown keys and
 * repeats dropped), and any key it does not name (a section added later) shown, in its default place.
 */
export function normalizeSections(stored: unknown): SectionSetting[] {
  const out: SectionSetting[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(stored) ? stored : []) {
    const key = (s as { key?: unknown })?.key;
    if (typeof key !== 'string' || !(SECTION_KEYS as readonly string[]).includes(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key: key as SectionKey, visible: (s as { visible?: unknown }).visible !== false });
  }
  SECTION_KEYS.forEach((key, i) => {
    if (seen.has(key)) return;
    // after the last stored key that comes before it by default
    const before = SECTION_KEYS.slice(0, i);
    let at = 0;
    out.forEach((s, j) => { if ((before as readonly string[]).includes(s.key)) at = j + 1; });
    out.splice(at, 0, { key, visible: true });
  });
  return out;
}
