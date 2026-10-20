import { describe, expect, it } from 'vitest';
import { docsFor, legalHref, parseLegalRoute, type LegalDoc } from '../legal-model';

describe('legal documents (H6)', () => {
  it('opens the three documents by their links, nothing else', () => {
    for (const k of ['terms', 'privacy', 'dpa'] as const) expect(parseLegalRoute(legalHref(k))).toBe(k);
    expect(parseLegalRoute('#/legal/cookies')).toBeNull();
    expect(parseLegalRoute('#/legal')).toBeNull();
    expect(parseLegalRoute('#/patients')).toBeNull();
  });
  it('staff accept Terms and Privacy; an owner the DPA too', () => {
    const docs: LegalDoc[] = [
      { id: 't', kind: 'terms', version: 1, title_ar: 'شروط' }, { id: 'p', kind: 'privacy', version: 1, title_ar: 'خصوصية' },
      { id: 'd', kind: 'dpa', version: 1, title_ar: 'اتفاقية' },
    ];
    expect(docsFor(docs, false).map((d) => d.id)).toEqual(['t', 'p']);
    expect(docsFor(docs, true).map((d) => d.id)).toEqual(['t', 'p', 'd']);
  });
});
