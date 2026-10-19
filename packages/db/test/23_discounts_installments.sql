-- Phase E2: discounts (limits, approval), installment plans, waivers and write-offs (SRS DISC-*, PAY-004, PAY-006, CLR-02/12)
\set ON_ERROR_STOP 1
BEGIN;
-- CLR-02 starting limits on the seeded roles
SELECT test.ok((SELECT max_discount_bp = 1000 FROM roles WHERE id = 'a0000000-0000-0000-0000-0000000000a2')
  AND (SELECT max_discount_bp = 2000 FROM roles WHERE id = 'a0000000-0000-0000-0000-0000000000a4')
  AND (SELECT max_discount_bp = 0 FROM roles WHERE id = 'a0000000-0000-0000-0000-0000000000a3'), 'receptionists start at 10 %, accountants 20 %, others 0');

SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-0000000000a2';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a2';

INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency) VALUES
 ('1f000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','EGP'),
 ('1f000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','EGP'),
 ('1f000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a2','EGP');

-- percentages become amounts, half up; the line total follows (DISC-001)
INSERT INTO invoice_items (id, tenant_id, invoice_id, description, quantity, unit_price_minor, line_total_minor, discount_type, discount_bp, discount_reason) VALUES
 ('2f000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','1f000000-0000-0000-0000-000000000001','حشو', 1, 333, 0, 'percent', 1500, 'مريض دائم');
SELECT test.ok((SELECT discount_minor = 50 AND line_total_minor = 283 FROM invoice_items WHERE id = '2f000000-0000-0000-0000-000000000001'),
  '15 % of 3.33 is 0.4995, rounded half up to 0.50; the line total follows');
SELECT test.throws($$INSERT INTO invoice_items (tenant_id, invoice_id, description, quantity, unit_price_minor, line_total_minor, discount_minor) VALUES
  ('11111111-1111-1111-1111-111111111111','1f000000-0000-0000-0000-000000000001','تنظيف', 1, 1000, 900, 100)$$,
  'invoice_items_discount_reason', 'a discount needs its reason');
INSERT INTO invoice_items (tenant_id, invoice_id, description, quantity, unit_price_minor, line_total_minor) VALUES
 ('11111111-1111-1111-1111-111111111111','1f000000-0000-0000-0000-000000000001','تنظيف', 1, 1667, 0);
UPDATE invoices SET discount_type = 'percent', discount_bp = 1000, discount_reason = 'عرض الشهر' WHERE id = '1f000000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT subtotal_minor = 1950 AND discount_minor = 195 AND total_minor = 1755 FROM invoices WHERE id = '1f000000-0000-0000-0000-000000000001'),
  'an invoice percentage applies to the subtotal');
DELETE FROM invoice_items WHERE invoice_id = '1f000000-0000-0000-0000-000000000001' AND description = 'تنظيف';
SELECT test.ok((SELECT discount_minor = 28 FROM invoices WHERE id = '1f000000-0000-0000-0000-000000000001'), 'and follows the lines while it is a draft');

-- approval: a pending discount blocks issuing; nobody approves their own (DISC-003)
UPDATE invoices SET discount_status = 'pending', discount_requested_by = 'c0000000-0000-0000-0000-0000000000a2' WHERE id = '1f000000-0000-0000-0000-000000000001';
SELECT test.throws($$SELECT issue_invoice('1f000000-0000-0000-0000-000000000001')$$, 'is pending', 'a pending discount blocks issuing');
SELECT test.throws($$UPDATE invoices SET discount_status = 'approved', discount_decided_by = 'c0000000-0000-0000-0000-0000000000a2', discount_decided_at = now()
  WHERE id = '1f000000-0000-0000-0000-000000000001'$$, 'invoices_discount_self_approval', 'nobody approves their own discount');
UPDATE invoices SET discount_status = 'approved', discount_decided_by = 'c0000000-0000-0000-0000-0000000000a1', discount_decided_at = now() WHERE id = '1f000000-0000-0000-0000-000000000001';
SELECT issue_invoice('1f000000-0000-0000-0000-000000000001');
SELECT test.ok((SELECT status = 'issued' FROM invoices WHERE id = '1f000000-0000-0000-0000-000000000001'), 'an approved discount is issued');
SELECT test.throws($$UPDATE invoices SET discount_reason = 'غير ذلك' WHERE id = '1f000000-0000-0000-0000-000000000001'$$, 'is locked', 'the discount is locked once issued');

-- installment plans (PAY-004): 3000 in three monthly installments
INSERT INTO invoice_items (tenant_id, invoice_id, description, quantity, unit_price_minor, line_total_minor) VALUES
 ('11111111-1111-1111-1111-111111111111','1f000000-0000-0000-0000-000000000002','تقويم', 1, 300000, 300000);
SELECT issue_invoice('1f000000-0000-0000-0000-000000000002');
INSERT INTO payment_plans (id, tenant_id, patient_id, invoice_id, currency, total_minor, installments_count, start_date, created_by) VALUES
 ('3f000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a1','1f000000-0000-0000-0000-000000000002',
  'EGP', 300000, 3, current_date, 'c0000000-0000-0000-0000-0000000000a2');
INSERT INTO installments (id, tenant_id, plan_id, seq, due_date, amount_minor) VALUES
 ('4f000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','3f000000-0000-0000-0000-000000000001', 1, current_date, 100000),
 ('4f000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','3f000000-0000-0000-0000-000000000001', 2, current_date + 30, 100000),
 ('4f000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','3f000000-0000-0000-0000-000000000001', 3, current_date + 60, 100000);
SELECT test.lives($$SET CONSTRAINTS payment_plans_totals, installments_totals IMMEDIATE$$, 'a schedule that adds up is accepted');
SET CONSTRAINTS payment_plans_totals, installments_totals DEFERRED;
SELECT test.throws($$INSERT INTO payment_plans (tenant_id, patient_id, invoice_id, currency, total_minor, installments_count, start_date) VALUES
  ('11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a1','1f000000-0000-0000-0000-000000000002','EGP', 300000, 1, current_date)$$,
  'payment_plans_one_active_per_invoice', 'one active plan per invoice');
INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, installment_id, amount_minor, currency, method, paid_at, received_by) VALUES
 ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','1f000000-0000-0000-0000-000000000002',
  '4f000000-0000-0000-0000-000000000001', 100000, 'EGP', 'cash', now(), 'c0000000-0000-0000-0000-0000000000a2');
SELECT test.ok((SELECT status = 'paid' FROM installments WHERE id = '4f000000-0000-0000-0000-000000000001'), 'paying an installment pays it and its invoice');

-- waivers and write-offs (PAY-006, CLR-12): rows, never edits of money
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a1';
INSERT INTO balance_adjustments (tenant_id, invoice_id, installment_id, kind, amount_minor, reason, created_by) VALUES
 ('11111111-1111-1111-1111-111111111111','1f000000-0000-0000-0000-000000000002','4f000000-0000-0000-0000-000000000002','waiver', 1, 'ظروف خاصة', 'c0000000-0000-0000-0000-0000000000a1');
SELECT test.ok((SELECT status = 'waived' AND waived_reason = 'ظروف خاصة' FROM installments WHERE id = '4f000000-0000-0000-0000-000000000002'), 'the waived installment is marked waived');
SELECT test.ok((SELECT adjusted_minor = 100000 AND balance_minor = 100000 AND status = 'partially_paid' FROM invoices WHERE id = '1f000000-0000-0000-0000-000000000002'),
  'the waiver is its unpaid amount and lowers what is owed');
SELECT test.throws($$INSERT INTO balance_adjustments (tenant_id, invoice_id, installment_id, kind, amount_minor, reason, created_by) VALUES
  ('11111111-1111-1111-1111-111111111111','1f000000-0000-0000-0000-000000000002','4f000000-0000-0000-0000-000000000002','waiver', 1, 'مرة ثانية', 'c0000000-0000-0000-0000-0000000000a1')$$,
  'only an unpaid installment', 'an installment is waived once');
INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, installment_id, amount_minor, currency, method, paid_at, received_by) VALUES
 ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','1f000000-0000-0000-0000-000000000002',
  '4f000000-0000-0000-0000-000000000003', 100000, 'EGP', 'cash', now(), 'c0000000-0000-0000-0000-0000000000a2');
SELECT test.ok((SELECT p.status = 'completed' AND i.status = 'paid' FROM payment_plans p JOIN invoices i ON i.id = p.invoice_id
  WHERE p.id = '3f000000-0000-0000-0000-000000000001'), 'the plan completes and the invoice is settled');

INSERT INTO invoice_items (tenant_id, invoice_id, description, quantity, unit_price_minor, line_total_minor) VALUES
 ('11111111-1111-1111-1111-111111111111','1f000000-0000-0000-0000-000000000003','كشف', 1, 50000, 50000);
SELECT test.throws($$INSERT INTO balance_adjustments (tenant_id, invoice_id, kind, amount_minor, reason, created_by) VALUES
  ('11111111-1111-1111-1111-111111111111','1f000000-0000-0000-0000-000000000003','write_off', 100, 'بقية صغيرة', 'c0000000-0000-0000-0000-0000000000a1')$$,
  'only an open invoice', 'a draft is not written off');
SELECT issue_invoice('1f000000-0000-0000-0000-000000000003');
SELECT test.throws($$INSERT INTO balance_adjustments (tenant_id, invoice_id, kind, amount_minor, reason, created_by) VALUES
  ('11111111-1111-1111-1111-111111111111','1f000000-0000-0000-0000-000000000003','write_off', 50001, 'أكثر من اللازم', 'c0000000-0000-0000-0000-0000000000a1')$$,
  'more than what is owed', 'a write-off is at most the balance');
INSERT INTO balance_adjustments (tenant_id, invoice_id, kind, amount_minor, reason, created_by) VALUES
 ('11111111-1111-1111-1111-111111111111','1f000000-0000-0000-0000-000000000003','write_off', 50000, 'حالة إنسانية', 'c0000000-0000-0000-0000-0000000000a1');
SELECT test.ok((SELECT status = 'paid' AND balance_minor = 0 AND paid_minor = 0 FROM invoices WHERE id = '1f000000-0000-0000-0000-000000000003'),
  'a full write-off settles the invoice with no money received');
SELECT test.throws($$UPDATE invoices SET status = 'void', void_reason = 'خطأ' WHERE id = '1f000000-0000-0000-0000-000000000003'$$, 'before voiding', 'an adjusted invoice is not voided');
SELECT test.throws($$UPDATE balance_adjustments SET amount_minor = 1$$, 'permission denied', 'adjustments are not edited');
SELECT test.throws($$DELETE FROM balance_adjustments$$, 'permission denied', 'adjustments are not deleted');
SELECT test.ok((SELECT count(*) = 2 FROM audit_log WHERE entity_type = 'balance_adjustment'), 'each adjustment is audited');
ROLLBACK;
