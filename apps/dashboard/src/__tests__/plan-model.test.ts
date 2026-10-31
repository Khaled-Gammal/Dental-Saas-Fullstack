import { describe, expect, it } from 'vitest';
import { renewalNotice, trialDaysLeft, usageRows } from '../plan-model';

describe('the plan card (Phase 1D)', () => {
  it('each resource with its use; warns from 80%, full at the limit; unlimited never warns', () => {
    const rows = usageRows({
      usage: { branches: 1, doctors: 4, staff: 2, patients: 1990, storageMb: 10 },
      limits: { branches: 1, doctors: 5, staff: 5, patients: 2000, storageMb: null },
    });
    expect(rows.map((r) => [r.key, r.percent, r.level])).toEqual([
      ['branches', 100, 'full'], ['doctors', 80, 'near'], ['staff', 40, 'ok'], ['patients', 99, 'near'], ['storageMb', 0, 'ok'], // 99.5% is not drawn full
    ]);
  });
  it('over the limit (after a downgrade) is full and the bar stops at 100%', () => {
    const [r] = usageRows({ usage: { branches: 3, doctors: 0, staff: 0, patients: 0, storageMb: 0 }, limits: { branches: 1, doctors: null, staff: null, patients: null, storageMb: null } });
    expect([r.percent, r.level]).toEqual([100, 'full']);
  });
  it('storage compares bytes: rounded-up megabytes are not "full" while an upload still fits', () => {
    const [, , , , r] = usageRows({ usage: { branches: 0, doctors: 0, staff: 0, patients: 0, storageMb: 2048 }, limits: { branches: null, doctors: null, staff: null, patients: null, storageMb: 2048 },
      storageBytes: 2048 * 1024 * 1024 - 10 });
    expect([r.percent, r.level]).toEqual([99, 'near']);
  });
  it('trial days left: part of a day counts, never below zero', () => {
    const now = Date.parse('2026-10-31T10:00:00Z');
    expect(trialDaysLeft('2026-11-02T09:00:00Z', now)).toBe(2);
    expect(trialDaysLeft('2026-10-31T09:00:00Z', now)).toBe(0);
    expect(trialDaysLeft(null, now)).toBeNull();
  });
});

describe('the renewal notice (Phase 2B)', () => {
  const now = Date.parse('2026-11-10T08:00:00Z');
  it('reminds in the last week of a paid period, not before', () => {
    expect(renewalNotice({ status: 'active', currentPeriodEnd: '2026-11-13T07:00:00Z', graceEndsAt: null }, now)).toEqual({ kind: 'soon', days: 3, endsAt: '2026-11-13T07:00:00Z' });
    expect(renewalNotice({ status: 'active', currentPeriodEnd: '2026-11-30T08:00:00Z', graceEndsAt: null }, now)).toBeNull();
  });
  it('past due: when the clinic stops', () => {
    expect(renewalNotice({ status: 'past_due', currentPeriodEnd: '2026-11-08T08:00:00Z', graceEndsAt: '2026-11-15T08:00:00Z' }, now))
      .toEqual({ kind: 'past_due', stopsAt: '2026-11-15T08:00:00Z', days: 5 });
  });
  it('a trial or no dates: nothing', () => {
    expect(renewalNotice({ status: 'trialing', currentPeriodEnd: null, graceEndsAt: null }, now)).toBeNull();
    expect(renewalNotice({ status: 'past_due', currentPeriodEnd: null, graceEndsAt: null }, now)).toBeNull();
  });
});
