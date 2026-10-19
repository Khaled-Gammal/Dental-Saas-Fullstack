/** Pure helpers of the reports screen (SRS REPORT-001…005). Unit-tested; no React. */
import { monthOf } from './finance-model';

export const REPORT_TABS = ['revenue', 'expenses', 'attendance', 'performance', 'outstanding'] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

/**
 * The tabs a member sees (the API refuses the rest anyway, B.1): reports:read sees all; reception
 * (reports:read:daily) today's revenue; a doctor (reports:read:own) their own attendance and performance.
 */
export function reportTabs(can: (perm: string) => boolean): ReportTab[] {
  if (can('reports:read')) return [...REPORT_TABS];
  return REPORT_TABS.filter((t) => (t === 'revenue' && can('reports:read:daily')) || ((t === 'attendance' || t === 'performance') && can('reports:read:own')));
}

/** Only reception's daily view has a fixed period (today). */
export const dailyOnly = (can: (perm: string) => boolean) => !can('reports:read') && can('reports:read:daily');

export const PRESETS = ['today', 'thisMonth', 'lastMonth', 'thisYear'] as const;
export type Preset = (typeof PRESETS)[number];

/** Quick periods; 'this month' and 'this year' end today, as the figures do. */
export function presetPeriod(p: Preset, today: string): { from: string; to: string } {
  if (p === 'today') return { from: today, to: today };
  if (p === 'thisMonth') return { from: `${today.slice(0, 8)}01`, to: today };
  if (p === 'thisYear') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  const [y, m] = today.split('-').map(Number);
  return monthOf(m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`);
}

/** The preset a period matches, if any (to highlight it). */
export const presetOf = (period: { from: string; to: string }, today: string): Preset | null =>
  PRESETS.find((p) => { const x = presetPeriod(p, today); return x.from === period.from && x.to === period.to; }) ?? null;

/** A rate (0…1) as a percentage with at most one decimal; no rate shows a dash. */
export function percent(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 1000) / 10}%`;
}
