import type { ReactNode } from 'react';
import { SPARKLE_PATH, TOOTH_PATH } from '@dental/ui/arch';
import { Sparkle, Tooth } from '../icons';

/**
 * Hero illustration: one polished tooth on a soft brand-tinted panel with thin orbit rings and a trust badge.
 * Pure SVG rendered on the server; colours come from the clinic's --brand so every tenant gets its own version.
 */
export function ToothArt() {
  return (
    <svg className="s-art-svg" viewBox="0 0 400 400" aria-hidden>
      <defs>
        <linearGradient id="s-art-panel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-200)" />
          <stop offset="1" stopColor="var(--brand-50)" />
        </linearGradient>
        <linearGradient id="s-art-tooth" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="var(--brand-100)" />
        </linearGradient>
        <radialGradient id="s-art-glow" cx="0.5" cy="0.45" r="0.5">
          <stop offset="0" stopColor="var(--brand)" stopOpacity="0.32" />
          <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="20" y="20" width="360" height="360" rx="56" fill="url(#s-art-panel)" />
      <circle cx="200" cy="205" r="150" fill="url(#s-art-glow)" />
      <g className="s-art-rings" fill="none" stroke="var(--brand)" strokeOpacity="0.28">
        <circle cx="200" cy="205" r="118" strokeWidth="1.2" />
        <circle cx="200" cy="205" r="150" strokeWidth="1" strokeDasharray="4 10" />
      </g>
      <g className="s-art-tooth">
        {/* depth layer, then the glossy crown */}
        <path d={TOOTH_PATH} transform="translate(72 84) scale(10.6)" fill="var(--brand)" opacity="0.38" />
        <path d={TOOTH_PATH} transform="translate(72 70) scale(10.6)" fill="url(#s-art-tooth)" stroke="var(--brand-200)" strokeWidth="0.3" />
        <ellipse cx="150" cy="150" rx="18" ry="34" transform="rotate(-20 150 150)" fill="#fff" opacity="0.75" />
      </g>
      <g className="s-art-spark" fill="var(--brand)">
        <path d={SPARKLE_PATH} transform="translate(312 96) scale(14)" />
        <path d={SPARKLE_PATH} transform="translate(86 118) scale(8)" />
        <path d={SPARKLE_PATH} transform="translate(300 300) scale(6)" />
      </g>
      {/* trust badge */}
      <g transform="translate(280 282)">
        <circle r="34" fill="var(--brand)" />
        <circle r="34" fill="none" stroke="#fff" strokeWidth="4" />
        <path d="M-13 1l8 8 17-17" fill="none" stroke="var(--on-brand)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** A smile-shaped curve used as the top/bottom edge of a tinted section. */
export const Smile = ({ className }: { className: string }) => (
  <svg className={className} viewBox="0 0 1440 64" preserveAspectRatio="none" aria-hidden><path d="M0 0 H1440 Q720 128 0 0 Z" /></svg>
);

export function Section({ id, kicker, title, sub, tint, children }: { id: string; kicker?: string; title: string; sub?: string; tint?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={`s-section${tint ? ' s-tint' : ''}`} aria-labelledby={`${id}-t`}>
      {tint && <Smile className="s-smile s-smile-top" />}
      <div className="s-wrap">
        <header className="s-head" data-reveal>
          {kicker
            ? <span className="s-kicker"><Sparkle />{kicker}</span>
            : <span className="s-ornament" aria-hidden><Sparkle /><Tooth size={18} /><Sparkle /></span>}
          <h2 id={`${id}-t`}>{title}</h2>
          {sub && <p>{sub}</p>}
        </header>
        {children}
      </div>
      {tint && <Smile className="s-smile s-smile-bottom" />}
    </section>
  );
}
