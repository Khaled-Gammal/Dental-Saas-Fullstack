import type { ReactNode } from 'react';
import { MOLAR_PATH, SPARKLE_PATH } from '@dental/ui/arch';
import { Sparkle } from '../icons';

/**
 * The clinic website's drawings: plain SVG rendered on the server, coloured only through CSS classes that read the
 * clinic's --brand (app/site.css), so every clinic gets its own version and no JavaScript is shipped.
 */

/** The glossy tooth: a depth layer, the enamel, a side shade, and the highlights. Ids are prefixed by `id`. */
function GlossyTooth({ id }: { id: string }) {
  return (
    <>
      <path d={MOLAR_PATH} transform="translate(9 11)" className="art-depth" />
      <path d={MOLAR_PATH} fill={`url(#${id}-enamel)`} />
      <path d={MOLAR_PATH} fill={`url(#${id}-shade)`} />
      <path d="M58 46C72 36 94 40 102 52C92 58 76 62 64 74C56 66 52 54 58 46Z" fill="#fff" />
      <path d="M42 82C40 100 44 120 52 136" className="art-shine" />
      <circle cx="152" cy="52" r="5" fill="#fff" />
    </>
  );
}

function ToothDefs({ id }: { id: string }) {
  return (
    <>
      <linearGradient id={`${id}-enamel`} x1="0.1" y1="0" x2="0.8" y2="1">
        <stop offset="0" stopColor="#fff" />
        <stop offset="0.55" stopColor="#fff" />
        <stop offset="1" className="art-enamel-end" />
      </linearGradient>
      <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0.5" className="art-shade-0" />
        <stop offset="1" className="art-shade-1" />
      </linearGradient>
    </>
  );
}

/** A sparkle placed with a wrapper group, so CSS may animate the path itself without losing its position. */
const Spark = ({ x, y, r, className = '' }: { x: number; y: number; r: number; className?: string }) => (
  <g transform={`translate(${x} ${y}) scale(${r})`}><path d={SPARKLE_PATH} className={`art-spark ${className}`} /></g>
);

/**
 * Hero illustration: a tall arch in the brand colour holding a floating glossy tooth, with soft shapes around it
 * (a pastel disc, a dot grid, a half circle and a dashed ring), sparkles and bubbles. `id` prefixes the gradient ids, so
 * the drawing can appear more than once on a page (the landing page shows it inside its mock-ups).
 */
export function HeroArt({ id = 'ha', className = 'c-hero-art' }: { id?: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 520 580" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`${id}-arch`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" className="art-arch-0" />
          <stop offset="1" className="art-arch-1" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-floor`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.32" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <pattern id={`${id}-dots`} width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.8" className="art-dot" />
        </pattern>
        <ToothDefs id={id} />
      </defs>
      <circle className="art-blob" cx="116" cy="150" r="104" />
      <rect x="386" y="66" width="114" height="114" fill={`url(#${id}-dots)`} />
      <path className="art-half" d="M10 580a112 112 0 0 1 224 0Z" />
      <circle className="art-ring" cx="456" cy="472" r="52" />
      <path d="M96 552V282a164 164 0 0 1 328 0v270a28 28 0 0 1-28 28H124a28 28 0 0 1-28-28Z" fill={`url(#${id}-arch)`} />
      <path className="art-line" d="M136 580V290a124 124 0 0 1 248 0v290" />
      <path className="art-line art-line-2" d="M176 580V298a84 84 0 0 1 168 0v282" />
      <circle cx="260" cy="318" r="156" fill={`url(#${id}-glow)`} />
      <ellipse className="art-floor" cx="260" cy="486" rx="84" ry="11" fill={`url(#${id}-floor)`} />
      <g className="art-float">
        <g transform="translate(140 200)"><GlossyTooth id={id} /></g>
      </g>
      <Spark x={374} y={204} r={17} />
      <Spark x={152} y={292} r={10} />
      <Spark x={336} y={134} r={7} className="art-spark-accent" />
      <g className="art-bubbles">
        <circle cx="180" cy="210" r="7" />
        <circle cx="366" cy="424" r="10" />
        <circle cx="150" cy="436" r="5" />
      </g>
    </svg>
  );
}

/** The closing band's drawing: rings and a large outlined tooth, in the text colour at low strength. */
export function CtaArt() {
  return (
    <svg className="c-cta-art" viewBox="0 0 360 360" aria-hidden focusable="false">
      <circle cx="180" cy="180" r="170" className="cta-ring" />
      <circle cx="180" cy="180" r="128" className="cta-ring cta-ring-dash" />
      <circle cx="180" cy="180" r="86" className="cta-disc" />
      <path d={MOLAR_PATH} transform="translate(108 112) scale(0.6)" className="cta-tooth" />
      <Spark x={292} y={74} r={14} className="cta-spark" />
      <Spark x={70} y={250} r={9} className="cta-spark" />
      <Spark x={300} y={286} r={6} className="cta-spark" />
    </svg>
  );
}

/** A small glossy tooth on its own (empty states and the booking pages' aside). */
export function ToothBadge() {
  return (
    <svg className="c-tooth-badge" viewBox="0 0 240 270" aria-hidden focusable="false">
      <defs><ToothDefs id="tb" /></defs>
      <g className="art-float"><GlossyTooth id="tb" /></g>
    </svg>
  );
}

const ROADS: [string, string][] = [
  ['M-20 74 488 38', 'm-xl'], ['M146 -20 196 240', 'm-lg'], ['M334 -20 302 240', 'm-md'], ['M-20 146 500 118', 'm-md'],
  ['M62 -20 84 240', 'm-sm'], ['M414 -20 424 240', 'm-sm'], ['M196 104 316 96', 'm-sm'], ['M-20 196 150 186', 'm-sm'],
];

/**
 * A branch card's header when the branch has no photo: a drawn neighbourhood (roads, a park, water) with the brand pin.
 * Decoration only, never a real map; `flip` mirrors it so two branches side by side don't look the same.
 */
export function MapArt({ flip = false }: { flip?: boolean }) {
  return (
    <svg className="c-map" viewBox="0 0 480 220" preserveAspectRatio="xMidYMid slice" aria-hidden focusable="false">
      <rect width="480" height="220" className="m-ground" />
      <g transform={flip ? 'translate(480 0) scale(-1 1)' : undefined}>
        <path className="m-park" d="M316 0h164v88c-38 12-84 10-122-8s-42-46-42-80Z" />
        <path className="m-water" d="M0 178c62-28 122-30 182-8s128 26 188 0 88-28 110-26v76H0Z" />
        <rect className="m-block" x="214" y="132" width="64" height="40" rx="8" />
        <rect className="m-block" x="20" y="88" width="46" height="34" rx="8" />
        <rect className="m-block" x="352" y="138" width="52" height="30" rx="8" />
        <g className="m-edge">{ROADS.map(([d, c]) => <path key={d} d={d} className={c} />)}</g>
        <g className="m-road">{ROADS.map(([d, c]) => <path key={d} d={d} className={c} />)}</g>
      </g>
      <g className="m-pin" transform="translate(240 132)">
        <circle cy="-30" r="40" className="m-pulse" />
        <path d="M0 0C-12-13-20-23-20-33a20 20 0 0 1 40 0C20-23 12-13 0 0Z" className="m-drop" />
        <circle cy="-33" r="7" fill="#fff" />
      </g>
    </svg>
  );
}

/**
 * A picture in an arch-shaped frame with the hero's shapes around it (a pastel disc, a dot grid, a sparkle): a
 * service's photo, or its icon drawn large on the brand colour.
 */
export function ArchVisual({ children, plain = false }: { children: ReactNode; plain?: boolean }) {
  return (
    <div className="c-arch-visual">
      <span className="c-arch-blob" aria-hidden />
      <span className="c-arch-dots" aria-hidden />
      <div className={`c-arch${plain ? ' is-art' : ''}`}>{children}</div>
      <Sparkle size={30} className="c-arch-spark" />
    </div>
  );
}

/** The hand-drawn stroke under the last word of the hero title. */
export const Swash = () => (
  <svg className="c-swash-line" viewBox="0 0 200 24" preserveAspectRatio="none" aria-hidden focusable="false">
    <path d="M5 17C44 8 96 4 195 11" />
  </svg>
);

/** A section's heading block: a small label, the title, and an optional line and action on the other side. */
export function SectionHead({ id, kicker, title, sub, action, stacked = false }: { id: string; kicker?: string; title: string; sub?: string; action?: ReactNode; stacked?: boolean }) {
  return (
    <header className={`c-head${stacked ? ' is-stacked' : ''}`} data-reveal>
      <div className="c-head-main">
        {kicker && <span className="c-kicker"><Sparkle size={11} />{kicker}</span>}
        <h2 id={`${id}-t`}>{title}</h2>
      </div>
      {(sub || action) && <div className="c-head-side">{sub && <p>{sub}</p>}{action}</div>}
    </header>
  );
}

/** A page section; `tint` sets it on a soft brand panel (the home page alternates them down the page). */
export function Section({ id, kicker, title, sub, action, tint, className, children }: { id: string; kicker?: string; title: string; sub?: string; action?: ReactNode; tint?: boolean; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={['c-section', tint && 'is-tint', className].filter(Boolean).join(' ')} aria-labelledby={`${id}-t`}>
      <div className="c-wrap">
        <SectionHead id={id} kicker={kicker} title={title} sub={sub} action={action} />
        {children}
      </div>
    </section>
  );
}
