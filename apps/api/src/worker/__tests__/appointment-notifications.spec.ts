import { appointmentMessages, rescheduleMessages, type AppointmentRow } from '../appointment-notifications';

const base: AppointmentRow = {
  id: 'a1', tenant_id: 't1', starts_at: new Date('2026-10-24T14:00:00Z'), status: 'confirmed', source: 'website', has_code: true, patient_notes: null,
  patient_name: 'Omar', patient_phone: '+201011111111', patient_email: 'omar@example.test', patient_id: 'p1',
  doctor_ar: 'د. أحمد', doctor_en: 'Dr. Ahmed', service_ar: 'كشف', service_en: 'Consultation',
  branch_ar: 'مدينة نصر', branch_en: 'Nasr City', branch_address: '12 شارع', branch_tz: null,
  clinic_ar: 'عيادة', clinic_en: 'Clinic', clinic_email: 'clinic@example.test', clinic_tz: 'Africa/Cairo', offsets: [1440, 120],
};
const now = new Date('2026-10-20T10:00:00Z').getTime();

describe('appointmentMessages', () => {
  it('website booking: patient confirmation with the code line, clinic notice, two reminders', () => {
    const m = appointmentMessages(base, now);
    expect(m.map((x) => x.dedupe)).toEqual(['booking:a1:patient:email', 'booking:a1:clinic:email', 'reminder:a1:1440', 'reminder:a1:120']);
    expect(m[0].body).toContain('رمز الحضور');
    expect(m[1].subject).toContain('من الموقع');
  });
  it('staff booking: no code promise and no clinic notice', () => {
    const m = appointmentMessages({ ...base, source: 'phone', has_code: false }, now);
    expect(m.map((x) => x.dedupe)).toEqual(['booking:a1:patient:email', 'reminder:a1:1440', 'reminder:a1:120']);
    expect(m[0].body).not.toContain('رمز الحضور');
  });
  it('reminders already in the past are skipped; no email means nothing for the patient', () => {
    expect(appointmentMessages(base, new Date('2026-10-24T13:00:00Z').getTime()).filter((x) => x.event === 'appointment.reminder')).toEqual([]);
    expect(appointmentMessages({ ...base, patient_email: null }, now).map((x) => x.dedupe)).toEqual(['booking:a1:clinic:email']);
  });
  it('a bad time zone falls back instead of throwing', () => {
    expect(() => appointmentMessages({ ...base, branch_tz: 'Cairo ' }, now)).not.toThrow();
  });
  it('times are shown in the branch zone', () => {
    const riyadh = appointmentMessages({ ...base, branch_tz: 'Asia/Riyadh' }, now)[0].body;
    expect(riyadh).toContain('17:00'); // 14:00Z is 17:00 in Riyadh, 16:00 in Cairo
  });
});

describe('rescheduleMessages', () => {
  const stamp = Math.floor(base.starts_at.getTime() / 1000);
  it('tells the patient the new time and re-plans the reminders under keys of the new start', () => {
    const m = rescheduleMessages(base, now);
    expect(m.map((x) => x.dedupe)).toEqual([`moved:a1:${stamp}`, `reminder:a1:1440:${stamp}`, `reminder:a1:120:${stamp}`]);
    expect(m[0].subject).toContain('تغيّر موعدك');
    expect(m.some((x) => x.event === 'booking.created')).toBe(false); // no second confirmation, no clinic notice
  });
  it('a later move gets its own keys, so its reminders are not swallowed as duplicates', () => {
    const later = rescheduleMessages({ ...base, starts_at: new Date('2026-10-25T14:00:00Z') }, now).map((x) => x.dedupe);
    expect(later).not.toContain(`reminder:a1:1440:${stamp}`);
  });
  it('without an email there is nothing to send', () => {
    expect(rescheduleMessages({ ...base, patient_email: null }, now)).toEqual([]);
  });
});
