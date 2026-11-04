/**
 * The dental chart drawn as two jaws (2026-11-04, the user's idea: "like the website", whose landing page draws an arch
 * of teeth): where each tooth sits, which outline it has and what it is called. Pure; the chart only draws the result.
 *
 * Drawn as the dentist faces the patient, like a printed chart: the patient's right on the viewer's left (FDI quadrants
 * 1 and 4 on the left), the upper jaw a horseshoe with the front teeth at the top, the lower jaw its mirror image under
 * it. Each tooth takes a share of its arch in proportion to its real width, so incisors are slim and molars broad, and
 * the crowns face outward as on the website. Primary teeth form a smaller arch inside each jaw.
 */
import { PERMANENT, PRIMARY } from './clinical-model';
import { permanentToothLabel, primaryToothLabel, toothSideLabel } from './labels';

export type ToothKind = 'incisor' | 'canine' | 'premolar' | 'molar';
export type JawKey = 'upper' | 'primaryUpper' | 'primaryLower' | 'lower';

const quadrant = (code: number) => Math.floor(code / 10);
const place = (code: number) => code % 10;
export const isPrimaryTooth = (code: number) => quadrant(code) >= 5;

export function toothKind(code: number): ToothKind {
  const p = place(code);
  if (p <= 2) return 'incisor';
  if (p === 3) return 'canine';
  return p <= 5 && !isPrimaryTooth(code) ? 'premolar' : 'molar'; // a primary tooth has no premolars: its 4 and 5 are molars
}

/** «الضرس الأول العلوي الأيسر» for 26. */
export function toothName(code: number): string {
  return `${(isPrimaryTooth(code) ? primaryToothLabel : permanentToothLabel)[place(code)]} ${toothSideLabel[quadrant(code)]}`;
}

/** Average crown widths in mm (mesial to distal), from the midline back. */
const WIDTH_MM: Record<JawKey, readonly number[]> = {
  upper: [8.5, 6.5, 7.5, 7, 6.5, 10, 9, 8.5],
  lower: [5.3, 5.9, 7, 7, 7.2, 11, 10.5, 10],
  primaryUpper: [6.5, 5.1, 7, 7.3, 8.2],
  primaryLower: [4, 4.5, 5, 7.7, 9.9],
};

/** Each outline's width and height on its 24×24 grid (@dental/ui/arch); its centre is near 12,12. */
const GLYPH: Record<ToothKind, { w: number; h: number }> = {
  incisor: { w: 12.9, h: 19 },
  canine: { w: 12.5, h: 19.6 },
  premolar: { w: 13.6, h: 18.2 },
  molar: { w: 17.6, h: 17.6 },
};

/** The drawing: its box, the line between the jaws, viewBox units per mm along an arch, and how much of its share a
 * tooth's outline covers (the rest is the gap to its neighbours). */
const W = 460, CX = W / 2, MID = 172, H = 2 * MID, UNIT = 3.3, FILL = 0.84;

/**
 * A horseshoe in its upper form: the front teeth at y0, opening downward. Wider than deep, so each jaw ends with its
 * molars well above the line between the jaws: two jaws with a gap at the sides, not one ring of teeth.
 */
interface Arch { y0: number; rx: number; ry: number }
const ARCH: Record<'permanent' | 'primary', Arch> = {
  permanent: { y0: 44, rx: 180, ry: 150 },
  primary: { y0: 92, rx: 130, ry: 105 },
};

interface Point { x: number; y: number }

export interface ChartTooth {
  code: number;
  kind: ToothKind;
  jaw: JawKey;
  /** the tooth's centre, on its arch */
  x: number;
  y: number;
  /** the way its crown faces: out of the mouth, 0° = up, clockwise */
  angle: number;
  /** its outline's scale, from the 24×24 grid to the drawing */
  scale: number;
  /** its share of the arch and its drawn height: together, the area that answers the pointer */
  span: number;
  height: number;
  /** where its number is written, just past the crown (inside the arch for primary teeth), and its surfaces past that */
  label: Point;
  note: Point;
}

export interface JawLayout {
  width: number;
  height: number;
  /** top to bottom; each jaw's teeth from the viewer's left to right */
  jaws: { key: JawKey; teeth: ChartTooth[] }[];
  /** the gum under each jaw, in the same order */
  gums: string[];
}

const round = (n: number) => Math.round(n * 100) / 100;
const roundPoint = (p: Point): Point => ({ x: round(p.x), y: round(p.y) });

/** A horseshoe's points, the way out of it at each point, and how far along it to go for a given arc length. */
function horseshoe(a: Arch) {
  const at = (t: number): Point => ({ x: CX + a.rx * Math.sin(t), y: a.y0 + a.ry * (1 - Math.cos(t)) });
  // t = 0 is the midline; the arc length from it, sampled finely, so teeth sit by length whatever the curve does
  const N = 900, T = Math.PI / 2, ts = [0], lens = [0];
  let prev = at(0);
  for (let i = 1; i <= N; i++) {
    const t = (T * i) / N, p = at(t);
    ts.push(t);
    lens.push(lens[i - 1] + Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = p;
  }
  const along = (s: number) => {
    const i = lens.findIndex((l) => l >= s);
    if (i === 0) return 0;
    if (i < 0) return T;
    return ts[i - 1] + ((ts[i] - ts[i - 1]) * (s - lens[i - 1])) / (lens[i] - lens[i - 1]);
  };
  /** the outward normal at t, in degrees: 0° = up, clockwise (negative on the left side) */
  const outward = (t: number) => (Math.atan2(a.ry * Math.sin(t), a.rx * Math.cos(t)) * 180) / Math.PI;
  return { at, along, outward };
}

const isLower = (key: JawKey) => key === 'lower' || key === 'primaryLower';
const isPrimaryJaw = (key: JawKey) => key === 'primaryUpper' || key === 'primaryLower';
const mirror = (key: JawKey, p: Point): Point => (isLower(key) ? { x: p.x, y: 2 * MID - p.y } : p);

/** One jaw: from the midline back on both sides; a lower jaw is the upper form mirrored about the line between them. */
function placeJaw(key: JawKey): ChartTooth[] {
  const arch = horseshoe(ARCH[isPrimaryJaw(key) ? 'primary' : 'permanent']);
  // the quadrants on the viewer's left and right: the patient's right is on the viewer's left
  const [left, right] = ({ upper: [1, 2], lower: [4, 3], primaryUpper: [5, 6], primaryLower: [8, 7] } as const)[key];
  // numbers go just past the crown; for primary teeth inside the arch instead, since the permanent ones surround them
  const way = isPrimaryJaw(key) ? -1 : 1;
  const teeth: ChartTooth[] = [];
  let from = 0;
  WIDTH_MM[key].forEach((mm, k) => {
    const span = mm * UNIT, t = arch.along(from + span / 2);
    from += span;
    for (const side of [-1, 1] as const) {
      const code = (side < 0 ? left : right) * 10 + k + 1;
      const kind = toothKind(code);
      const scale = (FILL * span) / GLYPH[kind].w;
      const height = GLYPH[kind].h * scale;
      const centre = arch.at(side * t), angle = arch.outward(side * t), r = (angle * Math.PI) / 180;
      const past = (d: number): Point => ({ x: centre.x + way * d * Math.sin(r), y: centre.y - way * d * Math.cos(r) });
      const c = mirror(key, centre);
      // a little further for permanent teeth: their numbers are larger, and a chosen one sits in a pill
      const gap = isPrimaryJaw(key) ? 9 : 12;
      teeth.push({
        code, kind, jaw: key, x: round(c.x), y: round(c.y), angle: round(isLower(key) ? 180 - angle : angle), scale: round(scale),
        span: round(span), height: round(height),
        label: roundPoint(mirror(key, past(height / 2 + gap))), note: roundPoint(mirror(key, past(height / 2 + gap + 10))),
      });
    }
  });
  return teeth.sort((a, b) => a.x - b.x);
}

/** The gum under a jaw: its horseshoe drawn a little in towards the tongue and a little past the last tooth on each side. */
function gumOf(key: JawKey): string {
  const primary = isPrimaryJaw(key), arch = horseshoe(ARCH[primary ? 'primary' : 'permanent']);
  const end = arch.along(WIDTH_MM[key].reduce((s, mm) => s + mm, 0) * UNIT + 2);
  const inset = primary ? 5 : 8;
  const points: string[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = -end + (2 * end * i) / 48, p = arch.at(t), r = (arch.outward(t) * Math.PI) / 180;
    const q = mirror(key, { x: p.x - inset * Math.sin(r), y: p.y + inset * Math.cos(r) });
    points.push(`${q.x.toFixed(1)} ${q.y.toFixed(1)}`);
  }
  return `M${points.join(' L')}`;
}

const layouts = new Map<boolean, JawLayout>();

/** The two jaws, with the primary arches inside them when `primary`; computed once per variant. */
export function jawLayout(primary: boolean): JawLayout {
  let layout = layouts.get(primary);
  if (!layout) {
    const keys: JawKey[] = primary ? ['upper', 'primaryUpper', 'primaryLower', 'lower'] : ['upper', 'lower'];
    layout = { width: W, height: H, jaws: keys.map((key) => ({ key, teeth: placeJaw(key) })), gums: keys.map(gumOf) };
    layouts.set(primary, layout);
  }
  return layout;
}

export type ChartKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';
export const CHART_KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

/** The chart's rows, top to bottom, each from the viewer's left to right (the order of jawLayout's jaws). */
export function chartRows(primary: boolean): number[][] {
  return primary
    ? [[...PERMANENT.upper], [...PRIMARY.upper], [...PRIMARY.lower], [...PERMANENT.lower]]
    : [[...PERMANENT.upper], [...PERMANENT.lower]];
}

/**
 * The keyboard over the chart: left and right along a jaw; up and down to the jaw above or below, on the same side at
 * the nearest place (16 ↓ 46, or 16 ↓ 55 with the primary teeth shown); Home and End to a jaw's two ends.
 */
export function moveInChart(code: number, key: ChartKey, primary: boolean): number {
  const rows = chartRows(primary);
  const r = rows.findIndex((row) => row.includes(code));
  if (r < 0) return rows[0][0];
  const row = rows[r], c = row.indexOf(code);
  if (key === 'ArrowLeft') return row[Math.max(0, c - 1)];
  if (key === 'ArrowRight') return row[Math.min(row.length - 1, c + 1)];
  if (key === 'Home') return row[0];
  if (key === 'End') return row[row.length - 1];
  const next = rows[r + (key === 'ArrowDown' ? 1 : -1)];
  if (!next) return code;
  const onLeft = c < row.length / 2;
  const side = next.filter((_, i) => i < next.length / 2 === onLeft);
  return side.reduce((best, n) => (Math.abs(place(n) - place(code)) < Math.abs(place(best) - place(code)) ? n : best));
}
