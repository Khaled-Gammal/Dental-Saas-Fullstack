/** An image in the site payload: original size (for the aspect ratio) and the WebP widths that exist. */
export interface SiteImage { id: string; width: number; height: number; widths: number[] }

/** Same-origin path of one rendition; `app/sites/[host]/media` fetches it from the API for this clinic. */
export const mediaPath = (img: SiteImage, width: number) => `/media/${img.id}/${width}.webp`;

/**
 * Props for an <img>: a srcset of every rendition, `src` the smallest one at least `target` px wide (else the largest),
 * and the original width/height so the browser reserves the right box before the image arrives.
 */
export function imageProps(img: SiteImage, target: number) {
  const widths = [...img.widths].sort((a, b) => a - b);
  const pick = widths.find((w) => w >= target) ?? widths[widths.length - 1];
  return {
    src: mediaPath(img, pick),
    srcSet: widths.map((w) => `${mediaPath(img, w)} ${w}w`).join(', '),
    width: img.width,
    height: img.height,
  };
}
