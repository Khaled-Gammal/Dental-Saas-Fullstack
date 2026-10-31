import {
  adjustmentKindLabel, appointmentSourceLabel, appointmentStatusLabel, cashStatusLabel, discountStatusLabel, expenseStatusLabel, fileKindLabel, genderLabel, installmentStatusLabel,
  invoiceStatusLabel, patientFieldLabel, paymentMethodLabel, paymentStatusLabel, planItemStatusLabel,
} from './labels';
import type { ActivityItem } from './types';

/**
 * Phase 2D: the activity log screen's words — what each row says ("عدّل فاتورة") and what changed, in Arabic, from the
 * log's technical names (`invoice.update`, {"status": ["draft", "issued"]}). Unknown names fall back to something
 * readable instead of English. Pure, unit-tested.
 */
export const ENTITY_LABEL: Record<string, string> = {
  patient: 'ملف مريض', patient_medical_history: 'تاريخ طبي', patient_chart: 'مخطط الأسنان', patient_file: 'ملف مرفق لمريض',
  appointment: 'موعد', visit: 'زيارة', visit_procedure: 'إجراء في زيارة', visit_amendment: 'تصحيح زيارة', prescription: 'روشتة', prescription_item: 'دواء في روشتة',
  treatment_plan: 'خطة علاج', treatment_plan_item: 'بند خطة علاج', tooth_record: 'حالة سن', recall: 'متابعة',
  invoice: 'فاتورة', invoice_item: 'بند فاتورة', payment: 'دفعة', refund: 'استرداد', payment_plan: 'خطة تقسيط', installment: 'قسط', balance_adjustment: 'تسوية رصيد',
  expense: 'مصروف', expense_category: 'بند مصروفات', cash_session: 'خزنة اليوم', cash_session_reopening: 'إعادة فتح الخزنة',
  clinic: 'بيانات العيادة', clinic_settings: 'إعدادات العيادة', tenant: 'العيادة', branch: 'فرع', branch_hours: 'مواعيد فرع', holiday: 'يوم إجازة', room: 'كرسي',
  doctor: 'طبيب', doctor_branch: 'فرع طبيب', doctor_schedule: 'جدول طبيب', doctor_time_off: 'إجازة طبيب', doctor_service: 'خدمة طبيب', service: 'خدمة',
  member: 'عضو فريق', member_branch: 'فروع عضو', invitation: 'دعوة عضو', role: 'دور وصلاحيات',
};

/**
 * The "record type" filter, most asked first. Each is a group on the server: a patient's file takes in its medical
 * history, chart and attachments; a visit its procedures, prescriptions and teeth; the clinic its settings.
 */
export const ENTITY_FILTER: { value: string; label: string }[] = [
  { value: 'patient', label: 'ملفات المرضى' }, { value: 'appointment', label: 'المواعيد' }, { value: 'visit', label: 'الزيارات والعلاج والمتابعات' },
  { value: 'invoice', label: 'الفواتير والتقسيط' }, { value: 'payment', label: 'المدفوعات' }, { value: 'refund', label: 'الاستردادات' },
  { value: 'expense', label: 'المصروفات' }, { value: 'cash_session', label: 'الخزنة' }, { value: 'member', label: 'الفريق والدعوات' },
  { value: 'role', label: 'الأدوار والصلاحيات' }, { value: 'doctor', label: 'الأطباء وجداولهم' }, { value: 'service', label: 'الخدمات' },
  { value: 'branch', label: 'الفروع ومواعيدها' }, { value: 'clinic', label: 'بيانات العيادة وإعداداتها' },
];

const VERB: Record<string, string> = { create: 'أضاف', update: 'عدّل', delete: 'حذف', view: 'فتح' };

/** Actions with their own words (not "verb + record"); `{e}` is the record's name. Keys use `_` for `.`. */
const ACTION: Record<string, string> = {
  tenant_signup: 'أنشأ حساب العيادة',
  patient_merge: 'دمج ملفًا مكررًا في {e}', patient_merged_into: 'دُمج {e} في ملف آخر', patient_import: 'استورد مرضى من ملف',
  patient_medical_history_update: 'عدّل التاريخ الطبي في {e}', patient_booking_contact_differs: 'حجز من الموقع ببيانات تواصل مختلفة عن {e}',
  patient_file_create: 'رفع ملفًا مرفقًا إلى {e}', patient_file_archive: 'أرشف ملفًا مرفقًا في {e}', patient_file_view: 'فتح ملفًا مرفقًا في {e}',
  invoice_discount_requested: 'طلب موافقة على خصم في {e}', invoice_discount_approved: 'وافق على الخصم في {e}', invoice_discount_rejected: 'رفض الخصم في {e}',
  expense_approved: 'وافق على {e}', expense_rejected: 'رفض {e}', expense_voided: 'ألغى {e}', expense_document_attached: 'أرفق مستندًا إلى {e}',
  clinic_data_export_requested: 'طلب تصدير بيانات العيادة', clinic_data_export_downloaded: 'نزّل تصدير بيانات العيادة',
  cash_session_closed: 'قفل {e}', cash_session_reopened: 'أعاد فتح {e}',
};

/** What the row says, without the actor: "عدّل فاتورة", "أنشأ حساب العيادة". */
export function activityText(action: string, entityType: string): string {
  const entity = ENTITY_LABEL[entityType] ?? 'سجل';
  const own = ACTION[action.replace(/\./g, '_')];
  if (own) return own.replace('{e}', entity);
  return `${VERB[action.split('.').pop() ?? ''] ?? 'غيّر'} ${entity}`;
}

export const isView = (action: string) => action.endsWith('.view');

const FIELD: Record<string, string> = {
  ...patientFieldLabel,
  status: 'الحالة', starts_at: 'الموعد', ends_at: 'نهاية الموعد', doctor_id: 'الطبيب', branch_id: 'الفرع', room_id: 'الكرسي', patient_id: 'المريض',
  service_id: 'الخدمة', role_id: 'الدور', permissions: 'الصلاحيات', name_ar: 'الاسم', name_en: 'الاسم بالإنجليزية', title_ar: 'اللقب',
  price_minor: 'السعر', price_max_minor: 'أقصى سعر', amount_minor: 'المبلغ', total_minor: 'الإجمالي', subtotal_minor: 'المجموع', paid_minor: 'المدفوع',
  balance_minor: 'المتبقي', discount_minor: 'الخصم', discount_bp: 'نسبة الخصم', discount_type: 'نوع الخصم', discount_reason: 'سبب الخصم', discount_status: 'حالة الخصم',
  tax_minor: 'الضريبة', quantity: 'الكمية', unit_price_minor: 'سعر الوحدة', method: 'طريقة الدفع', payment_method: 'طريقة الدفع', reference: 'المرجع',
  paid_at: 'وقت الدفع', due_date: 'تاريخ الاستحقاق', issue_date: 'تاريخ الإصدار', number: 'الرقم', description: 'الوصف', note: 'الملاحظة', reason: 'السبب',
  cancel_reason: 'سبب الإلغاء', void_reason: 'سبب الإلغاء', internal_notes: 'ملاحظات داخلية', patient_notes: 'ملاحظات المريض', is_active: 'مفعّل',
  show_on_website: 'يظهر على الموقع', bookable_online: 'حجز أونلاين', duration_minutes: 'المدة', weekday: 'اليوم', opens_at: 'يفتح', closes_at: 'يغلق',
  date: 'التاريخ', category_id: 'البند', opening_float_minor: 'رصيد الافتتاح', counted_minor: 'المعدود', closed_at: 'وقت القفل', expected_minor: 'المتوقع',
  primary_phone: 'الهاتف', whatsapp: 'واتساب', about_ar: 'نبذة العيادة', currency: 'العملة', timezone: 'المنطقة الزمنية', logo_file_id: 'الشعار',
  checked_in_at: 'وقت الحضور', source: 'المصدر', specialties: 'التخصصات', sort_order: 'الترتيب',
  discount_note: 'ملاحظة الخصم', reversal_reason: 'سبب الإلغاء', waived_reason: 'سبب الإعفاء', decision_note: 'ملاحظة القرار', previous_note: 'ملاحظة القفل السابقة', kind: 'النوع',
  cancelled_by: 'ألغاه', patient_reschedules: 'مرات تغيير المريض للموعد',
};

/** Fields whose values are text people typed: the log keeps only that they changed. */
const FREE_TEXT = new Set([
  'reason', 'note', 'notes', 'description', 'discount_reason', 'discount_note', 'void_reason', 'reversal_reason', 'waived_reason', 'decision_note',
  'cancel_reason', 'internal_notes', 'patient_notes', 'cancellation_reason', 'comment', 'previous_note',
]);

/** Coded values in Arabic: a status by the record it belongs to, and the other codes the log holds. */
const STATUS: Record<string, Record<string, string>> = {
  invoice: invoiceStatusLabel, expense: expenseStatusLabel, cash_session: cashStatusLabel, installment: installmentStatusLabel,
  treatment_plan_item: planItemStatusLabel, appointment: appointmentStatusLabel, payment: paymentStatusLabel,
};
const CODES: Record<string, Record<string, string>> = {
  discount_status: discountStatusLabel, method: paymentMethodLabel, payment_method: paymentMethodLabel, source: appointmentSourceLabel, gender: genderLabel,
  cancelled_by: { patient: 'المريض (من رابط الموعد)', clinic: 'العيادة', system: 'النظام' },
};
const codeLabel = (entityType: string, key: string, v: string): string | undefined =>
  (key === 'status' ? STATUS[entityType] : key === 'kind' ? (entityType === 'balance_adjustment' ? adjustmentKindLabel : fileKindLabel) : CODES[key])?.[v];

export type ChangeValue = { kind: 'text'; text: string } | { kind: 'money'; minor: number } | { kind: 'time'; iso: string } | { kind: 'empty' } | { kind: 'changed' };
/**
 * One changed field: before and after (`from` null when the log holds one value, e.g. the total a discount request was
 * for); `secret` when it is text people typed, which the log keeps only as "changed".
 */
export interface ChangeLine { field: string; from: ChangeValue | null; to: ChangeValue; secret: boolean }

const value = (entityType: string, key: string, v: unknown): ChangeValue => {
  if (v === null || v === undefined || v === '') return { kind: 'empty' };
  if (key.endsWith('_id') || typeof v === 'object') return { kind: 'changed' }; // ids and lists: "changed", not raw values
  if (typeof v === 'boolean') return { kind: 'text', text: v ? 'نعم' : 'لا' };
  if (key.endsWith('_minor') && typeof v === 'number') return { kind: 'money', minor: v };
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return { kind: 'time', iso: v };
  if (typeof v === 'string') { const label = codeLabel(entityType, key, v); if (label) return { kind: 'text', text: label }; }
  return { kind: 'text', text: String(v) };
};

/**
 * The changed fields of a row about `entityType`: their Arabic names (unknown ones grouped as "بيانات أخرى"), before
 * and after, codes in Arabic. Text people typed is stored only as "changed" (`true`); a flag (`false`: "no note given")
 * is left out.
 */
export function changeLines(changes: Record<string, unknown> | null, entityType = '', action = ''): { lines: ChangeLine[]; others: number } {
  const lines: ChangeLine[] = [];
  let others = 0;
  // a new record lists every column: the empty ones, and its private text marked "changed" whether it was filled or not
  const created = action.endsWith('.create');
  const blank = (x: unknown) => x === null || x === undefined || x === '';
  for (const [key, v] of Object.entries(changes ?? {})) {
    if (Array.isArray(v) && v.length === 2 && blank(v[0]) && blank(v[1])) continue;
    if (created && v === true) continue;
    const secret = FREE_TEXT.has(key);
    const field = FIELD[key];
    if (!field) { others++; continue; }
    if (typeof v === 'boolean' && secret) { if (v) lines.push({ field, from: null, to: { kind: 'changed' }, secret }); continue; }
    if (v === true) { lines.push({ field, from: null, to: { kind: 'changed' }, secret }); continue; }
    if (Array.isArray(v) && v.length === 2) lines.push({ field, from: value(entityType, key, v[0]), to: value(entityType, key, v[1]), secret: false });
    else lines.push({ field, from: null, to: value(entityType, key, v), secret: false });
  }
  return { lines, others };
}

/** The period presets (clinic days, inclusive). */
export type Period = 'today' | 'week' | 'month' | 'custom';
export function periodRange(p: Exclude<Period, 'custom'>, today: string): { from: string; to: string } {
  const back = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  return { from: p === 'today' ? today : back(p === 'week' ? 6 : 29), to: today };
}

/** Rows grouped by the clinic's day (the list shows a heading per day). */
export function byDay(items: ActivityItem[], dayOf: (iso: string) => string): { day: string; items: ActivityItem[] }[] {
  const out: { day: string; items: ActivityItem[] }[] = [];
  for (const it of items) {
    const d = dayOf(it.at);
    if (out.length && out[out.length - 1].day === d) out[out.length - 1].items.push(it);
    else out.push({ day: d, items: [it] });
  }
  return out;
}
