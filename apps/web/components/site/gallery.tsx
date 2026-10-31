import { imageProps, type SiteImage } from '../../lib/media';
import { ar, type SiteCase, type SitePhoto } from '../../lib/site';
import { Section } from './decor';

const SIZES = '(max-width: 560px) 100vw, (max-width: 900px) 50vw, 380px';

/** A case image's props: served by `/case-media` (never cached: the patient's consent can be withdrawn). */
function caseImageProps(img: SiteImage, target: number) {
  const widths = [...img.widths].sort((a, b) => a - b);
  const pick = widths.find((w) => w >= target) ?? widths[widths.length - 1];
  const url = (w: number) => `/case-media/${img.id}-${w}.webp`;
  return { src: url(pick), srcSet: widths.map((w) => `${url(w)} ${w}w`).join(', '), width: img.width, height: img.height };
}

/**
 * The clinic's gallery on its site: before/after cases first (Phase 2C-2; published only with the patient's consent),
 * then its published photos (Phase 2C-1), featured first, with their captions.
 */
export function GallerySection({ photos, cases, clinicName, tint }: { photos: SitePhoto[]; cases: SiteCase[]; clinicName: string; tint?: boolean }) {
  if (!photos.length && !cases.length) return null;
  return (
    <Section id="gallery" kicker="المعرض" title={cases.length ? 'حالات من عيادتنا' : 'تعرّف على المكان قبل زيارتك'}
      sub={cases.length ? `قبل العلاج وبعده، وصور من داخل ${clinicName}` : `صور من داخل ${clinicName}`} tint={tint}>
      {cases.length > 0 && (
        <>
          <ul className="s-cases">
            {cases.map((c) => {
              const caption = ar(c.caption_ar, null);
              const what = caption ?? c.service_ar ?? 'الحالة';
              return (
                <li key={c.id} data-reveal>
                  <figure className="s-case">
                    <div className="s-case-pair">
                      <div className="s-case-img">
                        <img {...caseImageProps(c.before, 480)} sizes={SIZES} alt={`${c.alt_ar ?? what}: قبل العلاج`} loading="lazy" decoding="async" />
                        <span className="s-case-tag">قبل</span>
                      </div>
                      <div className="s-case-img">
                        <img {...caseImageProps(c.after, 480)} sizes={SIZES} alt={`${c.alt_ar ?? what}: بعد العلاج`} loading="lazy" decoding="async" />
                        <span className="s-case-tag is-after">بعد</span>
                      </div>
                    </div>
                    {(caption || c.service_ar) && (
                      <figcaption>
                        {c.service_ar && <span className="s-tag"><bdi>{c.service_ar}</bdi></span>}
                        {caption && <span>{caption}</span>}
                      </figcaption>
                    )}
                  </figure>
                </li>
              );
            })}
          </ul>
          {/* honest framing: results are the patients', shared with their consent, and differ from case to case */}
          <p className="s-cases-note">الصور منشورة بموافقة أصحابها. تختلف النتائج من حالة لأخرى حسب الفحص وخطة العلاج.</p>
        </>
      )}
      {photos.length > 0 && (
        <ul className={`s-gallery${cases.length ? ' has-cases' : ''}`}>
          {photos.map((p) => {
            const caption = ar(p.caption_ar, p.caption_en);
            return (
              <li key={p.id} data-reveal>
                <figure className="s-photo">
                  <img {...imageProps(p.image, 640)} sizes={SIZES} alt={ar(p.alt_ar, p.alt_en) ?? caption ?? ''} loading="lazy" decoding="async" />
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
