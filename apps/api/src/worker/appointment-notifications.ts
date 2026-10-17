import { sql, type Tx } from '@dental/db';
import { safeTimeZone } from '../shared/time/clinic-time';
import type { OutboxHandler } from './outbox-relay';

/**
 * `appointment.created` → notification rows (NTF-03/04), email only: the patient's confirmation, the clinic's
 * notice for website bookings (staff made the others themselves), and reminders at the clinic's offsets.
 * Each row has a dedupe key, so re-running the handler never sends twice. Templates are code for now
 * (NTF-02 editable templates is V1).
 */
interface Row {
  id: string; tenant_id: string; starts_at: Date; status: string; source: string; has_code: boolean; patient_notes: string | null;
  patient_name: string | null; patient_phone: string | null; patient_email: string | null; patient_id: string | null;
  doctor_ar: string | null; doctor_en: string | null; service_ar: string | null; service_en: string | null;
  branch_ar: string | null; branch_en: string | null; branch_address: string | null; branch_tz: string | null;
  clinic_ar: string | null; clinic_en: string | null; clinic_email: string | null; clinic_tz: string; offsets: number[];
}

const pick = (ar: string | null, en: string | null) => ar ?? en ?? '';

function when(at: Date, tz: string) {
  const f = new Intl.DateTimeFormat('ar-EG', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const en = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return { ar: f.format(at), en: en.format(at) };
}

interface Message { recipient: string; subject: string; body: string; dedupe: string; event: string; scheduledAt?: Date }

/** The messages for one appointment. Pure, so the wording rules are testable without a database. */
export function appointmentMessages(a: Row, now: number): Message[] {
  const tz = safeTimeZone(a.branch_tz ?? a.clinic_tz); // a bad zone string must not stop every email for the branch
  const at = when(new Date(a.starts_at), tz);
  const clinic = pick(a.clinic_ar, a.clinic_en);
  const doctor = pick(a.doctor_ar, a.doctor_en);
  const service = pick(a.service_ar, a.service_en);
  const branch = [pick(a.branch_ar, a.branch_en), a.branch_address].filter(Boolean).join(' – ');
  const website = a.source === 'website';
  const statusAr = a.status === 'confirmed' ? 'تم تأكيد موعدك' : 'تم استلام طلب الحجز وسنؤكده قريبًا';
  const out: Message[] = [];

  if (a.patient_email) {
    const codeLine = a.has_code ? 'رمز الحضور وصلك في رسالة منفصلة؛ أظهره في الاستقبال.\n' : ''; // staff bookings have no reception code
    out.push({
      event: 'booking.created', recipient: a.patient_email, subject: `${statusAr} – ${clinic}`, dedupe: `booking:${a.id}:patient:email`,
      body: `${a.patient_name}،\n${statusAr}.\nالموعد: ${at.ar}\nالطبيب: ${doctor}\n${service ? `الخدمة: ${service}\n` : ''}الفرع: ${branch}\n${codeLine}\n${a.status === 'confirmed' ? 'Your appointment is confirmed' : 'Your booking request was received'}: ${at.en} with ${doctor} at ${branch}.`,
    });
  }
  if (a.clinic_email && website) {
    out.push({
      event: 'booking.created', recipient: a.clinic_email, subject: `حجز جديد من الموقع – ${a.patient_name}`, dedupe: `booking:${a.id}:clinic:email`,
      body: `حجز جديد من الموقع (${a.status === 'confirmed' ? 'مؤكد' : 'بانتظار التأكيد'})\nالمريض: ${a.patient_name} – ${a.patient_phone}\nالموعد: ${at.ar}\nالطبيب: ${doctor}\n${service ? `الخدمة: ${service}\n` : ''}الفرع: ${branch}\n${a.patient_notes ? `ملاحظات المريض: ${a.patient_notes}\n` : ''}`,
    });
  }
  for (const offset of a.offsets ?? []) {
    const sendAt = new Date(a.starts_at).getTime() - offset * 60_000;
    if (sendAt <= now || !a.patient_email) continue;
    out.push({
      event: 'appointment.reminder', recipient: a.patient_email, subject: `تذكير بموعدك – ${clinic}`, dedupe: `reminder:${a.id}:${offset}`, scheduledAt: new Date(sendAt),
      body: `تذكير: موعدك في ${clinic} ${at.ar} مع ${doctor}.\nالفرع: ${branch}\n\nReminder: ${at.en} with ${doctor}, ${clinic}.`,
    });
  }
  return out;
}

/**
 * After a move (SRS APPT-001): the patient is told the new time, and reminders are re-planned for it. Keys carry the new
 * start, so a second move plans its own reminders, and re-running the handler for the same move adds nothing.
 */
export function rescheduleMessages(a: Row, now: number): Message[] {
  const stamp = Math.floor(new Date(a.starts_at).getTime() / 1000);
  const tz = safeTimeZone(a.branch_tz ?? a.clinic_tz);
  const at = when(new Date(a.starts_at), tz);
  const clinic = pick(a.clinic_ar, a.clinic_en);
  const doctor = pick(a.doctor_ar, a.doctor_en);
  const branch = [pick(a.branch_ar, a.branch_en), a.branch_address].filter(Boolean).join(' – ');
  const out: Message[] = appointmentMessages(a, now)
    .filter((m) => m.event === 'appointment.reminder')
    .map((m) => ({ ...m, dedupe: `${m.dedupe}:${stamp}` }));
  if (a.patient_email) {
    out.unshift({
      event: 'appointment.rescheduled', recipient: a.patient_email, subject: `تغيّر موعدك – ${clinic}`, dedupe: `moved:${a.id}:${stamp}`,
      body: `${a.patient_name}،\nتم تغيير موعدك.\nالموعد الجديد: ${at.ar}\nالطبيب: ${doctor}\nالفرع: ${branch}`,
    });
  }
  return out;
}

async function loadRow(tx: Tx, appointmentId: string): Promise<Row | undefined> {
  const { rows } = await sql<Row>`
    select a.id, a.tenant_id, a.starts_at, a.status, a.source, a.check_in_code_hash is not null as has_code, a.patient_notes,
           p.full_name as patient_name, p.phone as patient_phone, p.email as patient_email, p.id as patient_id,
           d.name_ar as doctor_ar, d.name_en as doctor_en, s.name_ar as service_ar, s.name_en as service_en,
           b.name_ar as branch_ar, b.name_en as branch_en, coalesce(b.address_ar, b.address_en) as branch_address, b.timezone as branch_tz,
           t.name_ar as clinic_ar, t.name_en as clinic_en, t.email as clinic_email, t.timezone as clinic_tz, ts.reminder_offsets_minutes as offsets
    from appointments a
    join tenants t on t.id = a.tenant_id
    join tenant_settings ts on ts.tenant_id = a.tenant_id
    join branches b on b.id = a.branch_id
    join doctors d on d.id = a.doctor_id
    left join services s on s.id = a.service_id
    left join patients p on p.id = a.patient_id
    where a.id = ${appointmentId}`.execute(tx);
  return rows[0];
}

async function queue(tx: Tx, a: Row, messages: Message[]): Promise<void> {
  for (const m of messages) {
    await tx.insertInto('notifications').values({
      tenant_id: a.tenant_id, event: m.event, channel: 'email', recipient: m.recipient, patient_id: a.patient_id, subject: m.subject, body: m.body,
      dedupe_key: m.dedupe, related_type: 'appointment', related_id: a.id, scheduled_at: m.scheduledAt ?? sql<Date>`now()`,
    }).onConflict((oc) => oc.columns(['tenant_id', 'dedupe_key']).doNothing()).execute();
  }
}

export const appointmentCreated: OutboxHandler = async (tx: Tx, event) => {
  const appointmentId = String(event.payload.appointmentId ?? '');
  if (!appointmentId) return;
  const a = await loadRow(tx, appointmentId);
  if (!a || !a.patient_id) return; // a hold that never became a booking
  await queue(tx, a, appointmentMessages(a, Date.now()));
};

export const appointmentRescheduled: OutboxHandler = async (tx: Tx, event) => {
  const appointmentId = String(event.payload.appointmentId ?? '');
  if (!appointmentId) return;
  const a = await loadRow(tx, appointmentId);
  if (!a || !a.patient_id || !['pending', 'confirmed'].includes(a.status)) return;
  // reminders still waiting were planned for the old time
  await tx.updateTable('notifications').set({ status: 'cancelled', last_error: 'appointment moved' })
    .where('related_type', '=', 'appointment').where('related_id', '=', a.id)
    .where('event', '=', 'appointment.reminder').where('status', '=', 'queued').execute();
  await queue(tx, a, rescheduleMessages(a, Date.now()));
};

export type { Row as AppointmentRow };
