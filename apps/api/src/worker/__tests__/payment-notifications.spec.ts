import { paymentMessages, type PaymentRow } from '../payment-notifications';

const base: PaymentRow = {
  id: 'pay1', tenant_id: 't1', status: 'succeeded', amount_minor: 125050, currency: 'EGP', method: 'cash', paid_at: new Date('2026-10-24T14:00:00Z'),
  patient_id: 'p1', patient_name: 'عمر', patient_email: 'omar@example.test', invoice_number: 'SMA-2026-00012', balance_minor: 30000,
  clinic_ar: 'عيادة الابتسامة', clinic_en: null, tz: 'Africa/Cairo',
};

describe('payment receipt email (review R11, NTF-03)', () => {
  it('names the amount, the method, the invoice and what is left', () => {
    const [m] = paymentMessages(base);
    expect(m).toMatchObject({ recipient: 'omar@example.test', dedupe: 'payment:pay1' });
    expect(m.subject).toBe('إيصال دفع – عيادة الابتسامة');
    expect(m.body).toContain('1,250.50 ج.م (نقدًا)');
    expect(m.body).toContain('SMA-2026-00012');
    expect(m.body).toContain('المتبقي على الفاتورة: 300 ج.م');
    expect(m.body).not.toMatch(/[٠-٩]/); // Latin digits (CLR-08)
  });
  it('a fully paid invoice says so', () => {
    expect(paymentMessages({ ...base, balance_minor: 0 })[0].body).toContain('تم سداد الفاتورة بالكامل');
  });
  it('nothing without an email, or for a payment reversed before the worker ran', () => {
    expect(paymentMessages({ ...base, patient_email: null })).toEqual([]);
    expect(paymentMessages({ ...base, status: 'reversed' })).toEqual([]);
  });
});
