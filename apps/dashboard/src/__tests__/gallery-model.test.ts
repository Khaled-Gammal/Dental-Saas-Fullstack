import { describe, expect, it } from 'vitest';
import { canReorder, caseBody, caseProblems, describedEnough, emptyCase, galleryBody, galleryProblems, moveId, toCaseForm, uploadProblem, withNewImage, type GalleryForm } from '../gallery-model';
import type { GalleryCase, MediaImage } from '../types';

describe('uploadProblem', () => {
  it('accepts JPEG, PNG and WebP up to 10 MB', () => {
    expect(uploadProblem({ type: 'image/jpeg', size: 5_000_000 })).toBeNull();
    expect(uploadProblem({ type: 'image/webp', size: 10 * 1024 * 1024 })).toBeNull();
  });
  it('refuses other types and bigger files', () => {
    expect(uploadProblem({ type: 'image/gif', size: 100 })).toBe('type');
    expect(uploadProblem({ type: 'image/heic', size: 100 })).toBe('type');
    expect(uploadProblem({ type: 'image/png', size: 10 * 1024 * 1024 + 1 })).toBe('size');
  });
});

describe('ordering', () => {
  it('moves one item and stops at the ends', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });
  it('is offered only for one complete scope', () => {
    expect(canReorder({ scope: 'clinic', status: 'all', q: '', hasMore: false })).toBe(true);
    expect(canReorder({ scope: 'all', status: 'all', q: '', hasMore: false })).toBe(false);
    expect(canReorder({ scope: 'clinic', status: 'published', q: '', hasMore: false })).toBe(false);
    expect(canReorder({ scope: 'clinic', status: 'all', q: 'x', hasMore: false })).toBe(false);
    expect(canReorder({ scope: 'clinic', status: 'all', q: '', hasMore: true })).toBe(false);
  });
});

const base: GalleryForm = { branchId: '', captionAr: '', captionEn: '', altAr: '', altEn: '', isPublished: false, isFeatured: false };

describe('publishing rules', () => {
  it('a published photo needs a description; featured needs published', () => {
    expect(describedEnough(base)).toBe(false);
    expect(galleryProblems({ ...base, isPublished: true })).toEqual(['alt_required']);
    expect(galleryProblems({ ...base, isPublished: true, altAr: 'غرفة الكشف' })).toEqual([]);
    expect(galleryProblems({ ...base, isFeatured: true })).toEqual(['featured_requires_published']);
  });
});

describe('galleryBody', () => {
  it('sends only what changed; emptied text is null; clinic-wide is a null branch', () => {
    const orig = { ...base, captionAr: 'قديم', branchId: 'b1' };
    expect(galleryBody({ ...orig, captionAr: '  ' }, orig)).toEqual({ captionAr: null });
    expect(galleryBody({ ...orig, branchId: '' }, orig)).toEqual({ branchId: null });
    expect(galleryBody({ ...orig, isPublished: true, altAr: ' وصف ' }, orig)).toEqual({ isPublished: true, altAr: 'وصف' });
    expect(galleryBody(orig, orig)).toEqual({});
  });
});

describe('before/after cases (Phase 2C-2)', () => {
  const img = (id: string): MediaImage => ({ id, width: 900, height: 600, widths: [320], thumbUrl: 't', fullUrl: 'f' });
  const c: GalleryCase = {
    id: 'c1', serviceId: null, serviceName: null, captionAr: 'تبييض', altAr: null, isPublished: true, consentConfirmed: true,
    consentConfirmedAt: '2026-11-01T10:00:00Z', consentConfirmedBy: 'د. أحمد', sortOrder: 0, updatedAt: '', before: img('b'), after: img('a'),
  };
  it('two different images; published only with consent and a description', () => {
    expect(caseProblems(emptyCase)).toEqual(['images_required']);
    expect(caseProblems({ ...emptyCase, before: img('x'), after: img('x') })).toEqual(['same_image']);
    expect(caseProblems({ ...emptyCase, before: img('b'), after: img('a'), isPublished: true })).toEqual(['consent_required', 'alt_required']);
    expect(caseProblems({ ...emptyCase, before: img('b'), after: img('a'), isPublished: true, consentConfirmed: true, altAr: 'ابتسامة' })).toEqual([]);
    expect(caseProblems(toCaseForm(c))).toEqual([]);
  });
  it('a new case sends everything; an edit only the changes; withdrawing consent unpublishes', () => {
    expect(caseBody({ ...emptyCase, before: img('b'), after: img('a'), captionAr: ' تبييض ', consentConfirmed: true, isPublished: true }, null)).toEqual({
      beforeFileId: 'b', afterFileId: 'a', serviceId: null, captionAr: 'تبييض', altAr: null, consentConfirmed: true, isPublished: true,
    });
    const orig = toCaseForm(c);
    // a new image drops the consent in the form; confirmed again, it is sent with the image
    const changed = withNewImage(orig, 'after', img('a2'));
    expect(changed).toMatchObject({ consentConfirmed: false, isPublished: false });
    expect(caseBody(changed, orig)).toEqual({ afterFileId: 'a2', consentConfirmed: false, isPublished: false });
    expect(caseBody({ ...changed, consentConfirmed: true, isPublished: true }, orig)).toEqual({ afterFileId: 'a2', consentConfirmed: true, isPublished: true });
    expect(caseBody({ ...orig, consentConfirmed: false }, orig)).toEqual({ consentConfirmed: false, isPublished: false });
    expect(caseBody(orig, orig)).toEqual({});
  });
});
