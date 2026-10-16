import { describe, expect, it } from 'vitest';
import { canReorder, describedEnough, galleryBody, galleryProblems, moveId, uploadProblem, type GalleryForm } from '../gallery-model';

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
