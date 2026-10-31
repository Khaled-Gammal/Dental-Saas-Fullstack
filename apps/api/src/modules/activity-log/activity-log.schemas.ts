import { z } from 'zod';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/**
 * Phase 2D: the clinic's activity log, filtered. Days are the clinic's calendar days (its time zone); a range is at
 * most a year. `kind`: everything, changes only, or views only (who opened which record).
 */
export const ActivityQuery = z.object({
  from: Day.optional(),
  to: Day.optional(),
  actor: z.string().uuid().optional(),
  /** a record group ("patient": the file, its medical history, chart and attachments) or one entity type */
  entity: z.string().regex(/^[a-z_]{2,40}$/).optional(),
  kind: z.enum(['all', 'changes', 'views']).default('all'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict().refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from is after to', path: ['to'] });
export type ActivityQueryInput = z.infer<typeof ActivityQuery>;

/** The record groups the screen filters by: each takes in the records that belong to it. */
export const ENTITY_GROUPS: Readonly<Record<string, readonly string[]>> = {
  patient: ['patient', 'patient_medical_history', 'patient_chart', 'patient_file'],
  appointment: ['appointment'],
  visit: ['visit', 'visit_procedure', 'visit_amendment', 'prescription', 'prescription_item', 'tooth_record', 'treatment_plan', 'treatment_plan_item', 'recall'],
  invoice: ['invoice', 'invoice_item', 'payment_plan', 'installment', 'balance_adjustment'],
  payment: ['payment'],
  refund: ['refund'],
  expense: ['expense', 'expense_category'],
  cash_session: ['cash_session', 'cash_session_reopening'],
  member: ['member', 'member_branch', 'invitation'],
  role: ['role'],
  doctor: ['doctor', 'doctor_branch', 'doctor_schedule', 'doctor_time_off', 'doctor_service'],
  service: ['service'],
  branch: ['branch', 'branch_hours', 'holiday', 'room'],
  clinic: ['clinic', 'clinic_settings', 'tenant'],
};
export const entityTypes = (entity: string | undefined): string[] | null =>
  entity ? [...(Object.hasOwn(ENTITY_GROUPS, entity) ? ENTITY_GROUPS[entity] : [entity])] : null;

/**
 * The keyset cursor: the last row's time to the microsecond (as the database gives it, in UTC; a JS Date would cut it
 * to milliseconds and skip rows written in the same transaction) and its id (newest first).
 */
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
export function encodeCursor(at: string, id: number): string {
  return Buffer.from(`${at}|${id}`).toString('base64url');
}
export function decodeCursor(c: string | undefined): { at: string; id: number } | null {
  if (!c) return null;
  const [at, id, extra] = Buffer.from(c, 'base64url').toString().split('|');
  return extra === undefined && AT.test(at ?? '') && !Number.isNaN(Date.parse(at)) && /^\d{1,18}$/.test(id ?? '') ? { at, id: Number(id) } : null;
}

/** Days between two YYYY-MM-DD dates (inclusive of both ends). */
export const daySpan = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
