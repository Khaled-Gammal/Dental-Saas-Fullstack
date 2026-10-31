import { describe, expect, it } from 'vitest';
import { faqStructuredData, visibleSections } from '../sections';

describe('the website sections (Phase 2C-1)', () => {
  it('nothing set: every section in the default order', () => {
    expect(visibleSections([])).toEqual(['services', 'doctors', 'gallery', 'faq', 'branches']);
    expect(visibleSections(undefined)).toEqual(['services', 'doctors', 'gallery', 'faq', 'branches']);
  });
  it('the clinic\'s order, without the hidden ones', () => {
    expect(visibleSections([
      { key: 'faq', visible: true }, { key: 'branches', visible: true }, { key: 'services', visible: false }, { key: 'doctors', visible: true }, { key: 'gallery', visible: false },
    ])).toEqual(['faq', 'branches', 'doctors']);
  });
  it('unknown keys and repeats dropped; a section the list does not name shows in its default place', () => {
    expect(visibleSections([{ key: 'branches', visible: true }, { key: 'x', visible: true }, { key: 'branches', visible: false }, { key: 'services', visible: true }]))
      .toEqual(['branches', 'services', 'doctors', 'gallery', 'faq']);
  });
  it('FAQPage for search engines', () => {
    expect(faqStructuredData([{ q: 'هل يوجد موقف؟', a: 'نعم' }])).toEqual({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: [{ '@type': 'Question', name: 'هل يوجد موقف؟', acceptedAnswer: { '@type': 'Answer', text: 'نعم' } }],
    });
  });
});
