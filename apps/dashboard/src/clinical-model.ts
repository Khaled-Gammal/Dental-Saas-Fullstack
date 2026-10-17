/** Pure helpers of the clinical screens (SRS VISIT-*, CHART-001, TPLAN-*). Unit-tested; no React. */
import { toAsciiDigits } from '@dental/ui/text';
import type { ChartEntry, PlanDetail, PlanStatus, ToothCondition, Visit } from './types';

/**
 * The FDI chart as a dentist reads it, facing the patient: the patient's right is on the viewer's left. Rows are
 * listed left to right on screen and are never mirrored for RTL (CHART-001).
 */
export const PERMANENT = {
  upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
} as const;
export const PRIMARY = {
  upper: [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
  lower: [85, 84, 83, 82, 81, 71, 72, 73, 74, 75],
} as const;

export const CONDITIONS: ToothCondition[] = ['healthy', 'caries', 'filled', 'crown', 'bridge', 'missing', 'implant', 'root_canal', 'fractured',
  'extraction_needed', 'veneer', 'sealant', 'other'];
export const SURFACES = ['M', 'O', 'D', 'B', 'L', 'I', 'F', 'P'] as const;

/** How a condition is drawn: something to treat, treated, missing, or fine. */
export type ToothTone = 'problem' | 'treated' | 'missing' | 'healthy' | 'other';
export function toothTone(c: ToothCondition | undefined): ToothTone | null {
  if (!c) return null;
  if (c === 'caries' || c === 'fractured' || c === 'extraction_needed') return 'problem';
  if (c === 'missing') return 'missing';
  if (c === 'healthy') return 'healthy';
  if (c === 'other') return 'other';
  return 'treated';
}

/** The current state per tooth: the newest entry (entries arrive newest first). */
export function currentByTooth(entries: readonly ChartEntry[]): Map<number, ChartEntry> {
  const m = new Map<number, ChartEntry>();
  for (const e of entries) if (!m.has(e.tooth_code)) m.set(e.tooth_code, e);
  return m;
}

/** A tooth's history, newest first. */
export const toothHistory = (entries: readonly ChartEntry[], tooth: number) => entries.filter((e) => e.tooth_code === tooth);

/** Whether the chart shows primary teeth: the patient is under 13, or primary teeth were already charted. */
export function showsPrimary(entries: readonly ChartEntry[], age: number | null): boolean {
  return (age !== null && age < 13) || entries.some((e) => e.tooth_code >= 51);
}

/** "800" or "800.50" (pounds, Arabic or Latin digits) -> piastres; null when it is not a price. */
export function toMinor(pounds: string): number | null {
  const s = toAsciiDigits(pounds).replace(/[,\s٬]/g, '').replace('٫', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
/** Piastres as pounds for an input box ("800", "800.5"). */
export const toPounds = (minor: number) => String(minor / 100);

/** The status moves a person makes on a plan (the rest follow the procedures). */
export function planMoves(status: PlanStatus): ('proposed' | 'accepted' | 'cancelled')[] {
  if (status === 'draft') return ['proposed', 'cancelled'];
  if (status === 'proposed') return ['accepted', 'cancelled'];
  if (status === 'accepted' || status === 'in_progress') return ['cancelled'];
  return [];
}
export const planEditable = (status: PlanStatus) => status === 'draft' || status === 'proposed';
export const planOpen = (status: PlanStatus) => status !== 'completed' && status !== 'cancelled';

/**
 * APPT-007: the next appointment, pre-filled from the visit (patient, doctor, branch) and, when there is one, the
 * next planned item of an open plan (its service; booking links the item).
 */
export function nextBookingQuery(visit: Pick<Visit, 'patient_id' | 'doctor_id' | 'branch_id'>, plan?: Pick<PlanDetail, 'id' | 'status' | 'next'> | null): Record<string, string> {
  const q: Record<string, string> = { patient: visit.patient_id, doctor: visit.doctor_id, branch: visit.branch_id };
  const item = plan && planOpen(plan.status) && plan.status !== 'draft' && plan.status !== 'proposed' ? plan.next.item : null;
  if (plan && item) { q.service = item.service_id; q.plan = plan.id; q.item = item.id; }
  return q;
}

/** Due-date presets of a follow-up, in months from today. */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
