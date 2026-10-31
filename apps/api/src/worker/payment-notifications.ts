import { sql, type Tx } from '@dental/db';
import { emailMoney, emailWhen } from '../shared/notifications/arabic-mail';
import { safeTimeZone } from '../shared/time/clinic-time';
import type { OutboxHandler } from './outbox-relay';

/**
 * Review R11 (NTF-03): `payment.received` → an emailed receipt for the patient (email only; nothing when they have
 * no email). Keyed per payment, so re-running the handler sends one receipt. A payment reversed before the worker got
 * to it (entered in error) sends nothing.
 */
export interface PaymentRow {
  id: string; tenant_id: string; status: string; amount_minor: number; currency: string; method: string; paid_at: Date;
  patient_id: string; patient_name: string | null; patient_email: string | null;
  invoice_number: string | null; balance_minor: number | null;
  clinic_ar: string | null; clinic_en: string | null; tz: string | null;
}

const METHOD_AR: Record<string, string> = { cash: 'نقدًا', card: 'بطاقة', bank_transfer: 'تحويل بنكي', wallet: 'محفظة إلكترونية', instapay: 'إنستاباي' };
const RECEIPT_STATUSES = ['succeeded', 'partially_refunded'];

/** The receipt for one payment. Pure, so the wording is testable without a database. */
export function paymentMessages(p: PaymentRow): { recipient: string; subject: string; body: string; dedupe: string }[] {
  if (!p.patient_email || !RECEIPT_STATUSES.includes(p.status)) return [];
  const clinic = p.clinic_ar ?? p.clinic_en ?? '';
  const lines = [
    `${p.patient_name ?? ''}،`,
    `استلمنا دفعتك في ${clinic}. شكرًا لك.`,
    `المبلغ: ${emailMoney(Number(p.amount_minor), p.currency)}${METHOD_AR[p.method] ? ` (${METHOD_AR[p.method]})` : ''}`,
    `التاريخ: ${emailWhen(new Date(p.paid_at), safeTimeZone(p.tz))}`,
    ...(p.invoice_number ? [`رقم الفاتورة: ${p.invoice_number}`] : []),
    ...(p.balance_minor !== null && Number(p.balance_minor) > 0 ? [`المتبقي على الفاتورة: ${emailMoney(Number(p.balance_minor), p.currency)}`] : []),
    ...(p.balance_minor !== null && Number(p.balance_minor) <= 0 ? ['تم سداد الفاتورة بالكامل.'] : []),
  ];
  return [{ recipient: p.patient_email, subject: `إيصال دفع – ${clinic}`, body: lines.join('\n'), dedupe: `payment:${p.id}` }];
}

export const paymentReceived: OutboxHandler = async (tx: Tx, event) => {
  const paymentId = String(event.payload.paymentId ?? '');
  if (!paymentId) return;
  const { rows } = await sql<PaymentRow>`
    select p.id, p.tenant_id, p.status, p.amount_minor, p.currency, p.method, p.paid_at, p.patient_id,
           pa.full_name as patient_name, pa.email as patient_email, i.number as invoice_number, i.balance_minor,
           t.name_ar as clinic_ar, t.name_en as clinic_en, coalesce(b.timezone, t.timezone) as tz
    from payments p
    join patients pa on pa.id = p.patient_id
    join tenants t on t.id = p.tenant_id
    left join invoices i on i.id = p.invoice_id
    left join branches b on b.id = p.branch_id
    where p.id = ${paymentId}`.execute(tx);
  const p = rows[0];
  if (!p) return;
  // the balance right after this payment (recorded by the API), not whatever later payments made it
  const after = event.payload.balanceAfterMinor;
  if (typeof after === 'number') p.balance_minor = after;
  for (const m of paymentMessages(p)) {
    await tx.insertInto('notifications').values({
      tenant_id: p.tenant_id, event: 'payment.received', channel: 'email', recipient: m.recipient, patient_id: p.patient_id,
      subject: m.subject, body: m.body, dedupe_key: m.dedupe, related_type: 'payment', related_id: p.id, scheduled_at: sql<Date>`now()`,
    }).onConflict((oc) => oc.columns(['tenant_id', 'dedupe_key']).doNothing()).execute();
  }
};
