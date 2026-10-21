import { arName } from '@dental/ui/text';
import { Choice, type Option } from '../../components/choice';
import type { Branch, MediaImage } from '../../types';
import { imageSrcSet } from '../../gallery-model';

/** Scope choices: the whole clinic, then each active branch. `withAll` adds "all photos" (list filter only). */
export function scopeOptions(branches: Branch[], withAll: boolean): Option[] {
  return [
    ...(withAll ? [{ value: 'all', label: 'كل الصور' }] : []),
    { value: 'clinic', label: 'العيادة (كل الفروع)' },
    ...branches.filter((b) => b.is_active).map((b) => ({ value: b.id, label: `${'الفرع'}: ${arName(b.name_ar, b.name_en, b.slug)}` })),
  ];
}

export function ScopeSelect({ branches, value, onChange, withAll, id, label }: { branches: Branch[]; value: string; onChange: (v: string) => void; withAll: boolean; id?: string; label?: string }) {
  return <Choice id={id} value={value} onChange={onChange} options={scopeOptions(branches, withAll)} label={label} />;
}

/** A signed image with its real aspect ratio reserved, so the grid does not jump while images load. */
export function Thumb({ img, alt, sizes = '(max-width: 640px) 50vw, 240px' }: { img: MediaImage; alt: string; sizes?: string }) {
  return (
    <img className="thumb" src={img.thumbUrl} srcSet={imageSrcSet(img)} sizes={sizes} alt={alt} loading="lazy" decoding="async"
      width={img.width} height={img.height} style={{ aspectRatio: `${img.width} / ${img.height}` }} />
  );
}
