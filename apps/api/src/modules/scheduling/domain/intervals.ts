/** Half-open time intervals in epoch milliseconds. Pure functions, no dates or zones here. */
export interface Interval { start: number; end: number }

export const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end;

/** Sorted, merged, empty intervals dropped. */
export function normalize(xs: readonly Interval[]): Interval[] {
  const sorted = xs.filter((x) => x.end > x.start).slice().sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push({ start: x.start, end: x.end });
  }
  return out;
}

/** The time covered by both lists (a doctor's shift ∩ the branch's opening hours). */
export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return normalize(out);
}

/** `base` with every `cut` removed (working time minus bookings). */
export function subtract(base: readonly Interval[], cut: readonly Interval[]): Interval[] {
  let result = normalize(base);
  for (const c of normalize(cut)) {
    const next: Interval[] = [];
    for (const r of result) {
      if (!overlaps(r, c)) { next.push(r); continue; }
      if (c.start > r.start) next.push({ start: r.start, end: c.start });
      if (c.end < r.end) next.push({ start: c.end, end: r.end });
    }
    result = next;
  }
  return result;
}
