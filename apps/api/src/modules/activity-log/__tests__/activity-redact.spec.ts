import { redactChanges, viewRow } from '../activity-redact';

const row = (entity_type: string, action: string, changes: Record<string, unknown> | null = { status: ['draft', 'issued'] }) =>
  ({ entity_type, action, changes, entity_label: 'أحمد علي · 1001', patient_id: 'p1' });
const perms = (...p: string[]) => (x: string) => p.includes('*') || p.includes(x);

describe('what an activity log reader sees (Phase 2D)', () => {
  it('text people typed is "changed", never the words; flags and values stay', () => {
    expect(redactChanges({ reason: 'المريض غير راضٍ', void_reason: ['', 'خطأ'], discount_note: 'x', previous_note: 'العد ناقص 50', note: false, total_minor: [1, 2], notes: true }))
      .toEqual({ reason: true, void_reason: true, discount_note: true, previous_note: true, note: false, total_minor: [1, 2], notes: true });
    expect(redactChanges(null)).toBeNull();
  });

  it('the owner sees everything (but no typed text)', () => {
    expect(viewRow(row('invoice', 'invoice.update', { discount_reason: 'قريب', status: ['draft', 'issued'] }), perms('*')))
      .toEqual({ changes: { discount_reason: true, status: ['draft', 'issued'] }, entityLabel: 'أحمد علي · 1001', patientId: 'p1' });
  });

  it('details follow the reader\'s other permissions', () => {
    const audit = perms('audit:read');
    expect(viewRow(row('invoice', 'invoice.update'), audit)).toEqual({ changes: null, entityLabel: null, patientId: null });
    expect(viewRow(row('tooth_record', 'tooth_record.update'), perms('audit:read', 'patients:read')).changes).toBeNull();
    expect(viewRow(row('tooth_record', 'tooth_record.update'), perms('audit:read', 'clinical:read')).changes).not.toBeNull();
    // medical history edits are logged on the patient: clinical, not just the file
    expect(viewRow(row('patient', 'patient.medical_history.update'), perms('audit:read', 'patients:read')).changes).toBeNull();
    expect(viewRow(row('patient', 'patient.update'), perms('audit:read', 'patients:read')).changes).not.toBeNull();
    expect(viewRow(row('expense', 'expense.update'), perms('audit:read', 'expenses:read')).changes).not.toBeNull();
    expect(viewRow(row('cash_session', 'cash_session.closed'), audit).changes).toBeNull();
    // team and settings: audit:read is enough
    expect(viewRow(row('role', 'role.update'), audit).changes).not.toBeNull();
  });

  it('a patient\'s name and link need the patient files', () => {
    const r = viewRow(row('appointment', 'appointment.update'), perms('audit:read', 'appointments:read'));
    expect(r).toMatchObject({ entityLabel: null, patientId: null });
    expect(r.changes).not.toBeNull();
    expect(viewRow(row('appointment', 'appointment.update'), perms('audit:read', 'appointments:read', 'patients:read')))
      .toMatchObject({ entityLabel: 'أحمد علي · 1001', patientId: 'p1' });
    // an invoice's number is not a patient's name; its link to the patient still needs the files
    expect(viewRow(row('invoice', 'invoice.update'), perms('audit:read', 'invoices:read'))).toMatchObject({ entityLabel: 'أحمد علي · 1001', patientId: null });
  });
});
