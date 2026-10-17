-- Phase C: recorded money cannot change silently; related records must agree (SRS PAY-003, SEC-101, SEC-102, APPT-002)
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';

-- an issued invoice of 1000.00 at Nasr City with one 400.00 cash payment
INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency)
VALUES ('1c000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
        '70000000-0000-0000-0000-0000000000a1','EGP');
INSERT INTO invoice_items (tenant_id, invoice_id, description, unit_price_minor, line_total_minor)
VALUES ('11111111-1111-1111-1111-111111111111','1c000000-0000-0000-0000-000000000001','Crown', 100000, 100000);
UPDATE invoices SET status = 'issued', number = 'SMA-C-1' WHERE id = '1c000000-0000-0000-0000-000000000001';
INSERT INTO payments (id, tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at, received_by)
VALUES ('2c000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
        '70000000-0000-0000-0000-0000000000a1','1c000000-0000-0000-0000-000000000001', 40000, 'EGP', 'cash', now(),
        'c0000000-0000-0000-0000-0000000000a2');

-- payments are facts
SELECT test.throws($$UPDATE payments SET amount_minor = 1 WHERE id = '2c000000-0000-0000-0000-000000000001'$$,
  'cannot be changed', 'a recorded payment amount cannot be changed');
SELECT test.throws($$UPDATE payments SET method = 'card' WHERE id = '2c000000-0000-0000-0000-000000000001'$$,
  'cannot be changed', 'a recorded payment method cannot be changed');
SELECT test.throws($$UPDATE payments SET received_by = 'c0000000-0000-0000-0000-0000000000a1' WHERE id = '2c000000-0000-0000-0000-000000000001'$$,
  'cannot be changed', 'who received a payment cannot be changed');
SELECT test.throws($$DELETE FROM payments WHERE id = '2c000000-0000-0000-0000-000000000001'$$,
  'cannot be deleted', 'a payment cannot be deleted');
SELECT test.throws($$UPDATE payments SET status = 'pending' WHERE id = '2c000000-0000-0000-0000-000000000001'$$,
  'cannot go from', 'a succeeded payment cannot go back to pending');
SELECT test.lives($$UPDATE payments SET notes = 'paid by the father' WHERE id = '2c000000-0000-0000-0000-000000000001'$$,
  'a note can still be added (it is audited)');

-- a refund still flows through: payment refunded amount and invoice balance follow
INSERT INTO refunds (id, tenant_id, payment_id, amount_minor, reason)
VALUES ('3c000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','2c000000-0000-0000-0000-000000000001', 10000, 'overcharged');
SELECT test.ok((SELECT status = 'partially_refunded' AND refunded_minor = 10000 FROM payments WHERE id = '2c000000-0000-0000-0000-000000000001')
  AND (SELECT balance_minor = 70000 FROM invoices WHERE id = '1c000000-0000-0000-0000-000000000001'),
  'a refund still updates the payment and the invoice balance');
SELECT test.throws($$UPDATE refunds SET amount_minor = 1$$, 'permission denied', 'refunds cannot be edited');
SELECT test.throws($$DELETE FROM refunds$$, 'permission denied', 'refunds cannot be deleted');

-- payment branch = invoice branch
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a2','70000000-0000-0000-0000-0000000000a1',
  '1c000000-0000-0000-0000-000000000001', 1000, 'EGP', 'cash', now())$$, 'branch does not match', 'payment branch must be the invoice branch');

-- responsible staff is a real member of the clinic
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at, received_by)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  '1c000000-0000-0000-0000-000000000001', 1000, 'EGP', 'cash', now(), 'c0000000-0000-0000-0000-0000000000b1')$$,
  'payments_received_by_member_fk', 'the receiver must be a member of this clinic');

-- installment plans
SELECT test.throws($$INSERT INTO payment_plans (tenant_id, patient_id, invoice_id, currency, total_minor, installments_count, start_date)
  VALUES ('11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a1','1c000000-0000-0000-0000-000000000001','EGP', 99999, 2, current_date)$$,
  'differs from the invoice total', 'a plan total must equal its invoice total');
INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency)
VALUES ('1c000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
        '70000000-0000-0000-0000-0000000000a1','EGP');
SELECT test.throws($$INSERT INTO payment_plans (tenant_id, patient_id, invoice_id, currency, total_minor, installments_count, start_date)
  VALUES ('11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a1','1c000000-0000-0000-0000-000000000002','EGP', 1, 1, current_date)$$,
  'needs an issued invoice', 'a plan cannot be made on a draft invoice');

-- a plan that adds up: down 300 + 2 x 350 = the invoice's 1000
INSERT INTO payment_plans (id, tenant_id, patient_id, invoice_id, currency, total_minor, down_payment_minor, installments_count, start_date)
VALUES ('6c000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a1',
        '1c000000-0000-0000-0000-000000000001','EGP', 100000, 30000, 2, current_date);
INSERT INTO installments (id, tenant_id, plan_id, seq, due_date, amount_minor) VALUES
 ('7c000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','6c000000-0000-0000-0000-000000000001',1,current_date,35000),
 ('7c000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','6c000000-0000-0000-0000-000000000001',2,current_date + 30,35000);
SELECT test.lives($$SET CONSTRAINTS payment_plans_totals, installments_totals IMMEDIATE$$, 'a plan whose installments add up is accepted');
SET CONSTRAINTS payment_plans_totals, installments_totals DEFERRED;
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, installment_id, amount_minor, currency, method, paid_at)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  '7c000000-0000-0000-0000-000000000001', 1000, 'EGP', 'cash', now())$$, 'against its plan''s invoice',
  'an installment payment must carry the plan''s invoice');
SELECT test.lives($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, installment_id, amount_minor, currency, method, paid_at)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  '1c000000-0000-0000-0000-000000000001','7c000000-0000-0000-0000-000000000001', 35000, 'EGP', 'cash', now())$$,
  'paying an installment with its invoice is accepted');
SELECT test.ok((SELECT status = 'paid' FROM installments WHERE id = '7c000000-0000-0000-0000-000000000001')
  AND (SELECT paid_minor = 65000 FROM invoices WHERE id = '1c000000-0000-0000-0000-000000000001'),
  'the installment is paid and the same money counts on the invoice');

-- clinical records agree
INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, status, source, booked_by)
VALUES ('ac000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
        '70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a1','2031-02-01 18:00+02','2031-02-01 18:30+02',
        'confirmed','phone','c0000000-0000-0000-0000-0000000000a2');
SELECT test.throws($$INSERT INTO visits (tenant_id, appointment_id, patient_id, doctor_id, branch_id)
  VALUES ('11111111-1111-1111-1111-111111111111','ac000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-0000000000a2',
  'f0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1')$$, 'must match its appointment',
  'a visit cannot belong to another patient than its appointment');
SELECT test.lives($$INSERT INTO visits (id, tenant_id, appointment_id, patient_id, doctor_id, branch_id)
  VALUES ('5c000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','ac000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1')$$,
  'a visit that matches its appointment is accepted');

-- treatment plan estimate is derived from its items
INSERT INTO treatment_plans (id, tenant_id, patient_id, doctor_id, title, total_estimate_minor)
VALUES ('8c000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a2',
        'f0000000-0000-0000-0000-0000000000a1','Implant + crown', 999999);
INSERT INTO treatment_plan_items (id, tenant_id, plan_id, service_id, price_minor, discount_minor) VALUES
 ('9c000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','8c000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-0000000000a3', 100000, 0),
 ('9c000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','8c000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-0000000000a2', 50000, 10000);
SELECT test.ok((SELECT total_estimate_minor = 140000 FROM treatment_plans WHERE id = '8c000000-0000-0000-0000-000000000001'),
  'the plan estimate is the sum of its items (1000 + 500 - 100)');
UPDATE treatment_plans SET total_estimate_minor = 1 WHERE id = '8c000000-0000-0000-0000-000000000001';
UPDATE treatment_plan_items SET status = 'cancelled' WHERE id = '9c000000-0000-0000-0000-000000000002';
SELECT test.ok((SELECT total_estimate_minor = 100000 FROM treatment_plans WHERE id = '8c000000-0000-0000-0000-000000000001'),
  'a typed estimate is ignored; cancelled items do not count');
SELECT test.throws($$INSERT INTO visit_procedures (tenant_id, visit_id, service_id, doctor_id, plan_item_id, price_minor)
  VALUES ('11111111-1111-1111-1111-111111111111','5c000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-0000000000a3',
  'f0000000-0000-0000-0000-0000000000a1','9c000000-0000-0000-0000-000000000001', 100000)$$, 'belongs to another patient',
  'a procedure cannot complete another patient''s plan item');

-- bookings are for an active doctor of that branch (Dr Ahmed works at Nasr City only)
SELECT test.throws($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, status, source, booked_by)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a2','70000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-0000000000a1','2031-02-02 18:00+02','2031-02-02 18:30+02','confirmed','phone','c0000000-0000-0000-0000-0000000000a2')$$,
  'not active at this branch', 'a doctor cannot be booked at a branch they do not work at');
UPDATE doctors SET is_active = false WHERE id = 'f0000000-0000-0000-0000-0000000000a1';
SELECT test.throws($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, status, source, booked_by)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-0000000000a1','2031-02-03 18:00+02','2031-02-03 18:30+02','confirmed','phone','c0000000-0000-0000-0000-0000000000a2')$$,
  'not active at this branch', 'a deactivated doctor cannot be booked');
SELECT test.lives($$UPDATE appointments SET status = 'cancelled', cancelled_at = now() WHERE id = 'ac000000-0000-0000-0000-000000000001'$$,
  'existing bookings of a deactivated doctor can still change status');
ROLLBACK;

-- installments that do not add up are refused at commit (own transaction: the failed check stays queued)
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO payment_plans (id, tenant_id, patient_id, currency, total_minor, installments_count, start_date)
VALUES ('6c000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a2','EGP', 100000, 2, current_date);
INSERT INTO installments (tenant_id, plan_id, seq, due_date, amount_minor) VALUES
 ('11111111-1111-1111-1111-111111111111','6c000000-0000-0000-0000-000000000002',1,current_date,50000);
SELECT test.throws($$SET CONSTRAINTS installments_totals, payment_plans_totals IMMEDIATE$$, 'do not add up',
  'installments that do not add up to the plan total are refused');
ROLLBACK;
