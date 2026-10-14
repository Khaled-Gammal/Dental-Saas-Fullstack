import type { ReactNode } from 'react';
import { archGumPath, dentalArch, SPARKLE_PATH, TOOTH_PATH } from '@dental/ui/arch';
import { Sparkle, Tooth } from '../icons';

const ARCH = dentalArch(14);
const GUM = archGumPath();

/** Dental arch from the shared geometry. One drop-shadow on the group (not per tooth) keeps repaints cheap. */
export function Arch() {
  return (
    <svg className="s-arch" viewBox="0 0 320 200" aria-hidden>
      <path d={GUM} className="s-arch-gum" />
      <g className="s-arch-teeth">{ARCH.map((t, i) => <path key={i} d={TOOTH_PATH} transform={t.transform} />)}</g>
      <path d={SPARKLE_PATH} transform="translate(160 4) scale(8)" className="s-arch-spark" />
      <path d={SPARKLE_PATH} transform="translate(222 26) scale(4.5)" className="s-arch-spark" />
      <path d={SPARKLE_PATH} transform="translate(100 22) scale(3.5)" className="s-arch-spark" />
    </svg>
  );
}

/** A smile-shaped curve used as the top/bottom edge of a tinted section. */
const Smile = ({ className }: { className: string }) => (
  <svg className={className} viewBox="0 0 1440 64" preserveAspectRatio="none" aria-hidden><path d="M0 0 H1440 Q720 128 0 0 Z" /></svg>
);

export function Section({ id, title, sub, tint, children }: { id: string; title: string; sub?: string; tint?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={`s-section${tint ? ' s-tint' : ''}`} aria-labelledby={`${id}-t`}>
      {tint && <Smile className="s-smile s-smile-top" />}
      <div className="s-wrap">
        <header className="s-head">
          <span className="s-ornament" aria-hidden><Sparkle /><Tooth size={18} /><Sparkle /></span>
          <h2 id={`${id}-t`}>{title}</h2>
          {sub && <p>{sub}</p>}
        </header>
        {children}
      </div>
      {tint && <Smile className="s-smile s-smile-bottom" />}
    </section>
  );
}
