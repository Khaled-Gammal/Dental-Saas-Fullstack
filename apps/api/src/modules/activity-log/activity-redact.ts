/**
 * Phase 2D: what of each audit row a reader of the activity log may see. `audit:read` shows who did what and when; the
 * record's name, its link and what changed in it follow the reader's other permissions (a role with the log but not
 * the patient files, clinical records or money sees "عدّل فاتورة" and no more). Free text people typed (reasons,
 * notes) is never returned: rows written before the triggers marked them private still hold the words, so they are
 * replaced here by `true` (changed). Pure, unit-tested.
 */

/** Keys whose values are text people typed: "changed", never the words. */
export const FREE_TEXT_KEYS: ReadonlySet<string> = new Set([
  'reason', 'note', 'notes', 'description', 'discount_reason', 'discount_note', 'void_reason', 'reversal_reason', 'waived_reason',
  'decision_note', 'cancel_reason', 'internal_notes', 'patient_notes', 'cancellation_reason', 'comment', 'previous_note',
]);

const CLINICAL = ['visit', 'visit_procedure', 'visit_amendment', 'prescription', 'prescription_item', 'tooth_record', 'treatment_plan', 'treatment_plan_item', 'patient_chart', 'patient_medical_history', 'recall'];
const PATIENT = ['patient', 'patient_file'];
const MONEY = ['invoice', 'invoice_item', 'payment', 'refund', 'payment_plan', 'installment', 'balance_adjustment'];
const EXPENSES = ['expense', 'expense_category'];
const CASH = ['cash_session', 'cash_session_reopening'];
const APPOINTMENTS = ['appointment'];

/** Any of these permissions shows the record's details (name, link, changes). */
const DETAIL: Record<string, readonly string[]> = Object.fromEntries([
  ...CLINICAL.map((t) => [t, ['clinical:read', 'clinical:write']]),
  ...PATIENT.map((t) => [t, ['patients:read']]),
  ...MONEY.map((t) => [t, ['invoices:read']]),
  ...EXPENSES.map((t) => [t, ['expenses:read', 'expenses:approve']]),
  ...CASH.map((t) => [t, ['cash:operate', 'cash:reopen']]),
  ...APPOINTMENTS.map((t) => [t, ['appointments:read']]),
]);

/** Records whose name in the log is a patient's (the name needs patients:read as well). */
const NAMED_BY_PATIENT = new Set([...PATIENT, 'patient_medical_history', 'patient_chart', 'appointment', 'visit']);

/** The permissions that show a row's details (null: audit:read is enough). Medical history edits are logged on the patient. */
export function detailPermissions(entityType: string, action: string): readonly string[] | null {
  if (action.startsWith('patient.medical_history')) return ['clinical:read', 'clinical:write'];
  return DETAIL[entityType] ?? null;
}

/** Free text as "changed"; a boolean flag ("a note was given") stays as it is. */
export function redactChanges(changes: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!changes || typeof changes !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(changes)) out[k] = FREE_TEXT_KEYS.has(k) && typeof v !== 'boolean' && v !== null ? true : v;
  return out;
}

export interface RowView { changes: Record<string, unknown> | null; entityLabel: string | null; patientId: string | null }

/** What the reader sees of one row. */
export function viewRow(
  row: { entity_type: string; action: string; changes: Record<string, unknown> | null; entity_label: string | null; patient_id: string | null },
  can: (p: string) => boolean,
): RowView {
  const need = detailPermissions(row.entity_type, row.action);
  const detail = !need || need.some(can);
  const patients = can('patients:read');
  return {
    changes: detail ? redactChanges(row.changes) : null,
    entityLabel: detail && (patients || !NAMED_BY_PATIENT.has(row.entity_type)) ? row.entity_label : null,
    patientId: patients && detail ? row.patient_id : null,
  };
}
