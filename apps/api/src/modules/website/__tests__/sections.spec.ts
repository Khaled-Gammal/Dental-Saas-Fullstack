import { normalizeSections, SECTION_KEYS } from '../sections';

describe('website sections (Phase 2C-1)', () => {
  it('nothing stored: the default order, all shown', () => {
    expect(normalizeSections([])).toEqual(SECTION_KEYS.map((key) => ({ key, visible: true })));
    expect(normalizeSections(null)).toEqual(SECTION_KEYS.map((key) => ({ key, visible: true })));
  });
  it('keeps the clinic\'s order and hidden sections', () => {
    const stored = [{ key: 'faq', visible: true }, { key: 'branches', visible: false }, { key: 'services', visible: true }, { key: 'doctors', visible: true }, { key: 'gallery', visible: false }];
    expect(normalizeSections(stored)).toEqual(stored);
  });
  it('drops unknown keys and repeats; a section the list does not name appears in its default place', () => {
    expect(normalizeSections([{ key: 'doctors', visible: false }, { key: 'hero', visible: true }, { key: 'doctors', visible: true }, { key: 'services' }]).map((s) => [s.key, s.visible]))
      .toEqual([['doctors', false], ['services', true], ['gallery', true], ['faq', true], ['branches', true]]);
  });
});
