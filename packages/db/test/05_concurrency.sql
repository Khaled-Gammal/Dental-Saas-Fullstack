-- Two receptionists at the same second: the second payment/refund waits for the first, then cannot overpay.
-- dblink opens a real second session. Fixtures are committed (the test database is rebuilt on every run).
\set ON_ERROR_STOP 1
SET app.tenant_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency)
VALUES ('cc000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','EGP');
INSERT INTO invoice_items (tenant_id, invoice_id, description, unit_price_minor, line_total_minor)
VALUES ('11111111-1111-1111-1111-111111111111','cc000000-0000-0000-0000-000000000001','Implant', 10000, 10000);
UPDATE invoices SET status = 'issued', number = 'SMA-CC-1' WHERE id = 'cc000000-0000-0000-0000-000000000001';
RESET app.tenant_id;

-- session 2 (receptionist B) takes 60.00 and keeps its transaction open
SELECT dblink_connect('other', 'host=127.0.0.1 port=5432 dbname=' || current_database() || ' user=app_user password=app_user_dev');
SELECT dblink_exec('other', 'BEGIN');
SELECT dblink_exec('other', $$SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111'$$);
SELECT dblink_exec('other', $$INSERT INTO payments (id, tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at)
  VALUES ('cc000000-0000-0000-0000-0000000000f1','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
  '70000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-000000000001', 6000, 'EGP', 'cash', now())$$);

-- session 1 (receptionist A) tries to take 60.00 at the same moment
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL lock_timeout = '500ms';
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  'cc000000-0000-0000-0000-000000000001', 6000, 'EGP', 'cash', now())$$, 'lock timeout', 'second payment waits for the first (invoice row locked)');
SELECT dblink_exec('other', 'COMMIT');
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  'cc000000-0000-0000-0000-000000000001', 6000, 'EGP', 'cash', now())$$, 'invoices_check', 'after the first commits, the second would overpay and is rejected');
SELECT test.ok((SELECT paid_minor = 6000 FROM invoices WHERE id = 'cc000000-0000-0000-0000-000000000001'), 'invoice shows exactly 60.00 paid');
COMMIT;

-- the same race on refunds
SELECT dblink_exec('other', 'BEGIN');
SELECT dblink_exec('other', $$SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111'$$);
SELECT dblink_exec('other', $$INSERT INTO refunds (tenant_id, payment_id, amount_minor, reason)
  VALUES ('11111111-1111-1111-1111-111111111111','cc000000-0000-0000-0000-0000000000f1', 4000, 'r1')$$);
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL lock_timeout = '500ms';
SELECT test.throws($$INSERT INTO refunds (tenant_id, payment_id, amount_minor, reason)
  VALUES ('11111111-1111-1111-1111-111111111111','cc000000-0000-0000-0000-0000000000f1', 4000, 'r2')$$, 'lock timeout', 'second refund waits for the first');
SELECT dblink_exec('other', 'COMMIT');
SELECT test.throws($$INSERT INTO refunds (tenant_id, payment_id, amount_minor, reason)
  VALUES ('11111111-1111-1111-1111-111111111111','cc000000-0000-0000-0000-0000000000f1', 4000, 'r2')$$, 'exceed the payment', 'then it would over-refund and is rejected');
SELECT test.ok((SELECT refunded_minor = 4000 FROM payments WHERE id = 'cc000000-0000-0000-0000-0000000000f1'), 'payment shows exactly 40.00 refunded');
COMMIT;
SELECT dblink_disconnect('other');
