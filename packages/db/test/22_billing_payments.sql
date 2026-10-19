-- Phase E1: issuing, payments with reference, reversal, refunds, void, currency (SRS BILLING-*, PAY-001…003, PAY-005, CLR-05/09)
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-0000000000a2';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a2';

INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency) VALUES
 ('1e000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','EGP'),
 ('1e000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','EGP'),
 ('1e000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','EGP');
INSERT INTO invoice_items (tenant_id, invoice_id, description, quantity, unit_price_minor, line_total_minor) VALUES
 ('11111111-1111-1111-1111-111111111111','1e000000-0000-0000-0000-000000000001','حشو 36', 1, 100000, 100000),
 ('11111111-1111-1111-1111-111111111111','1e000000-0000-0000-0000-000000000002','تنظيف', 1, 25, 25);
SELECT test.throws($$INSERT INTO invoices (tenant_id, branch_id, patient_id, currency) VALUES
  ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','USD')$$,
  'clinic currency', 'an invoice is in the clinic currency (CLR-09)');

-- issuing: {prefix}-{year}-{sequence}, gap-free, the lock includes the number
SELECT test.throws($$SELECT issue_invoice('1e000000-0000-0000-0000-000000000003')$$, 'at least one line', 'an empty invoice is not issued');
SAVEPOINT before_issue;
SELECT issue_invoice('1e000000-0000-0000-0000-000000000001');
SELECT number AS issued_once FROM invoices WHERE id = '1e000000-0000-0000-0000-000000000001' \gset
ROLLBACK TO SAVEPOINT before_issue;
SELECT issue_invoice('1e000000-0000-0000-0000-000000000001');
SELECT test.ok((SELECT number = :'issued_once' FROM invoices WHERE id = '1e000000-0000-0000-0000-000000000001'),
  'a rolled-back issue gives its number back (no gap)');
SELECT test.ok((SELECT number ~ ('^SMA-' || to_char(now() AT TIME ZONE 'Africa/Cairo', 'YYYY') || '-[0-9]{5}$') AND issue_date IS NOT NULL AND status = 'issued'
  FROM invoices WHERE id = '1e000000-0000-0000-0000-000000000001'), 'the number is prefix-year-sequence and the date is set');
SELECT test.throws($$SELECT issue_invoice('1e000000-0000-0000-0000-000000000001')$$, 'already', 'an invoice is issued once');
SELECT test.throws($$UPDATE invoices SET number = 'X-1' WHERE id = '1e000000-0000-0000-0000-000000000001'$$, 'do not change', 'the number of an issued invoice is fixed');
SELECT test.throws($$UPDATE invoice_items SET unit_price_minor = 1, line_total_minor = 1 WHERE invoice_id = '1e000000-0000-0000-0000-000000000001'$$,
  'lines can only change on a draft', 'an issued line cannot be edited (BILLING-002 acceptance 2)');

-- tax from the settings, rounded half up (14 % of 0.25 = 0.035 -> 0.04)
UPDATE tenant_settings SET tax_rate_bp = 1400 WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
SELECT issue_invoice('1e000000-0000-0000-0000-000000000002');
SELECT test.ok((SELECT tax_minor = 4 AND total_minor = 29 FROM invoices WHERE id = '1e000000-0000-0000-0000-000000000002'), 'tax is computed on issue, half up');
SELECT test.ok((SELECT substring(a.number from '[0-9]+$')::int + 1 = substring(b.number from '[0-9]+$')::int
  FROM invoices a, invoices b WHERE a.id = '1e000000-0000-0000-0000-000000000001' AND b.id = '1e000000-0000-0000-0000-000000000002'),
  'consecutive issues get consecutive numbers');

-- payments: reference rules, no overpayment, partial then full (PAY-001, PAY-002)
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at, received_by) VALUES
  ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','1e000000-0000-0000-0000-000000000001',
   30000,'EGP','wallet',now(),'c0000000-0000-0000-0000-0000000000a2')$$, 'payments_reference_required', 'a wallet payment needs its reference');
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at, received_by) VALUES
  ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','1e000000-0000-0000-0000-000000000001',
   100001,'EGP','cash',now(),'c0000000-0000-0000-0000-0000000000a2')$$, 'invoices_check2', 'a payment cannot exceed the balance');
INSERT INTO payments (id, tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, reference, paid_at, received_by) VALUES
 ('2e000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  '1e000000-0000-0000-0000-000000000001', 30000,'EGP','instapay','IP-778899',now(),'c0000000-0000-0000-0000-0000000000a2');
SELECT test.ok((SELECT status = 'partially_paid' AND balance_minor = 70000 FROM invoices WHERE id = '1e000000-0000-0000-0000-000000000001'), '300 of 1000: partially paid');
INSERT INTO payments (id, tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at, received_by) VALUES
 ('2e000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  '1e000000-0000-0000-0000-000000000001', 70000,'EGP','card',now(),'c0000000-0000-0000-0000-0000000000a2');
SELECT test.ok((SELECT status = 'paid' AND balance_minor = 0 FROM invoices WHERE id = '1e000000-0000-0000-0000-000000000001'), 'then 700: paid');

-- reversal: entered in error, kept visible, the balance reopens (PAY-003, CLR-05)
SELECT test.throws($$UPDATE payments SET status = 'reversed', reversed_at = now(), reversed_by = 'c0000000-0000-0000-0000-0000000000a2' WHERE id = '2e000000-0000-0000-0000-000000000001'$$,
  'payments_reversal_complete', 'a reversal needs its reason');
UPDATE payments SET status = 'reversed', reversed_at = now(), reversed_by = 'c0000000-0000-0000-0000-0000000000a2', reversal_reason = 'سُجلت على الملف الخطأ'
 WHERE id = '2e000000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT status = 'partially_paid' AND balance_minor = 30000 FROM invoices WHERE id = '1e000000-0000-0000-0000-000000000001'), 'a reversed payment no longer counts');
SELECT test.throws($$UPDATE payments SET status = 'succeeded' WHERE id = '2e000000-0000-0000-0000-000000000001'$$, 'cannot change', 'a reversal is final');
SELECT test.throws($$UPDATE payments SET reversal_reason = 'غير ذلك' WHERE id = '2e000000-0000-0000-0000-000000000001'$$, 'only when reversing', 'its reason is kept');

-- refunds: method may differ (CLR-05), the branch is the payment's, totals capped, the balance reopens (PAY-005)
INSERT INTO refunds (tenant_id, payment_id, amount_minor, reason, method, created_by) VALUES
 ('11111111-1111-1111-1111-111111111111','2e000000-0000-0000-0000-000000000002', 20000, 'جزء من العلاج لم يتم', 'cash', 'c0000000-0000-0000-0000-0000000000a2');
SELECT test.ok((SELECT r.method = 'cash' AND r.branch_id = 'd0000000-0000-0000-0000-0000000000a1' FROM refunds r WHERE r.payment_id = '2e000000-0000-0000-0000-000000000002'),
  'a card payment can be refunded in cash; the refund belongs to the payment''s branch');
SELECT test.ok((SELECT p.status = 'partially_refunded' AND i.balance_minor = 50000 FROM payments p JOIN invoices i ON i.id = p.invoice_id
  WHERE p.id = '2e000000-0000-0000-0000-000000000002'), 'the refund reopens the balance');
SELECT test.throws($$INSERT INTO refunds (tenant_id, payment_id, amount_minor, reason, method) VALUES
  ('11111111-1111-1111-1111-111111111111','2e000000-0000-0000-0000-000000000002', 50001, 'x', 'cash')$$, 'exceed the payment', 'refunds never exceed the payment');
SELECT test.throws($$UPDATE payments SET status = 'reversed', reversed_at = now(), reversal_reason = 'خطأ' WHERE id = '2e000000-0000-0000-0000-000000000002'$$,
  'no refunds can be reversed', 'a refunded payment is not reversed');
SELECT test.throws($$INSERT INTO refunds (tenant_id, payment_id, amount_minor, reason, method) VALUES
  ('11111111-1111-1111-1111-111111111111','2e000000-0000-0000-0000-000000000001', 100, 'x', 'cash')$$, 'only a succeeded payment', 'a reversed payment is not refunded');

-- void: never with money on it (BILLING-003)
SELECT test.throws($$UPDATE invoices SET status = 'void', void_reason = 'خطأ في الإصدار' WHERE id = '1e000000-0000-0000-0000-000000000001'$$,
  'refund the', 'an invoice with money paid is not voided');
UPDATE invoices SET status = 'void', void_reason = 'خطأ في الإصدار', voided_at = now(), voided_by = 'c0000000-0000-0000-0000-0000000000a2'
 WHERE id = '1e000000-0000-0000-0000-000000000002';
SELECT test.ok((SELECT status = 'void' FROM invoices WHERE id = '1e000000-0000-0000-0000-000000000002'), 'an unpaid issued invoice is voided with a reason');
SELECT test.throws($$DELETE FROM invoices WHERE id = '1e000000-0000-0000-0000-000000000002'$$, 'void it instead', 'an issued invoice is never deleted');

-- currency (CLR-09): fixed once an invoice is issued
SELECT test.throws($$UPDATE tenants SET currency = 'USD' WHERE id = '11111111-1111-1111-1111-111111111111'$$, 'fixed once an invoice', 'the currency is locked after the first issued invoice');
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SELECT test.throws($$UPDATE tenants SET currency = 'eg1' WHERE id = '22222222-2222-2222-2222-222222222222'$$, 'tenants_currency_code', 'a currency is a 3-letter code');
SELECT test.lives($$UPDATE tenants SET currency = 'SAR' WHERE id = '22222222-2222-2222-2222-222222222222'$$, 'a clinic with no issued invoice may change its currency');
ROLLBACK;
