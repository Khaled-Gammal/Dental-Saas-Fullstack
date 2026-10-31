import { describe, expect, it } from 'vitest';
import { activityText, byDay, changeLines, ENTITY_FILTER, isView, periodRange } from '../activity-model';
import type { ActivityItem } from '../types';

describe('the activity log (Phase 2D)', () => {
  it('says what was done, in Arabic, for every kind of row', () => {
    expect(activityText('invoice.update', 'invoice')).toBe('عدّل فاتورة');
    expect(activityText('patient.view', 'patient')).toBe('فتح ملف مريض');
    expect(activityText('appointment.create', 'appointment')).toBe('أضاف موعد');
    expect(activityText('tenant.signup', 'tenant')).toBe('أنشأ حساب العيادة');
    expect(activityText('patient.medical_history.update', 'patient')).toBe('عدّل التاريخ الطبي في ملف مريض');
    expect(activityText('expense.voided', 'expense')).toBe('ألغى مصروف');
    expect(activityText('expense.approved', 'expense')).toBe('وافق على مصروف');
    expect(activityText('invoice.discount_rejected', 'invoice')).toBe('رفض الخصم في فاتورة');
    expect(activityText('something.odd', 'unknown_table')).toBe('غيّر سجل'); // never English
    expect(isView('patient_file.view')).toBe(true);
    expect(ENTITY_FILTER.every((f) => f.label)).toBe(true);
    expect(new Set(ENTITY_FILTER.map((f) => f.value)).size).toBe(ENTITY_FILTER.length);
  });
  it('lists what changed: names and codes in Arabic, ids and private text as "changed", money and times typed', () => {
    const { lines, others } = changeLines({
      status: ['draft', 'issued'], total_minor: [10000, 12500], doctor_id: ['a', 'b'], notes: true, starts_at: [null, '2026-11-01T10:00:00+02:00'],
      is_active: [true, false], weird_column: [1, 2], method: ['cash', 'card'],
    }, 'invoice');
    expect(others).toBe(1);
    const by = Object.fromEntries(lines.map((l) => [l.field, l]));
    expect(by['الحالة'].from).toMatchObject({ kind: 'text' });
    expect(by['الحالة'].from).not.toEqual({ kind: 'text', text: 'draft' }); // the invoice status in Arabic
    expect(by['طريقة الدفع'].to).not.toEqual({ kind: 'text', text: 'card' });
    expect(by['الإجمالي'].to).toEqual({ kind: 'money', minor: 12500 });
    expect(by['الطبيب'].to).toEqual({ kind: 'changed' });
    expect(by['الملاحظات']).toMatchObject({ secret: true, from: null });
    expect(by['الموعد']).toMatchObject({ from: { kind: 'empty' }, to: { kind: 'time' } });
    expect(by['مفعّل'].to).toEqual({ kind: 'text', text: 'لا' });
    expect(changeLines(null)).toEqual({ lines: [], others: 0 });
  });
  it('one value (not a before and after) is shown alone; a "no note" flag is left out; a non-text flag is neutral', () => {
    const a = changeLines({ total_minor: 12500 }, 'invoice').lines[0];
    expect(a).toMatchObject({ from: null, to: { kind: 'money', minor: 12500 }, secret: false });
    expect(changeLines({ note: false }, 'cash_session').lines).toEqual([]);
    expect(changeLines({ reason: true }, 'expense').lines[0]).toMatchObject({ secret: true });
    expect(changeLines({ status: ['open', 'closed'] }, 'unknown').lines[0].to).toEqual({ kind: 'text', text: 'closed' }); // unknown codes stay as they are
  });
  it('a new record: no empty columns, no "changed" for private text it may not even have', () => {
    const { lines, others } = changeLines({ status: [null, 'confirmed'], room_id: [null, null], patient_notes: true, internal_notes: true, odd: [null, null] }, 'appointment', 'appointment.create');
    expect(lines.map((l) => l.field)).toEqual(['الحالة']);
    expect(others).toBe(0);
    expect(changeLines({ patient_notes: true }, 'appointment', 'appointment.update').lines).toHaveLength(1); // a change: it did change
  });
  it('periods are clinic days, both ends included', () => {
    expect(periodRange('today', '2026-11-10')).toEqual({ from: '2026-11-10', to: '2026-11-10' });
    expect(periodRange('week', '2026-11-10')).toEqual({ from: '2026-11-04', to: '2026-11-10' });
    expect(periodRange('month', '2026-03-01')).toEqual({ from: '2026-01-31', to: '2026-03-01' });
  });
  it('groups rows by day, keeping their order', () => {
    const it = (id: number, at: string) => ({ id, at } as ActivityItem);
    const g = byDay([it(3, '2026-11-10T20:00Z'), it(2, '2026-11-10T08:00Z'), it(1, '2026-11-09T12:00Z')], (iso) => iso.slice(0, 10));
    expect(g.map((d) => [d.day, d.items.map((x) => x.id)])).toEqual([['2026-11-10', [3, 2]], ['2026-11-09', [1]]]);
  });
});
