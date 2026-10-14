/**
 * Dental-arch geometry shared by the dashboard and the clinic websites.
 * Pure math, no React: each app renders the teeth with its own JSX/SVG or canvas.
 */

/** Tooth outline on a 24×24 grid, crown at the top, roots at the bottom. */
export const TOOTH_PATH =
  'M7.2 3.5c-2.4 0-4 1.9-4 4.5 0 2 .8 3.4 1.5 4.8.6 1.3.9 2.8 1.1 4.6.3 2.4 1 3.6 2.1 3.6 1.3 0 1.6-1.6 2-3.6.3-1.4.8-2.4 2.1-2.4s1.8 1 2.1 2.4c.4 2 .7 3.6 2 3.6 1.1 0 1.8-1.2 2.1-3.6.2-1.8.5-3.3 1.1-4.6.7-1.4 1.5-2.8 1.5-4.8 0-2.6-1.6-4.5-4-4.5-1.6 0-2.6.8-4.8.8s-3.2-.8-4.8-.8Z';

/** Four-point sparkle centred on 0,0 with radius 1 — scale it with a transform. */
export const SPARKLE_PATH = 'M0 -1 C0.12 -0.12 0.12 -0.12 1 0 C0.12 0.12 0.12 0.12 0 1 C-0.12 0.12 -0.12 0.12 -1 0 C-0.12 -0.12 -0.12 -0.12 0 -1Z';

export interface ArchTooth {
  /** SVG transform that places the 24×24 tooth glyph on the arch, crown facing outward */
  transform: string;
  x: number;
  y: number;
  /** rotation in degrees */
  angle: number;
  scale: number;
  /** 0 = front incisor … 1 = back molar */
  depth: number;
}

/**
 * Teeth spaced evenly (by arc length) along a horseshoe-shaped arch in a 320×220 box:
 * incisors at the top centre, molars at the bottom left and right.
 * Order runs from the left molar to the right molar.
 */
export function dentalArch(count = 14, w = 320, h = 220): ArchTooth[] {
  const cx = w / 2, top = 28, rx = w * 0.37, ry = h * 0.78, tMax = 1.32;
  const at = (t: number) => ({ x: cx + rx * Math.sin(t), y: top + ry * (1 - Math.cos(t)) });

  // arc-length table so teeth sit at even spacing regardless of curvature
  const N = 400, lens: number[] = [0];
  let prev = at(-tMax);
  for (let i = 1; i <= N; i++) {
    const p = at(-tMax + (2 * tMax * i) / N);
    lens.push(lens[i - 1] + Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = p;
  }
  const total = lens[N];

  const teeth: ArchTooth[] = [];
  for (let k = 0; k < count; k++) {
    const target = ((k + 0.5) / count) * total;
    let i = lens.findIndex((l) => l >= target);
    if (i < 1) i = 1;
    const t = -tMax + (2 * tMax * (i - 1 + (target - lens[i - 1]) / (lens[i] - lens[i - 1]))) / N;
    const { x, y } = at(t);
    const angle = (Math.atan2(ry * Math.sin(t), rx * Math.cos(t)) * 180) / Math.PI; // outward normal, 0° = up
    const depth = Math.abs(t) / tMax;
    const scale = 0.95 + depth * 0.55; // molars are bigger than incisors
    const r = (n: number) => Math.round(n * 100) / 100;
    teeth.push({
      x: r(x), y: r(y), angle: r(angle), scale: r(scale), depth: r(depth),
      transform: `translate(${r(x)} ${r(y)}) rotate(${r(angle)}) scale(${r(scale)}) translate(-12 -12)`,
    });
  }
  return teeth;
}

/** The gum line under the teeth: the same horseshoe, pulled inward by `inset` units. */
export function archGumPath(inset = 16, w = 320, h = 220): string {
  const cx = w / 2, top = 28 + inset, rx = w * 0.37 - inset, ry = h * 0.78 - inset, tMax = 1.36;
  const pts: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = -tMax + (2 * tMax * i) / 40;
    pts.push(`${(cx + rx * Math.sin(t)).toFixed(1)} ${(top + ry * (1 - Math.cos(t))).toFixed(1)}`);
  }
  return `M${pts.join(' L')}`;
}
