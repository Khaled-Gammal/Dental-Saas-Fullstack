import { describe, expect, it } from 'vitest';
import { addMonths, currentByTooth, nextBookingQuery, PERMANENT, planMoves, PRIMARY, showsPrimary, toMinor, toothTone } from '../clinical-model';
import type { ChartEntry, PlanDetail } from '../types';

const entry = (id: string, tooth: number, condition: ChartEntry['condition'], at: string): ChartEntry =>
  ({ id, tooth_code: tooth, condition, surfaces: [], notes: null, visit_id: null, recorded_at: at, recorded_by_name: null });

describe('chart layout (CHART-001)', () => {
  it('reads like a printed chart: the patient\'s right first, never mirrored', () => {
    expect(PERMANENT.upper.slice(0, 2)).toEqual([18, 17]);
    expect(PERMANENT.upper.slice(7, 9)).toEqual([11, 21]);
    expect(PERMANENT.lower.slice(7, 9)).toEqual([41, 31]);
    expect(PRIMARY.upper).toHaveLength(10);
    expect(new Set([...PERMANENT.upper, ...PERMANENT.lower]).size).toBe(32);
  });
  it('the current condition is the newest entry per tooth', () => {
    const now = currentByTooth([entry('3', 36, 'filled', '2031-02-01'), entry('1', 36, 'caries', '2031-01-01'), entry('2', 11, 'crown', '2031-01-15')]);
    expect(now.get(36)?.condition).toBe('filled');
    expect(now.get(11)?.condition).toBe('crown');
  });
  it('colours what needs treatment apart from what was treated', () => {
    expect(toothTone('caries')).toBe('problem');
    expect(toothTone('extraction_needed')).toBe('problem');
    expect(toothTone('root_canal')).toBe('treated');
    expect(toothTone('missing')).toBe('missing');
    expect(toothTone(undefined)).toBeNull();
  });
  it('shows primary teeth for children or when they were charted', () => {
    expect(showsPrimary([], 8)).toBe(true);
    expect(showsPrimary([], 30)).toBe(false);
    expect(showsPrimary([entry('1', 55, 'caries', '2031-01-01')], 30)).toBe(true);
  });
});

describe('toMinor', () => {
  it('reads pounds typed with Latin or Arabic digits', () => {
    expect(toMinor('800')).toBe(80000);
    expect(toMinor('1,250.5')).toBe(125050);
    expect(toMinor('٨٠٠')).toBe(80000);
    expect(toMinor('abc')).toBeNull();
    expect(toMinor('1.234')).toBeNull();
  });
});

describe('plans', () => {
  it('offers only the moves a person makes (TPLAN-002)', () => {
    expect(planMoves('draft')).toEqual(['proposed', 'cancelled']);
    expect(planMoves('proposed')).toEqual(['accepted', 'cancelled']);
    expect(planMoves('in_progress')).toEqual(['cancelled']);
    expect(planMoves('completed')).toEqual([]);
  });
  it('pre-fills the next booking from the visit and the next item of an accepted plan (APPT-007)', () => {
    const visit = { patient_id: 'p', doctor_id: 'd', branch_id: 'b' };
    expect(nextBookingQuery(visit)).toEqual({ patient: 'p', doctor: 'd', branch: 'b' });
    const plan = { id: 'pl', status: 'in_progress', next: { item: { id: 'i', service_id: 's' } } } as unknown as PlanDetail;
    expect(nextBookingQuery(visit, plan)).toEqual({ patient: 'p', doctor: 'd', branch: 'b', service: 's', plan: 'pl', item: 'i' });
    expect(nextBookingQuery(visit, { ...plan, status: 'proposed' })).toEqual({ patient: 'p', doctor: 'd', branch: 'b' });
  });
});

describe('addMonths', () => {
  it('keeps the day, or the last day of a shorter month', () => {
    expect(addMonths('2031-01-15', 6)).toBe('2031-07-15');
    expect(addMonths('2031-08-31', 1)).toBe('2031-09-30');
    expect(addMonths('2031-11-30', 3)).toBe('2032-02-29');
  });
});
