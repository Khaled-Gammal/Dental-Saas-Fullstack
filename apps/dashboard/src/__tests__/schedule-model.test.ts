import { describe, expect, it } from 'vitest';
import { canAddSlot, dayError, fromRows, nextSlot, scheduledDays, toPayload, type ScheduleDay } from '../schedule-model';

const A = 'branch-a';
const B = 'branch-b';
const day = (slots: [string, string, string][]): ScheduleDay => ({ weekday: 6, slots: slots.map(([branchId, starts, ends], i) => ({ id: `s${i}`, branchId, starts, ends })) });

describe('schedule model', () => {
  it('groups rows by weekday and flattens back for the API', () => {
    const days = fromRows([{ branch_id: A, weekday: 6, starts_at: '10:00', ends_at: '14:00' }, { branch_id: B, weekday: 6, starts_at: '16:00', ends_at: '20:00' }]);
    expect(days[0]).toMatchObject({ weekday: 6, slots: [{ branchId: A }, { branchId: B }] });
    expect(toPayload(days).slots).toEqual([
      { branchId: A, weekday: 6, starts: '10:00', ends: '14:00' },
      { branchId: B, weekday: 6, starts: '16:00', ends: '20:00' },
    ]);
  });

  it('a doctor cannot be in two branches at once; back-to-back is fine; unknown branch is an error', () => {
    expect(dayError(day([[A, '10:00', '14:00'], [B, '14:00', '18:00']]), [A, B])).toBeNull();
    expect(dayError(day([[A, '10:00', '14:00'], [B, '13:00', '18:00']]), [A, B])).toBe('overlap');
    expect(dayError(day([[A, '14:00', '10:00']]), [A])).toBe('order');
    expect(dayError(day([[B, '10:00', '12:00']]), [A])).toBe('branch');
  });

  it('next slot follows the last one at the same branch', () => {
    expect(nextSlot(day([[B, '10:00', '14:00']]), A)).toMatchObject({ branchId: B, starts: '15:00', ends: '19:00' });
    expect(nextSlot(day([]), A)).toMatchObject({ branchId: A, starts: '10:00' });
    expect(canAddSlot(day([[A, '10:00', '22:00']]))).toBe(false);
    expect(scheduledDays([{ branch_id: A, weekday: 1, starts_at: '10:00', ends_at: '12:00' }, { branch_id: B, weekday: 1, starts_at: '13:00', ends_at: '15:00' }])).toBe(1);
  });
});
