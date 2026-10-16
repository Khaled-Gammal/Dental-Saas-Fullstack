import { Tooth } from '../icons';
import { imageProps, type SiteImage } from '../../lib/media';

/** The clinic's logo next to its name, or the tooth mark when no logo was uploaded. The name stays as text for screen readers and search. */
export function BrandMark({ name, logo }: { name: string; logo?: SiteImage | null }) {
  return (
    <>
      {logo
        ? <img className="s-logo" {...imageProps(logo, 256)} sizes="(max-width: 640px) 128px, 256px" alt="" decoding="async" />
        : <span className="s-mark"><Tooth /></span>}
      <bdi>{name}</bdi>
    </>
  );
}
