-- Booking code check-in at reception (SRS BOOK-13..17)
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';

INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, status, payment_mode,
  quoted_price_minor, check_in_code_hash, check_in_code_expires_at) VALUES
 ('ac000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-0000000000a1', now() + interval '1 hour', now() + interval '90 minutes','website','confirmed','at_clinic',60000,'h-cash', now() + interval '8 hours'),
 ('ac000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a2',
  'f0000000-0000-0000-0000-0000000000a1', now() + interval '2 hours', now() + interval '150 minutes','website','confirmed','deposit',60000,'h-deposit', now() + interval '8 hours'),
 ('ac000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a2',
  'f0000000-0000-0000-0000-0000000000a1', now() + interval '3 hours', now() + interval '210 minutes','website','confirmed','at_clinic',60000,'h-expired', now() - interval '1 minute');
INSERT INTO payments (tenant_id, branch_id, patient_id, appointment_id, amount_minor, currency, method, provider, provider_ref, paid_at)
VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a2',
        'ac000000-0000-0000-0000-000000000002', 20000, 'EGP', 'online', 'paymob', 'dep-1', now());

SELECT test.throws($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, check_in_code_hash, check_in_code_expires_at)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-0000000000a2', now() + interval '5 hours', now() + interval '330 minutes','website','h-cash', now() + interval '8 hours')$$,
  'appointments_open_code', 'an open code is unique inside the clinic');
SELECT test.throws($$SELECT * FROM check_in_by_code('h-cash','d0000000-0000-0000-0000-0000000000a2', NULL)$$, 'not valid',
  'code rejected at another branch');
SELECT test.ok((SELECT amount_due_minor FROM check_in_by_code('h-cash','d0000000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-0000000000a2')) = 60000,
  'cash booking checks in with its code; 600.00 due');
SELECT test.throws($$SELECT * FROM check_in_by_code('h-cash','d0000000-0000-0000-0000-0000000000a1', NULL)$$, 'not valid', 'code cannot be used twice');
SELECT test.ok((SELECT amount_due_minor FROM check_in_by_code('h-deposit','d0000000-0000-0000-0000-0000000000a1', NULL, 'qr')) = 40000,
  'deposit booking via QR: 200.00 paid online, 400.00 due');
SELECT test.throws($$SELECT * FROM check_in_by_code('h-expired','d0000000-0000-0000-0000-0000000000a1', NULL)$$, 'not valid', 'expired code rejected');
SELECT test.throws($$UPDATE appointments SET status = 'checked_in', checked_in_at = now(), check_in_method = 'manual'
  WHERE id = 'ac000000-0000-0000-0000-000000000003'$$, 'check constraint', 'manual check-in needs a note');
SELECT test.lives($$UPDATE appointments SET status = 'checked_in', checked_in_at = now(), check_in_method = 'manual',
  check_in_note = 'Phone lost, national ID checked' WHERE id = 'ac000000-0000-0000-0000-000000000003'$$, 'manual check-in with a note');
SELECT test.lives($$INSERT INTO payments (tenant_id, branch_id, patient_id, appointment_id, amount_minor, currency, method, paid_at)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  'ac000000-0000-0000-0000-000000000001', 60000, 'EGP', 'cash', now())$$, 'reception records the cash');
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, appointment_id, amount_minor, currency, method, paid_at)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a2',
  'ac000000-0000-0000-0000-000000000001', 100, 'EGP', 'cash', now())$$, 'does not match the appointment patient', 'cash under the wrong patient is rejected');
ROLLBACK;
