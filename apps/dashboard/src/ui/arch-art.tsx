import { MOLAR_PATH, SPARKLE_PATH } from '@dental/ui/arch';

/** A sparkle placed by a wrapper group, so CSS can animate the path without moving it. */
const Spark = ({ x, y, r, soft }: { x: number; y: number; r: number; soft?: boolean }) => (
  <g transform={`translate(${x} ${y}) scale(${r})`}><path d={SPARKLE_PATH} className={`aa-spark${soft ? ' is-soft' : ''}`} /></g>
);

/**
 * The sign-in screens' drawing (2026-11-04), after the clinic websites' hero: a tall arch in the clinic colour holding
 * a floating glossy tooth, with a pastel disc, a dot grid, a dashed ring and sparkles. Plain SVG coloured through CSS
 * classes (styles.css, "arch art"), so it follows the colour; decoration only.
 */
export function ArchArt({ className = '' }: { className?: string }) {
  return (
    <svg className={`aa ${className}`} viewBox="0 0 420 440" aria-hidden focusable="false">
      <defs>
        <linearGradient id="aa-arch" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" className="aa-arch-0" />
          <stop offset="1" className="aa-arch-1" />
        </linearGradient>
        <linearGradient id="aa-enamel" x1="0.1" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.55" stopColor="#fff" />
          <stop offset="1" className="aa-enamel-end" />
        </linearGradient>
        <linearGradient id="aa-shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0.5" className="aa-shade-0" />
          <stop offset="1" className="aa-shade-1" />
        </linearGradient>
        <radialGradient id="aa-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="0.42" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <pattern id="aa-dots" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.6" className="aa-dot" />
        </pattern>
      </defs>
      <circle className="aa-blob" cx="96" cy="118" r="78" />
      <rect x="298" y="40" width="98" height="98" fill="url(#aa-dots)" />
      <circle className="aa-ring" cx="354" cy="368" r="44" />
      <path d="M80 418V214a130 130 0 0 1 260 0v204a22 22 0 0 1-22 22H102a22 22 0 0 1-22-22Z" fill="url(#aa-arch)" />
      <path className="aa-line" d="M112 440V220a98 98 0 0 1 196 0v220" />
      <path className="aa-line is-faint" d="M144 440V226a66 66 0 0 1 132 0v214" />
      <circle cx="210" cy="244" r="124" fill="url(#aa-glow)" />
      <ellipse className="aa-floor" cx="210" cy="378" rx="66" ry="9" />
      <g className="aa-float">
        <g transform="translate(136 150) scale(0.62)">
          <path d={MOLAR_PATH} transform="translate(9 11)" className="aa-depth" />
          <path d={MOLAR_PATH} fill="url(#aa-enamel)" />
          <path d={MOLAR_PATH} fill="url(#aa-shade)" />
          <path d="M58 46C72 36 94 40 102 52C92 58 76 62 64 74C56 66 52 54 58 46Z" fill="#fff" />
          <path d="M42 82C40 100 44 120 52 136" className="aa-shine" />
          <circle cx="152" cy="52" r="5" fill="#fff" />
        </g>
      </g>
      <Spark x={300} y={166} r={13} />
      <Spark x={122} y={254} r={8} />
      <Spark x={270} y={104} r={6} soft />
      <g className="aa-bubbles">
        <circle cx="152" cy="168" r="6" />
        <circle cx="290" cy="334" r="8" />
        <circle cx="128" cy="346" r="4" />
      </g>
    </svg>
  );
}
