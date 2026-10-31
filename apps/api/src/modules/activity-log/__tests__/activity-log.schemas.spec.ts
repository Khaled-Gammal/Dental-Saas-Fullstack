import { ActivityQuery, daySpan, decodeCursor, encodeCursor, entityTypes } from '../activity-log.schemas';

describe('activity log query (Phase 2D)', () => {
  it('defaults, days, and a range in order', () => {
    expect(ActivityQuery.parse({})).toMatchObject({ kind: 'all', limit: 50 });
    expect(ActivityQuery.safeParse({ from: '2026-11-10', to: '2026-11-01' }).success).toBe(false);
    expect(ActivityQuery.safeParse({ from: '10/11/2026' }).success).toBe(false);
    expect(ActivityQuery.safeParse({ entity: 'invoice; drop' }).success).toBe(false);
    expect(ActivityQuery.safeParse({ unknown: 1 }).success).toBe(false);
  });
  it('a cursor keeps the microseconds and round-trips; a forged one is ignored', () => {
    const at = '2026-11-01T10:00:00.123456Z';
    expect(decodeCursor(encodeCursor(at, 42))).toEqual({ at, id: 42 });
    expect(decodeCursor(encodeCursor('2026-11-01T10:00:00.123Z', 42))).toBeNull(); // a millisecond time would skip rows
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(Buffer.from("x|1' or 1=1").toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from(`${at}|1|2`).toString('base64url'))).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
  it('a record group takes in what belongs to it', () => {
    expect(entityTypes('patient')).toEqual(expect.arrayContaining(['patient', 'patient_medical_history', 'patient_chart']));
    expect(entityTypes('visit')).toEqual(expect.arrayContaining(['visit', 'prescription', 'tooth_record', 'recall']));
    expect(entityTypes('clinic')).toEqual(expect.arrayContaining(['clinic', 'clinic_settings']));
    expect(entityTypes('expense_category')).toEqual(['expense_category']);
    expect(entityTypes('constructor')).toEqual(['constructor']);
    expect(entityTypes(undefined)).toBeNull();
  });
  it('counts days', () => {
    expect(daySpan('2026-11-01', '2026-11-01')).toBe(1);
    expect(daySpan('2026-01-01', '2026-12-31')).toBe(365);
  });
});
