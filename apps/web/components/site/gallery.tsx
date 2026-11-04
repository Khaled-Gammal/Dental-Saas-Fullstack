import { imageProps, type SiteImage } from '../../lib/media';
import { ar, type SiteCase, type SitePhoto } from '../../lib/site';
import { CaseCompare } from './compare';
import { Section } from './decor';

/** A case image's props: served by `/case-media` (never cached: the patient's consent can be withdrawn). */
function caseImageProps(img: SiteImage, target: number) {
  const widths = [...img.widths].sort((a, b) => a - b);
  const pick = widths.find((w) => w >= target) ?? widths[widths.length - 1];
  const url = (w: number) => `/case-media/${img.id}-${w}.webp`;
  return { src: url(pick), srcSet: widths.map((w) => `${url(w)} ${w}w`).join(', '), width: img.width, height: img.height };
}

const CASE_SIZES = '(max-width: 760px) 100vw, 600px';

/**
 * The clinic's gallery on its site: before/after cases first (Phase 2C-2; published only with the patient's consent),
 * each as a picture with a divider to drag, then its published photos (Phase 2C-1) in a bento grid, featured first.
 */
export function GallerySection({ photos, cases, clinicName, tint }: { photos: SitePhoto[]; cases: SiteCase[]; clinicName: string; tint?: boolean }) {
  if (!photos.length && !cases.length) return null;
  return (
    <Section id="gallery" kicker="المعرض" title={cases.length ? 'حالات من عيادتنا' : 'تعرّف على المكان قبل زيارتك'}
      sub={cases.length ? `قبل العلاج وبعده، وصور من داخل ${clinicName}.` : `صور من داخل ${clinicName}.`} tint={tint}>
      {cases.length > 0 && (
        <>
          <ul className="c-cases" data-count={Math.min(cases.length, 3)}>
            {cases.map((c) => {
              const caption = ar(c.caption_ar, null);
              const what = c.alt_ar ?? caption ?? c.service_ar ?? 'الحالة';
              return (
                <li key={c.id} data-reveal>
                  <figure className="c-card c-case">
                    <CaseCompare before={caseImageProps(c.before, 720)} after={caseImageProps(c.after, 720)} sizes={CASE_SIZES}
                      alt={{ before: `${what}: قبل العلاج`, after: `${what}: بعد العلاج` }} />
                    {(caption || c.service_ar) && (
                      <figcaption>
                        {c.service_ar && <span className="c-chip"><bdi>{c.service_ar}</bdi></span>}
                        {caption && <span>{caption}</span>}
                      </figcaption>
                    )}
                  </figure>
                </li>
              );
            })}
          </ul>
          {/* honest framing: results are the patients', shared with their consent, and differ from case to case */}
          <p className="c-note">الصور منشورة بموافقة أصحابها. تختلف النتائج من حالة لأخرى حسب الفحص وخطة العلاج.</p>
        </>
      )}
      {photos.length > 0 && (
        <ul className={`c-photos${cases.length ? ' has-cases' : ''}`} data-count={Math.min(photos.length, 6)}>
          {photos.map((p, i) => {
            const caption = ar(p.caption_ar, p.caption_en);
            return (
              <li key={p.id} data-reveal>
                <figure className="c-photo">
                  <img {...imageProps(p.image, i === 0 ? 1200 : 640)} sizes={i === 0 ? '(max-width: 640px) 100vw, 640px' : '(max-width: 640px) 50vw, 320px'}
                    alt={ar(p.alt_ar, p.alt_en) ?? caption ?? ''} loading="lazy" decoding="async" />
                  {caption && <figcaption>{caption}</figcaption>}
                </figure>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
