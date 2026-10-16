import type { MediaImage } from './types';

/**
 * The request value for a record's single image: undefined when unchanged (left out of a PATCH), the new file id,
 * or null to remove it. On a create (`orig` undefined) only a chosen image is sent.
 */
export function imageFieldValue(next: MediaImage | null, orig: MediaImage | null | undefined): string | null | undefined {
  if (orig === undefined) return next ? next.id : undefined;
  if ((next?.id ?? null) === (orig?.id ?? null)) return undefined;
  return next ? next.id : null;
}
