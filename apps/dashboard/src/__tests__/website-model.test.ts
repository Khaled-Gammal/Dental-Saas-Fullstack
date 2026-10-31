import { describe, expect, it } from 'vitest';
import { faqBody, faqProblems, moveSection, sameSections, searchPreview, seoBody, seoProblems, toFaqForm, toSeoForm, emptyFaq } from '../website-model';
import type { Faq, WebsiteSection } from '../types';

const LIST: WebsiteSection[] = [
  { key: 'services', visible: true }, { key: 'doctors', visible: true }, { key: 'gallery', visible: false }, { key: 'faq', visible: true }, { key: 'branches', visible: true },
];

describe('website sections (Phase 2C-1)', () => {
  it('moves a section one place, and not past either end', () => {
    expect(moveSection(LIST, 'gallery', -1).map((s) => s.key)).toEqual(['services', 'gallery', 'doctors', 'faq', 'branches']);
    expect(moveSection(LIST, 'gallery', 1).map((s) => s.key)).toEqual(['services', 'doctors', 'faq', 'gallery', 'branches']);
    expect(moveSection(LIST, 'services', -1)).toEqual(LIST);
    expect(moveSection(LIST, 'branches', 1)).toEqual(LIST);
    expect(moveSection(LIST, 'gallery', -1)[1]).toEqual({ key: 'gallery', visible: false }); // its visibility goes with it
  });
  it('tells a changed layout from the saved one', () => {
    expect(sameSections(LIST, [...LIST])).toBe(true);
    expect(sameSections(LIST, moveSection(LIST, 'faq', -1))).toBe(false);
    expect(sameSections(LIST, LIST.map((s) => (s.key === 'faq' ? { ...s, visible: false } : s)))).toBe(false);
  });
});

describe('the question form (Phase 2C-1)', () => {
  const faq: Faq = { id: 'f1', questionAr: 'هل يوجد موقف؟', answerAr: 'نعم', questionEn: null, answerEn: null, serviceId: null, isActive: true, sortOrder: 0, updatedAt: '' };
  it('checks the lengths after trimming, as the API does', () => {
    expect(faqProblems(emptyFaq)).toEqual(['question_short', 'answer_short']);
    expect(faqProblems({ ...emptyFaq, questionAr: '  سؤال  ', answerAr: 'نعم' })).toEqual(['question_short']);
    expect(faqProblems({ ...emptyFaq, questionAr: 'س'.repeat(301), answerAr: 'ن'.repeat(3001) })).toEqual(['question_long', 'answer_long']);
    expect(faqProblems(toFaqForm(faq))).toEqual([]);
  });
  it('sends everything for a new question, only the changes for an edit', () => {
    expect(faqBody({ ...emptyFaq, questionAr: ' هل يوجد موقف؟ ', answerAr: 'نعم\nمجاني' }, null))
      .toEqual({ questionAr: 'هل يوجد موقف؟', answerAr: 'نعم\nمجاني', serviceId: null, isActive: true });
    const orig = toFaqForm(faq);
    expect(faqBody({ ...orig, answerAr: 'نعم، مجاني' }, orig)).toEqual({ answerAr: 'نعم، مجاني' });
    expect(faqBody({ ...orig, serviceId: 's1', isActive: false }, orig)).toEqual({ serviceId: 's1', isActive: false });
    expect(faqBody(orig, orig)).toEqual({});
  });
});

describe('search results and sharing (Phase 2C-3)', () => {
  const img = { id: 'i1', width: 1200, height: 630, widths: [640, 1280], thumbUrl: 't', fullUrl: 'f' };
  const orig = toSeoForm({ title: null, description: null, shareImage: null });
  it('empty is fine (the defaults); filled fields fit the limits', () => {
    expect(seoProblems(orig)).toEqual([]);
    expect(seoProblems({ ...orig, title: 'abc', description: 'قصير' })).toEqual(['title_short', 'description_short']);
    expect(seoProblems({ ...orig, title: 'ع'.repeat(71), description: 'و'.repeat(201) })).toEqual(['title_long', 'description_long']);
  });
  it('sends only the changes; emptied text goes back to the default', () => {
    expect(seoBody({ ...orig, title: ' عيادة الابتسامة لطب الأسنان ' }, orig)).toEqual({ title: 'عيادة الابتسامة لطب الأسنان' });
    const saved = toSeoForm({ title: 'عيادة الابتسامة', description: null, shareImage: img });
    expect(seoBody({ ...saved, title: '', shareImage: null }, saved)).toEqual({ title: null, shareFileId: null });
    expect(seoBody(saved, saved)).toEqual({});
  });
  it('previews the result with the defaults the site uses, cut like Google', () => {
    expect(searchPreview(orig, 'عيادة الابتسامة', null).title).toBe('عيادة الابتسامة | عيادة أسنان');
    expect(searchPreview(orig, 'عيادة الابتسامة', 'نهتم بابتسامتك').description).toBe('نهتم بابتسامتك');
    expect(searchPreview({ ...orig, title: 'ع'.repeat(70) }, 'x', null).title.length).toBe(60);
  });
});
