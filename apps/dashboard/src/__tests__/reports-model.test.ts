import { describe, expect, it } from 'vitest';
import { dailyOnly, percent, presetOf, presetPeriod, reportTabs } from '../reports-model';

const holds = (...perms: string[]) => (p: string) => perms.includes(p);

describe('reports model', () => {
  it('shows each member only the reports the API serves them (B.1)', () => {
    expect(reportTabs(holds('reports:read'))).toEqual(['revenue', 'expenses', 'attendance', 'performance', 'outstanding']);
    expect(reportTabs(holds('reports:read:daily'))).toEqual(['revenue']);
    expect(reportTabs(holds('reports:read:own'))).toEqual(['attendance', 'performance']);
    expect(reportTabs(holds('patients:read'))).toEqual([]);
    expect(dailyOnly(holds('reports:read:daily'))).toBe(true);
    expect(dailyOnly(holds('reports:read', 'reports:read:daily'))).toBe(false);
  });
  it('quick periods end today; last month is the whole month, across a year end', () => {
    expect(presetPeriod('today', '2026-10-19')).toEqual({ from: '2026-10-19', to: '2026-10-19' });
    expect(presetPeriod('thisMonth', '2026-10-19')).toEqual({ from: '2026-10-01', to: '2026-10-19' });
    expect(presetPeriod('lastMonth', '2026-10-19')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetPeriod('lastMonth', '2026-01-05')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetPeriod('thisYear', '2026-10-19')).toEqual({ from: '2026-01-01', to: '2026-10-19' });
    expect(presetOf({ from: '2026-09-01', to: '2026-09-30' }, '2026-10-19')).toBe('lastMonth');
    expect(presetOf({ from: '2026-09-02', to: '2026-09-30' }, '2026-10-19')).toBeNull();
  });
  it('rates read as percentages; none is a dash', () => {
    expect(percent(0.25)).toBe('25%');
    expect(percent(0.1234)).toBe('12.3%');
    expect(percent(0)).toBe('0%');
    expect(percent(null)).toBe('—');
  });
});
