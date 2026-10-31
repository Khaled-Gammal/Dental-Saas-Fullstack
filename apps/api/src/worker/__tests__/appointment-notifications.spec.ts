import { MANAGE_LINK_SLOT } from '../../shared/manage-link';
import { appointmentMessages, cancelledMessages, confirmedMessages, rescheduleMessages, type AppointmentRow } from '../appointment-notifications';

const base: AppointmentRow = {
  id: 'a1', tenant_id: 't1', starts_at: new Date('2026-10-24T14:00:00Z'), status: 'confirmed', source: 'website', has_code: true, patient_notes: null,
  patient_name: 'Omar', patient_phone: '+201011111111', patient_email: 'omar@example.test', patient_id: 'p1',
  doctor_ar: 'د. أحمد', doctor_en: 'Dr. Ahmed', service_ar: 'كشف', service_en: 'Consultation',
  branch_ar: 'مدينة نصر', branch_en: 'Nasr City', branch_address: '12 شارع', branch_tz: null,
  clinic_ar: 'عيادة', clinic_en: 'Clinic', clinic_email: 'clinic@example.test', clinic_tz: 'Africa/Cairo', offsets: [1440, 120],
};
const now = new Date('2026-10-20T10:00:00Z').getTime();
const LINK = MANAGE_LINK_SLOT; // the sender puts the link in at send time

describe('appointmentMessages', () => {
  it('Phase 2E: the confirmation and every reminder carry the patient\'s own link, when there is one', () => {
    const m = appointmentMessages({ ...base, can_manage: true }, now);
    expect(m.filter((x) => x.recipient === base.patient_email).every((x) => x.body.includes(LINK))).toBe(true);
    expect(m.find((x) => x.recipient === base.clinic_email)!.body).not.toContain(LINK); // the clinic's notice: no patient link
    expect(appointmentMessages(base, now).some((x) => x.body.includes('لإلغاء الموعد'))).toBe(false);
  });
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
    expect(riyadh).toMatch(/5:00 م/); // 14:00Z is 5 pm in Riyadh, 4 pm in Cairo (12-hour clock, CLR-08)
  });
  it('emails are Arabic only, with Latin digits (L10N-004, CLR-08)', () => {
    const linked = { ...base, can_manage: true, site_url: 'https://clinic-a.example.test', clinic_phone: '+20225550000' };
    for (const x of [...appointmentMessages(linked, now), ...rescheduleMessages(linked, now, 1), ...rescheduleMessages({ ...linked, status: 'pending' }, now, 2, 'patient'),
      ...cancelledMessages({ ...base, clinic_phone: '+20225550000' }, now), ...cancelledMessages(linked, now, 'patient'), ...confirmedMessages(linked, now)]) {
      // names are data and may be Latin (brand names, CLR-07 note); everything else is Arabic
      // the clinic's site address is an address, not words (Phase 2E)
      expect(`${x.subject}\n${x.body}`.replaceAll(base.patient_name!, '').replace(/https?:\/\/\S+/g, '')).not.toMatch(/[A-Za-z]{2,}/);
      expect(x.body).not.toMatch(/[٠-٩]/);
    }
  });
});

describe('rescheduleMessages', () => {
  it('tells the patient the new time and re-plans the reminders under keys of this move', () => {
    const m = rescheduleMessages(base, now, 41);
    expect(m.map((x) => x.dedupe)).toEqual(['moved:a1:m41', 'reminder:a1:1440:m41', 'reminder:a1:120:m41']);
    expect(m[0].subject).toContain('تغيّر موعدك');
    expect(m.some((x) => x.event === 'booking.created')).toBe(false); // no second confirmation, no clinic notice
  });
  it('a later move gets its own keys, so its reminders are not swallowed as duplicates', () => {
    const later = rescheduleMessages({ ...base, starts_at: new Date('2026-10-25T14:00:00Z') }, now, 42).map((x) => x.dedupe);
    expect(later).not.toContain('reminder:a1:1440:m41');
  });
  it('moving back to a time used before still plans its reminders (review R11)', () => {
    const first = rescheduleMessages(base, now, 41).map((x) => x.dedupe);
    const back = rescheduleMessages(base, now, 43).map((x) => x.dedupe);
    expect(back.filter((k) => first.includes(k))).toEqual([]);
  });
  it('without an email there is nothing to send', () => {
    expect(rescheduleMessages({ ...base, patient_email: null }, now, 41)).toEqual([]);
  });
  it('the patient\'s own move: told to them (waiting for the clinic when it confirms by hand) and to the clinic', () => {
    const m = rescheduleMessages({ ...base, status: 'pending', can_manage: true }, now, 7, 'patient');
    expect(m.map((x) => x.dedupe)).toEqual(['moved:a1:m7', 'reminder:a1:1440:m7', 'reminder:a1:120:m7', 'moved:a1:m7:clinic']);
    expect(m[0].body).toContain('بناءً على طلبك');
    expect(m[0].body).toContain('سنؤكد');
    expect(m[0].body).toContain(LINK);
    expect(m[3].body).toContain('بانتظار تأكيدكم');
    expect(rescheduleMessages(base, now, 7).some((x) => x.recipient === base.clinic_email)).toBe(false); // the clinic's own moves: no notice
  });
});

describe('cancelled and confirmed (review R11, NTF-03)', () => {
  it('a cancellation tells the patient once, with the number to book again, never the clinic\'s reason', () => {
    const m = cancelledMessages({ ...base, status: 'cancelled', clinic_phone: '+20225550000' }, now);
    expect(m.map((x) => x.dedupe)).toEqual(['cancelled:a1']);
    expect(m[0]).toMatchObject({ event: 'appointment.cancelled', recipient: 'omar@example.test' });
    expect(m[0].subject).toContain('تم إلغاء موعدك');
    expect(m[0].body).toContain('+20225550000');
  });
  it('the patient\'s own cancellation: confirmed to them with the site to book again, and the clinic is told', () => {
    const m = cancelledMessages({ ...base, status: 'cancelled', site_url: 'https://clinic-a.example.test', clinic_phone: '+20225550000' }, now, 'patient');
    expect(m.map((x) => x.dedupe)).toEqual(['cancelled:a1', 'cancelled:a1:clinic']);
    expect(m[0].body).toContain('بناءً على طلبك');
    expect(m[0].body).toContain('https://clinic-a.example.test');
    expect(m[1]).toMatchObject({ recipient: 'clinic@example.test' });
    expect(m[1].body).toContain('+201011111111'); // who cancelled, so reception can call them
    expect(cancelledMessages({ ...base, patient_email: null }, now, 'patient').map((x) => x.dedupe)).toEqual(['cancelled:a1:clinic']);
  });
  it('no phone on file: no "call us" line; no email: nothing', () => {
    expect(cancelledMessages({ ...base, clinic_phone: null }, now)[0].body).not.toContain('اتصل');
    expect(cancelledMessages({ ...base, patient_email: null }, now)).toEqual([]);
  });
  it('a visit already past is not "cancelled" by email (reception tidying old bookings)', () => {
    expect(cancelledMessages(base, new Date('2026-10-25T00:00:00Z').getTime())).toEqual([]);
  });
  it('a confirmation goes out only for an appointment still ahead', () => {
    expect(confirmedMessages(base, now, 9).map((x) => x.dedupe)).toEqual(['confirmed:a1:c9']);
    expect(confirmedMessages(base, now, 10)[0].dedupe).not.toBe('confirmed:a1:c9'); // confirmed again after a move: told again (Phase 2E)
    expect(confirmedMessages(base, new Date('2026-10-25T00:00:00Z').getTime())).toEqual([]);
    expect(confirmedMessages({ ...base, patient_email: null }, now)).toEqual([]);
  });
});
