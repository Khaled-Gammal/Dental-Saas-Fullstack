/**
 * Phase 2C-1: the order of a clinic website's sections and which are shown, as the clinic set them in the dashboard
 * (the same rule as the API's normalizeSections). Unknown keys and repeats are dropped; a section the stored list does
 * not name (one added later) is shown in its default place. Pure, unit-tested.
 */
export const SECTION_KEYS = ['services', 'doctors', 'gallery', 'faq', 'branches'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/** The shown sections, in the clinic's order. */
export function visibleSections(stored: unknown): SectionKey[] {
  const out: { key: SectionKey; visible: boolean }[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(stored) ? stored : []) {
    const key = (s as { key?: unknown })?.key;
    if (typeof key !== 'string' || !(SECTION_KEYS as readonly string[]).includes(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key: key as SectionKey, visible: (s as { visible?: unknown }).visible !== false });
  }
  SECTION_KEYS.forEach((key, i) => {
    if (seen.has(key)) return;
    const before: readonly string[] = SECTION_KEYS.slice(0, i);
    let at = 0;
    out.forEach((s, j) => { if (before.includes(s.key)) at = j + 1; });
    out.splice(at, 0, { key, visible: true });
  });
  return out.filter((s) => s.visible).map((s) => s.key);
}

/** schema.org FAQPage for the questions shown (search engines may show them as rich results). */
export function faqStructuredData(faqs: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}
