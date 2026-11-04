/**
 * Dental-arch geometry shared by the dashboard and the clinic websites.
 * Pure math, no React: each app renders the teeth with its own JSX/SVG or canvas.
 */

/** Tooth outline on a 24×24 grid, crown at the top, roots at the bottom (a molar: two cusps, two roots). */
export const TOOTH_PATH =
  'M7.2 3.5c-2.4 0-4 1.9-4 4.5 0 2 .8 3.4 1.5 4.8.6 1.3.9 2.8 1.1 4.6.3 2.4 1 3.6 2.1 3.6 1.3 0 1.6-1.6 2-3.6.3-1.4.8-2.4 2.1-2.4s1.8 1 2.1 2.4c.4 2 .7 3.6 2 3.6 1.1 0 1.8-1.2 2.1-3.6.2-1.8.5-3.3 1.1-4.6.7-1.4 1.5-2.8 1.5-4.8 0-2.6-1.6-4.5-4-4.5-1.6 0-2.6.8-4.8.8s-3.2-.8-4.8-.8Z';

/*
 * The single-rooted teeth in the same drawing and on the same grid as TOOTH_PATH, so the dental chart can draw each
 * tooth as what it is: a flat-edged incisor, a pointed canine, a two-cusped premolar; TOOTH_PATH is the molar.
 */
export const INCISOR_PATH =
  'M7.2 3.1C9.8 2.5 14.2 2.5 16.8 3.1C18.2 3.4 18.7 4.8 18.4 6.8C18.1 9 17.1 10.6 16.2 12.2C15.2 14.2 14.3 17.2 13.5 19.5C13.1 20.8 12.6 21.5 12 21.5C11.4 21.5 10.9 20.8 10.5 19.5C9.7 17.2 8.8 14.2 7.8 12.2C6.9 10.6 5.9 9 5.6 6.8C5.3 4.8 5.8 3.4 7.2 3.1Z';
export const CANINE_PATH =
  'M12 2.4C13.9 3.4 16.6 4.7 17.7 6.6C18.5 8 18.2 10 17.1 11.9C16 13.8 15 16.8 14.1 19.6C13.6 21.1 12.9 22 12 22C11.1 22 10.4 21.1 9.9 19.6C9 16.8 8 13.8 6.9 11.9C5.8 10 5.5 8 6.3 6.6C7.4 4.7 10.1 3.4 12 2.4Z';
export const PREMOLAR_PATH =
  'M9 3.3C6.8 3.3 5.2 5.1 5.2 7.6C5.2 9.6 6.2 11.1 7 12.6C7.8 14.2 8.6 16.6 9.6 18.9C10.3 20.5 11 21.5 12 21.5C13 21.5 13.7 20.5 14.4 18.9C15.4 16.6 16.2 14.2 17 12.6C17.8 11.1 18.8 9.6 18.8 7.6C18.8 5.1 17.2 3.3 15 3.3C13.8 3.3 13.1 4 12 4C10.9 4 10.2 3.3 9 3.3Z';

/**
 * A rounder molar on a 240×260 grid (two cusps, two roots): the glossy tooth of the clinic websites' and the
 * dashboard's illustrations.
 */
export const MOLAR_PATH =
  'M120 46C138 30 162 22 184 32C206 42 214 72 208 102C204 124 194 140 190 162C186 186 184 214 176 234C170 250 154 252 150 236C146 220 144 198 138 184C133 173 126 170 120 170C114 170 107 173 102 184C96 198 94 220 90 236C86 252 70 250 64 234C56 214 54 186 50 162C46 140 36 124 32 102C26 72 34 42 56 32C78 22 102 30 120 46Z';

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
