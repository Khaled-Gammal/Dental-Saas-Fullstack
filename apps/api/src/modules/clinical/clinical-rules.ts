import { Err } from '../../shared/errors/app-error';

/** FDI tooth codes: permanent 11–48, primary 51–85 (same rule as the database CHECK). */
export function isToothCode(n: number): boolean {
  const q = Math.floor(n / 10), t = n % 10;
  return (q >= 1 && q <= 4 && t >= 1 && t <= 8) || (q >= 5 && q <= 8 && t >= 1 && t <= 5);
}
export const SURFACES = ['M', 'O', 'D', 'B', 'L', 'I', 'F', 'P'] as const;
export const CONDITIONS = ['healthy', 'caries', 'filled', 'crown', 'bridge', 'missing', 'implant', 'root_canal', 'fractured',
  'extraction_needed', 'veneer', 'sealant', 'other'] as const;
export const RECALL_REASONS = ['checkup', 'cleaning', 'ortho_adjustment', 'post_op', 'implant_followup', 'other'] as const;
export const NOTE_FIELDS = ['chief_complaint', 'diagnosis', 'clinical_notes', 'next_visit_note'] as const;
export type NoteField = (typeof NOTE_FIELDS)[number];

/** Surfaces in a stable order without repeats, so "DO" and "OD" are the same entry. */
export const cleanSurfaces = (s: readonly string[] | undefined): string[] => SURFACES.filter((x) => s?.includes(x));

/**
 * SRS CLR-16: a procedure (or a plan estimate) costs the service price, or a price within the service's range. A
 * service "priced on consultation" (0) takes the price the doctor sets. Anything lower is a discount, given later on
 * the invoice (DISC-*), never here.
 */
export function priceFor(service: { price_minor: number; price_max_minor: number | null }, requested?: number): number {
  const min = service.price_minor, max = service.price_max_minor ?? service.price_minor;
  if (min === 0) {
    if (requested === undefined) throw Err.badRequest('price_required', 'This service is priced on consultation; enter the price');
    return requested;
  }
  const price = requested ?? min;
  if (price < min || price > max) throw Err.badRequest('price_out_of_range', 'The price must be within the service price range; a lower price is a discount on the invoice', { min, max });
  return price;
}

export interface ChartEntry { id: string; tooth_code: number; condition: string; surfaces: string[]; recorded_at: Date | string }
/** The current chart: the latest entry per tooth (CHART-001). Entries arrive newest first. */
export function currentChart<T extends ChartEntry>(entries: readonly T[]): T[] {
  const seen = new Map<number, T>();
  for (const e of entries) if (!seen.has(e.tooth_code)) seen.set(e.tooth_code, e);
  return [...seen.values()].sort((a, b) => a.tooth_code - b.tooth_code);
}

export interface PlanItemLike { status: 'planned' | 'scheduled' | 'done' | 'cancelled'; price_minor: number; discount_minor: number }
/** TPLAN-003/004: what is done, what remains, and the estimate of each (cancelled items count for nothing). */
export function planSummary(items: readonly PlanItemLike[]) {
  const net = (i: PlanItemLike) => i.price_minor - i.discount_minor;
  const live = items.filter((i) => i.status !== 'cancelled');
  const done = live.filter((i) => i.status === 'done');
  return {
    items_total: live.length,
    items_done: done.length,
    items_cancelled: items.length - live.length,
    estimate_minor: live.reduce((s, i) => s + net(i), 0),
    done_estimate_minor: done.reduce((s, i) => s + net(i), 0),
    remaining_estimate_minor: live.filter((i) => i.status !== 'done').reduce((s, i) => s + net(i), 0),
  };
}

/** One call-log line kept in the follow-up's notes (VISIT-005): when, who, what was said. */
export function appendCallNote(notes: string | null, at: string, who: string, note: string): string {
  const line = `${at} — ${who}: ${note.trim()}`;
  const next = notes ? `${notes}\n${line}` : line;
  return next.length > 4000 ? next.slice(next.length - 4000) : next; // the oldest lines go first when it is full
}
