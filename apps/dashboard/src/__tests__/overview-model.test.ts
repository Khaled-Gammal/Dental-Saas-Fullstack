import { describe, expect, it } from 'vitest';
import { attentionItems, change, remainingToday } from '../overview-model';
import type { Appointment, HomeData } from '../types';

const appt = (id: string, status: Appointment['status'], starts_at: string) => ({ id, status, starts_at }) as Appointment;

const home = (over: Partial<HomeData>): HomeData => ({
  today: '2026-10-21', month: { from: '2026-10-01', to: '2026-10-31' }, currency: 'EGP', linked_doctor: null,
  appointments: null, follow_ups: null, today_money: null, finance: null, cash: null, ...over,
});

describe('the overview (2026-10-21)', () => {
  it('lists what is still ahead today, by time, as the appointments page reads it', () => {
    const day = [
      appt('done', 'completed', '2026-10-21T07:00:00Z'), appt('late', 'confirmed', '2026-10-21T12:00:00Z'),
      appt('now', 'in_progress', '2026-10-21T08:00:00Z'), appt('gone', 'cancelled', '2026-10-21T09:00:00Z'),
      appt('web', 'pending', '2026-10-21T10:00:00Z'), appt('miss', 'no_show', '2026-10-21T06:00:00Z'), appt('in', 'checked_in', '2026-10-21T09:30:00Z'),
    ];
    const r = remainingToday(day);
    expect(r.rows.map((a) => a.id)).toEqual(['now', 'in', 'web', 'late']);
    expect(r.total).toBe(4);
    expect(remainingToday(day, 2)).toEqual({ rows: [r.rows[0], r.rows[1]], total: 4 });
  });

  it('lists only what is waiting, from the blocks the member has, in a clinic\'s order', () => {
    const h = home({
      appointments: { scope: 'all', waiting: 2, in_progress: 1, booked: 9, completed: 3, attended: 5, upcoming: 3, cancelled: 0, no_show: 1, cancellation_rate: 0, no_show_rate: 0.1 },
      follow_ups: { scope: 'all', due: 0 },
      cash: [{ branch_id: 'a', name_ar: 'مدينة نصر', name_en: null, status: 'open' }, { branch_id: 'b', name_ar: 'المعادي', name_en: null, status: 'none' }],
    });
    expect(attentionItems(h, { unconfirmed: 1, discounts: 0 })).toEqual([
      { key: 'waiting', n: 2 }, { key: 'unconfirmed', n: 1 }, { key: 'cash', n: 1, branch: { name_ar: 'المعادي', name_en: null } },
    ]);
  });

  it('adds nothing for blocks the API did not send', () => {
    expect(attentionItems(home({}), {})).toEqual([]);
  });
});

describe('«vs last period» (statistics, 2026-10-21)', () => {
  it('is the move against the period before, and nothing when that was zero', () => {
    expect(change(150, 100)).toBe(0.5);
    expect(change(50, 100)).toBe(-0.5);
    expect(change(100, 100)).toBe(0);
    expect(change(-50, -100)).toBe(0.5); // a loss that shrank is an improvement
    expect(change(100, 0)).toBeNull();
  });
});
