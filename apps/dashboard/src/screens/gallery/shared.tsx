import { pickName } from '@dental/ui/text';
import { Choice, type Option } from '../../components/choice';
import { t, type Lang } from '../../i18n';
import type { Branch, MediaImage } from '../../types';
import { imageSrcSet } from '../../gallery-model';

/** Scope choices: the whole clinic, then each active branch. `withAll` adds "all photos" (list filter only). */
export function scopeOptions(lang: Lang, branches: Branch[], withAll: boolean): Option[] {
  return [
    ...(withAll ? [{ value: 'all', label: t('allPhotos', lang) }] : []),
    { value: 'clinic', label: t('clinicWide', lang) },
    ...branches.filter((b) => b.is_active).map((b) => ({ value: b.id, label: `${t('branch', lang)}: ${pickName(lang, b.name_ar, b.name_en, b.slug)}` })),
  ];
}

export function ScopeSelect({ lang, branches, value, onChange, withAll, id, label }: { lang: Lang; branches: Branch[]; value: string; onChange: (v: string) => void; withAll: boolean; id?: string; label?: string }) {
  return <Choice id={id} lang={lang} value={value} onChange={onChange} options={scopeOptions(lang, branches, withAll)} label={label} />;
}

/** A signed image with its real aspect ratio reserved, so the grid does not jump while images load. */
export function Thumb({ img, alt, sizes = '(max-width: 640px) 50vw, 240px' }: { img: MediaImage; alt: string; sizes?: string }) {
  return (
    <img className="thumb" src={img.thumbUrl} srcSet={imageSrcSet(img)} sizes={sizes} alt={alt} loading="lazy" decoding="async"
      width={img.width} height={img.height} style={{ aspectRatio: `${img.width} / ${img.height}` }} />
  );
}
