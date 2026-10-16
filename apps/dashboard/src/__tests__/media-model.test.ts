import { describe, expect, it } from 'vitest';
import { imageFieldValue } from '../media-model';
import type { MediaImage } from '../types';

const img = (id: string): MediaImage => ({ id, width: 900, height: 900, widths: [320, 640, 900], thumbUrl: 'x', fullUrl: 'y' });

describe('imageFieldValue', () => {
  it('on a create sends only a chosen image', () => {
    expect(imageFieldValue(null, undefined)).toBeUndefined();
    expect(imageFieldValue(img('a'), undefined)).toBe('a');
  });
  it('on an edit sends a change, null for a removal, nothing when unchanged', () => {
    expect(imageFieldValue(img('a'), img('a'))).toBeUndefined();
    expect(imageFieldValue(null, null)).toBeUndefined();
    expect(imageFieldValue(img('b'), img('a'))).toBe('b');
    expect(imageFieldValue(img('b'), null)).toBe('b');
    expect(imageFieldValue(null, img('a'))).toBeNull();
  });
});
