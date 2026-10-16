import { describe, expect, it } from 'vitest';
import { imageProps, mediaPath } from '../media';

const img = { id: '11111111-2222-3333-4444-555555555555', width: 900, height: 600, widths: [640, 320, 900] };

describe('site images', () => {
  it('builds same-origin rendition paths', () => {
    expect(mediaPath(img, 320)).toBe('/media/11111111-2222-3333-4444-555555555555/320.webp');
  });

  it('picks the smallest rendition that covers the target, with a full srcset and the original size', () => {
    expect(imageProps(img, 400)).toEqual({
      src: '/media/11111111-2222-3333-4444-555555555555/640.webp',
      srcSet: '/media/11111111-2222-3333-4444-555555555555/320.webp 320w, /media/11111111-2222-3333-4444-555555555555/640.webp 640w, /media/11111111-2222-3333-4444-555555555555/900.webp 900w',
      width: 900,
      height: 600,
    });
  });

  it('falls back to the largest rendition when none is wide enough', () => {
    expect(imageProps(img, 2000).src).toBe('/media/11111111-2222-3333-4444-555555555555/900.webp');
  });
});
