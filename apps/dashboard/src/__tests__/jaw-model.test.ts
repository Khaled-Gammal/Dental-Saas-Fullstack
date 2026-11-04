import { describe, expect, it } from 'vitest';
import { PERMANENT, PRIMARY } from '../clinical-model';
import { chartRows, jawLayout, moveInChart, toothKind, toothName, type ChartTooth } from '../jaw-model';

const byCode = (primary: boolean) => {
  const m = new Map<number, ChartTooth>(jawLayout(primary).jaws.flatMap((j) => j.teeth).map((t) => [t.code, t]));
  return (code: number) => m.get(code)!;
};

describe('the dental chart as two jaws', () => {
  it('draws every tooth once, with and without the primary arches', () => {
    const codes = (primary: boolean) => jawLayout(primary).jaws.flatMap((j) => j.teeth.map((t) => t.code)).sort();
    expect(codes(false)).toEqual([...PERMANENT.upper, ...PERMANENT.lower].sort());
    expect(codes(true)).toEqual([...PERMANENT.upper, ...PRIMARY.upper, ...PRIMARY.lower, ...PERMANENT.lower].sort());
  });

  it('orders each jaw from the viewer\'s left to right, as the rows the arrow keys walk', () => {
    for (const primary of [false, true]) expect(jawLayout(primary).jaws.map((j) => j.teeth.map((t) => t.code))).toEqual(chartRows(primary));
  });

  it('faces the patient: their right on the viewer\'s left, front teeth at the top and the bottom', () => {
    const t = byCode(false), mid = jawLayout(false).width / 2;
    expect(t(18).x).toBeLessThan(t(11).x);
    expect(t(11).x).toBeLessThan(mid);
    expect(t(21).x).toBeGreaterThan(mid);
    expect(t(48).x).toBeLessThan(mid);
    expect(t(11).y).toBeLessThan(t(16).y); // the upper incisors above the upper molars
    expect(t(41).y).toBeGreaterThan(t(46).y); // the lower incisors below the lower molars
    expect(t(16).y).toBeLessThan(t(46).y);
    // crowns face out of the mouth: up for the upper front teeth, down for the lower ones (a central incisor sits half its
    // width off the midline, so it leans a few degrees)
    expect(Math.abs(t(11).angle)).toBeLessThan(10);
    expect(Math.abs(t(41).angle - 180)).toBeLessThan(10);
  });

  it('mirrors left and right', () => {
    const t = byCode(true), w = jawLayout(true).width;
    const turn = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180; // the same turn in (-180, 180]: 182° is -178°
    for (const [a, b] of [[11, 21], [16, 26], [41, 31], [48, 38], [55, 65], [81, 71]]) {
      expect(t(a).x + t(b).x).toBeCloseTo(w, 1);
      expect(t(a).y).toBeCloseTo(t(b).y, 1);
      expect(turn(t(a).angle)).toBeCloseTo(-turn(t(b).angle), 1);
    }
  });

  it('keeps a gap between the jaws and every number inside the drawing', () => {
    const l = jawLayout(true);
    for (const t of l.jaws.flatMap((j) => j.teeth)) {
      for (const p of [t.label, t.note]) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(l.width);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(l.height);
      }
    }
    const upper = l.jaws[0].teeth, lower = l.jaws[l.jaws.length - 1].teeth;
    const lowestUpper = Math.max(...upper.map((t) => t.y + t.height / 2));
    const highestLower = Math.min(...lower.map((t) => t.y - t.height / 2));
    expect(highestLower - lowestUpper).toBeGreaterThan(40);
  });

  it('leaves room between neighbours along a jaw', () => {
    for (const jaw of jawLayout(true).jaws) {
      jaw.teeth.slice(1).forEach((t, i) => {
        const prev = jaw.teeth[i];
        expect(Math.hypot(t.x - prev.x, t.y - prev.y)).toBeGreaterThan(0.84 * ((t.span + prev.span) / 2));
      });
    }
  });

  it('makes molars broader than incisors', () => {
    const t = byCode(false);
    expect(t(16).span).toBeGreaterThan(t(11).span);
    expect(t(46).span).toBeGreaterThan(2 * t(41).span);
  });
});

describe('tooth names and kinds', () => {
  it('names a tooth by its place and side, the patient\'s own right and left', () => {
    expect(toothName(26)).toBe('الضرس الأول العلوي الأيسر');
    expect(toothName(11)).toBe('القاطع الأوسط العلوي الأيمن');
    expect(toothName(43)).toBe('الناب السفلي الأيمن');
    expect(toothName(38)).toBe('ضرس العقل السفلي الأيسر');
    expect(toothName(55)).toBe('الضرس اللبني الثاني العلوي الأيمن');
    expect(toothName(71)).toBe('القاطع الأوسط اللبني السفلي الأيسر');
  });

  it('tells front teeth from back ones; a primary jaw has no premolars', () => {
    expect([11, 12, 13, 14, 15, 16, 17, 18].map(toothKind)).toEqual(['incisor', 'incisor', 'canine', 'premolar', 'premolar', 'molar', 'molar', 'molar']);
    expect([81, 82, 83, 84, 85].map(toothKind)).toEqual(['incisor', 'incisor', 'canine', 'molar', 'molar']);
  });
});

describe('the keys over the chart', () => {
  it('walk along a jaw, across the midline, and stop at its ends', () => {
    expect(moveInChart(11, 'ArrowRight', false)).toBe(21);
    expect(moveInChart(21, 'ArrowLeft', false)).toBe(11);
    expect(moveInChart(18, 'ArrowLeft', false)).toBe(18);
    expect(moveInChart(14, 'Home', false)).toBe(18);
    expect(moveInChart(14, 'End', false)).toBe(28);
  });

  it('go up and down to the same place on the same side', () => {
    expect(moveInChart(16, 'ArrowDown', false)).toBe(46);
    expect(moveInChart(36, 'ArrowUp', false)).toBe(26);
    expect(moveInChart(16, 'ArrowUp', false)).toBe(16);
    expect(moveInChart(16, 'ArrowDown', true)).toBe(55);
    expect(moveInChart(11, 'ArrowDown', true)).toBe(51);
    expect(moveInChart(61, 'ArrowDown', true)).toBe(71);
    expect(moveInChart(46, 'ArrowUp', true)).toBe(85);
  });
});
