-- Billing integrity: invoices, payments, refunds, installments, payouts (SRS 6.6, 6.11)
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';

INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency, discount_minor)
VALUES ('1a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
        '70000000-0000-0000-0000-0000000000a1','EGP', 20000);
INSERT INTO invoice_items (tenant_id, invoice_id, description, quantity, unit_price_minor, line_total_minor)
VALUES ('11111111-1111-1111-1111-111111111111','1a000000-0000-0000-0000-000000000001','Composite filling', 2, 100000, 200000);
SELECT test.ok((SELECT subtotal_minor = 200000 AND total_minor = 180000 FROM invoices WHERE id = '1a000000-0000-0000-0000-000000000001'),
  'totals derived from lines (2 x 1000.00 - 200.00 discount)');
UPDATE invoices SET paid_minor = 999999, subtotal_minor = 1 WHERE id = '1a000000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT paid_minor = 0 AND subtotal_minor = 200000 FROM invoices WHERE id = '1a000000-0000-0000-0000-000000000001'),
  'direct writes to totals are ignored');
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  '1a000000-0000-0000-0000-000000000001', 1000, 'EGP', 'cash', now())$$, 'cannot pay a draft', 'a draft cannot be paid');

UPDATE invoices SET status = 'issued', number = 'SMA-2030-1', issue_date = current_date WHERE id = '1a000000-0000-0000-0000-000000000001';
SELECT test.throws($$UPDATE invoice_items SET quantity = 3, line_total_minor = 300000$$, 'only change on a draft', 'issued lines are locked');
SELECT test.throws($$UPDATE invoices SET status = 'draft' WHERE id = '1a000000-0000-0000-0000-000000000001'$$, 'cannot go back to draft', 'issued cannot return to draft');
SELECT test.throws($$UPDATE invoices SET discount_minor = 0 WHERE id = '1a000000-0000-0000-0000-000000000001'$$, 'is locked', 'discount locked after issue');
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  '1a000000-0000-0000-0000-000000000001', 1000, 'USD', 'cash', now())$$, 'differs from invoice currency', 'wrong currency rejected');
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a2',
  '1a000000-0000-0000-0000-000000000001', 1000, 'EGP', 'cash', now())$$, 'does not match the invoice patient', 'wrong patient rejected');

INSERT INTO payments (id, tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at)
VALUES ('2a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
        '70000000-0000-0000-0000-0000000000a1','1a000000-0000-0000-0000-000000000001', 80000, 'EGP', 'cash', now());
SELECT test.ok((SELECT status = 'partially_paid' AND balance_minor = 100000 FROM invoices WHERE id = '1a000000-0000-0000-0000-000000000001'),
  'partial cash payment -> partially_paid, 1000.00 left');
SELECT test.throws($$UPDATE invoices SET status = 'void', void_reason = 'x' WHERE id = '1a000000-0000-0000-0000-000000000001'$$,
  'before voiding', 'cannot void while money is paid');
SELECT test.throws($$DELETE FROM invoices WHERE id = '1a000000-0000-0000-0000-000000000001'$$, 'void it instead', 'issued invoice cannot be deleted');
INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at)
VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
        '1a000000-0000-0000-0000-000000000001', 100000, 'EGP', 'card', now());
SELECT test.ok((SELECT status = 'paid' AND balance_minor = 0 FROM invoices WHERE id = '1a000000-0000-0000-0000-000000000001'), 'second payment -> paid');
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  '1a000000-0000-0000-0000-000000000001', 1, 'EGP', 'cash', now())$$, 'invoices_check', 'overpayment rejected');

INSERT INTO refunds (tenant_id, payment_id, amount_minor, reason)
VALUES ('11111111-1111-1111-1111-111111111111','2a000000-0000-0000-0000-000000000001', 30000, 'partial refund');
SELECT test.ok((SELECT status = 'partially_refunded' AND refunded_minor = 30000 FROM payments WHERE id = '2a000000-0000-0000-0000-000000000001')
  AND (SELECT status = 'partially_paid' AND balance_minor = 30000 FROM invoices WHERE id = '1a000000-0000-0000-0000-000000000001'),
  'refund updates the payment and reopens the invoice balance');
SELECT test.throws($$INSERT INTO refunds (tenant_id, payment_id, amount_minor, reason)
  VALUES ('11111111-1111-1111-1111-111111111111','2a000000-0000-0000-0000-000000000001', 50001, 'x')$$, 'exceed the payment', 'refunds cannot exceed the payment');

INSERT INTO payments (id, tenant_id, branch_id, patient_id, amount_minor, currency, method, status, provider, provider_ref)
VALUES ('2a000000-0000-0000-0000-00000000000f','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
        '70000000-0000-0000-0000-0000000000a1', 5000, 'EGP', 'online', 'failed', 'paymob', 'failed-1');
SELECT test.throws($$INSERT INTO refunds (tenant_id, payment_id, amount_minor, reason)
  VALUES ('11111111-1111-1111-1111-111111111111','2a000000-0000-0000-0000-00000000000f', 5000, 'x')$$, 'only a succeeded payment', 'failed payment cannot be refunded');

-- zero-total invoice is paid as soon as it is issued
INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency, discount_minor)
VALUES ('1a000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
        '70000000-0000-0000-0000-0000000000a2','EGP', 30000);
INSERT INTO invoice_items (tenant_id, invoice_id, description, unit_price_minor, line_total_minor)
VALUES ('11111111-1111-1111-1111-111111111111','1a000000-0000-0000-0000-000000000002','Free check-up', 30000, 30000);
UPDATE invoices SET status = 'issued', number = 'SMA-2030-2' WHERE id = '1a000000-0000-0000-0000-000000000002';
SELECT test.ok((SELECT status = 'paid' FROM invoices WHERE id = '1a000000-0000-0000-0000-000000000002'), '100% discount invoice becomes paid');

-- a procedure is billed once, but can be re-billed after its invoice is voided
INSERT INTO visits (id, tenant_id, patient_id, doctor_id, branch_id)
VALUES ('3a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a1',
        'f0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1');
INSERT INTO visit_procedures (id, tenant_id, visit_id, service_id, doctor_id, price_minor, commission_bp)
VALUES ('4a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','3a000000-0000-0000-0000-000000000001',
        '90000000-0000-0000-0000-0000000000a3','f0000000-0000-0000-0000-0000000000a1', 100000, 1000);
SELECT test.ok((SELECT commission_minor = 10000 FROM visit_procedures WHERE id = '4a000000-0000-0000-0000-000000000001'),
  'commission frozen on the procedure (20% of 500.00)');
INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency) VALUES
 ('1a000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','EGP'),
 ('1a000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','EGP');
INSERT INTO invoice_items (tenant_id, invoice_id, visit_procedure_id, description, unit_price_minor, line_total_minor)
VALUES ('11111111-1111-1111-1111-111111111111','1a000000-0000-0000-0000-000000000003','4a000000-0000-0000-0000-000000000001','Filling', 50000, 50000);
SELECT test.throws($$INSERT INTO invoice_items (tenant_id, invoice_id, visit_procedure_id, description, unit_price_minor, line_total_minor)
  VALUES ('11111111-1111-1111-1111-111111111111','1a000000-0000-0000-0000-000000000004','4a000000-0000-0000-0000-000000000001','Filling', 50000, 50000)$$,
  'already billed', 'procedure cannot be billed twice');
UPDATE invoices SET status = 'void', void_reason = 'wrong patient' WHERE id = '1a000000-0000-0000-0000-000000000003';
SELECT test.lives($$INSERT INTO invoice_items (tenant_id, invoice_id, visit_procedure_id, description, unit_price_minor, line_total_minor)
  VALUES ('11111111-1111-1111-1111-111111111111','1a000000-0000-0000-0000-000000000004','4a000000-0000-0000-0000-000000000001','Filling', 50000, 50000)$$,
  'voided work can be re-billed');

-- payouts
INSERT INTO doctor_payouts (id, tenant_id, doctor_id, period_start, period_end, currency, amount_minor)
VALUES ('5a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-0000000000a1','2030-01-01','2030-01-31','EGP', 999999);
UPDATE visit_procedures SET payout_id = '5a000000-0000-0000-0000-000000000001' WHERE id = '4a000000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT amount_minor = 10000 FROM doctor_payouts WHERE id = '5a000000-0000-0000-0000-000000000001'), 'payout amount derived, typed value ignored');
SELECT test.throws($$INSERT INTO doctor_payouts (tenant_id, doctor_id, period_start, period_end, currency, amount_minor)
  VALUES ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-0000000000a1','2030-01-15','2030-02-15','EGP',0)$$,
  'doctor_payouts_no_overlap', 'payout periods cannot overlap');
INSERT INTO doctor_payouts (id, tenant_id, doctor_id, period_start, period_end, currency, amount_minor)
VALUES ('5a000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-0000000000a2','2030-01-01','2030-01-31','EGP', 0);
SELECT test.throws($$UPDATE visit_procedures SET payout_id = '5a000000-0000-0000-0000-000000000002' WHERE id = '4a000000-0000-0000-0000-000000000001'$$,
  'same doctor', 'procedure cannot join another doctor''s payout');
UPDATE doctor_payouts SET status = 'approved' WHERE id = '5a000000-0000-0000-0000-000000000001';
SELECT test.throws($$UPDATE visit_procedures SET commission_bp = 9000 WHERE id = '4a000000-0000-0000-0000-000000000001'$$, 'frozen',
  'commission frozen once the payout is approved');

-- installments
INSERT INTO payment_plans (id, tenant_id, patient_id, currency, total_minor, installments_count, start_date)
VALUES ('6a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a2','EGP', 400000, 2, current_date);
INSERT INTO installments (id, tenant_id, plan_id, seq, due_date, amount_minor) VALUES
 ('7a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','6a000000-0000-0000-0000-000000000001',1,current_date,200000),
 ('7a000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','6a000000-0000-0000-0000-000000000001',2,current_date + 30,200000);
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, installment_id, amount_minor, currency, method, paid_at)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a2',
  '7a000000-0000-0000-0000-000000000001', 100, 'USD', 'cash', now())$$, 'installment plan', 'USD cannot pay an EGP plan');
INSERT INTO payments (tenant_id, branch_id, patient_id, installment_id, amount_minor, currency, method, paid_at) VALUES
 ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a2','7a000000-0000-0000-0000-000000000001',200000,'EGP','cash',now()),
 ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a2','7a000000-0000-0000-0000-000000000002',150000,'EGP','cash',now());
SELECT test.ok((SELECT string_agg(status, ',' ORDER BY seq) = 'paid,partially_paid' FROM installments
  WHERE plan_id = '6a000000-0000-0000-0000-000000000001'), 'installment statuses follow their payments');
SELECT test.ok((SELECT status = 'active' FROM payment_plans WHERE id = '6a000000-0000-0000-0000-000000000001'), 'plan still active');
INSERT INTO payments (tenant_id, branch_id, patient_id, installment_id, amount_minor, currency, method, paid_at) VALUES
 ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a2','7a000000-0000-0000-0000-000000000002',50000,'EGP','cash',now());
SELECT test.ok((SELECT status = 'completed' FROM payment_plans WHERE id = '6a000000-0000-0000-0000-000000000001'), 'plan completed when all installments are paid');
ROLLBACK;
