-- Phase E4: reports (SRS REPORT-001…005). Acceptance: the totals equal the sum of the underlying records for the same
-- filters, and a branch-limited member never sees another branch's figures.
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-0000000000a1';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a1';
SELECT business_date(now(), '11111111-1111-1111-1111-111111111111') AS today \gset
SELECT (:'today'::date - 1)::text AS yesterday, (:'today'::date - 400)::text AS long_ago \gset
SELECT id AS supplies FROM expense_categories WHERE key = 'supplies' \gset

-- what today and yesterday already hold (the seed moves money today), so the checks measure what this test adds
CREATE TEMP TABLE base AS
SELECT d.day, m.kind, coalesce(m.method, '') AS method, coalesce(sum(m.amount), 0) AS amount
FROM (VALUES (:'today'::date), (:'yesterday'::date)) d(day) LEFT JOIN report_money(:'yesterday', :'today') m ON m.day = d.day
GROUP BY 1, 2, 3;
CREATE TEMP VIEW delta AS
SELECT g.day, g.kind, g.method, g.amount - coalesce((SELECT b.amount FROM base b WHERE b.day = g.day AND b.kind = g.kind AND b.method = g.method), 0) AS amount
FROM (SELECT m.day, m.kind, coalesce(m.method, '') AS method, sum(m.amount) AS amount FROM report_money(:'yesterday', :'today') m GROUP BY 1, 2, 3) g;

-- fixed data: an invoice of 2 000 at Nasr City, 500 cash + 200 card (one just after midnight, local time), 50 of
-- the cash refunded, 10 written off
INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency) VALUES
 ('1e000000-0000-0000-0000-00000000e401','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','EGP');
INSERT INTO invoice_items (tenant_id, invoice_id, description, quantity, unit_price_minor, line_total_minor) VALUES
 ('11111111-1111-1111-1111-111111111111','1e000000-0000-0000-0000-00000000e401','علاج', 1, 200000, 200000);
SELECT issue_invoice('1e000000-0000-0000-0000-00000000e401');
INSERT INTO payments (id, tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at, received_by) VALUES
 ('2e000000-0000-0000-0000-00000000e401','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  '1e000000-0000-0000-0000-00000000e401', 50000, 'EGP', 'cash', now(), 'c0000000-0000-0000-0000-0000000000a2'),
 ('2e000000-0000-0000-0000-00000000e402','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  '1e000000-0000-0000-0000-00000000e401', 20000, 'EGP', 'card', (:'today'::date + time '00:05') AT TIME ZONE clinic_timezone(), 'c0000000-0000-0000-0000-0000000000a2');
INSERT INTO refunds (tenant_id, payment_id, amount_minor, reason, method, created_by) VALUES
 ('11111111-1111-1111-1111-111111111111','2e000000-0000-0000-0000-00000000e401', 5000, 'جزء لم يتم', 'cash', 'c0000000-0000-0000-0000-0000000000a1');
INSERT INTO balance_adjustments (tenant_id, invoice_id, kind, amount_minor, reason, created_by) VALUES
 ('11111111-1111-1111-1111-111111111111','1e000000-0000-0000-0000-00000000e401','write_off', 1000, 'كسور', 'c0000000-0000-0000-0000-0000000000a1');

SELECT test.ok((SELECT amount FROM delta WHERE day = :'today' AND kind = 'invoiced') = 200000, 'REPORT-001: the issued invoice counts on its issue day');
SELECT test.ok((SELECT amount FROM delta WHERE day = :'today' AND kind = 'payment' AND method = 'cash') = 50000
  AND (SELECT amount FROM delta WHERE day = :'today' AND kind = 'payment' AND method = 'card') = 20000, 'REPORT-001: collections by method');
SELECT test.ok(coalesce((SELECT amount FROM delta WHERE day = :'yesterday' AND kind = 'payment' AND method = 'card'), 0) = 0,
  'a payment at 00:05 local time is on today, not on the UTC date before');
SELECT test.ok((SELECT amount FROM delta WHERE day = :'today' AND kind = 'refund' AND method = 'cash') = 5000
  AND (SELECT amount FROM delta WHERE day = :'today' AND kind = 'adjustment' AND method = 'write_off') = 1000, 'REPORT-001: refunds and write-offs');

-- a reversed payment (entered in error) leaves collections
UPDATE payments SET status = 'reversed', reversed_at = now(), reversed_by = 'c0000000-0000-0000-0000-0000000000a1', reversal_reason = 'خطأ في الإدخال'
WHERE id = '2e000000-0000-0000-0000-00000000e402';
SELECT test.ok(coalesce((SELECT amount FROM delta WHERE day = :'today' AND kind = 'payment' AND method = 'card'), 0) = 0, 'a reversed payment is not a collection');

-- totals equal the underlying records over a long period (independent sums of the same filters)
SELECT test.ok((SELECT sum(amount) FROM report_money(:'long_ago', :'today') WHERE kind = 'payment')
  = (SELECT sum(amount_minor) FROM payments WHERE status IN ('succeeded','partially_refunded','refunded') AND business_date(paid_at, tenant_id) BETWEEN :'long_ago' AND :'today'),
  'collections = the sum of the payments');
SELECT test.ok((SELECT sum(amount) FROM report_money(:'long_ago', :'today') WHERE kind = 'refund')
  = (SELECT sum(amount_minor) FROM refunds WHERE business_date(refunded_at, tenant_id) BETWEEN :'long_ago' AND :'today'), 'refunds = the sum of the refunds');
SELECT test.ok((SELECT sum(amount) FROM report_money(:'long_ago', :'today') WHERE kind = 'invoiced')
  = (SELECT sum(total_minor) FROM invoices WHERE status NOT IN ('draft','void') AND issue_date BETWEEN :'long_ago' AND :'today'), 'invoiced = the issued, not void invoices');

-- REPORT-002: approved and pending counted, rejected returned apart, void left out
INSERT INTO expenses (id, tenant_id, branch_id, category_id, amount_minor, currency, spent_on, payment_method, status, created_by) VALUES
 ('5e000000-0000-0000-0000-00000000e401','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1', :'supplies', 3000, 'EGP', :'yesterday', 'cash', 'approved', 'c0000000-0000-0000-0000-0000000000a1'),
 ('5e000000-0000-0000-0000-00000000e402','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1', :'supplies', 700, 'EGP', :'yesterday', 'cash', 'pending', 'c0000000-0000-0000-0000-0000000000a2');
UPDATE expenses SET status = 'void', voided_by = 'c0000000-0000-0000-0000-0000000000a1', voided_at = now(), void_reason = 'مكرر' WHERE id = '5e000000-0000-0000-0000-00000000e402';
SELECT test.ok((SELECT sum(amount) FROM report_expenses(:'long_ago', :'today'))
  = (SELECT sum(amount_minor) FROM expenses WHERE status <> 'void' AND spent_on BETWEEN :'long_ago' AND :'today'), 'expenses = the sum of the expenses that are not void');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM report_expenses(:'long_ago', :'today') WHERE status = 'void'), 'a voided expense is left out');

-- REPORT-003 / 005 on a fixed day a month ago: at Nasr City, Dr. Ahmed has one appointment of each outcome and a
-- lapsed website hold; at Maadi, Dr. Mona has one completed; Dr. Mona performed one procedure (1 200) at Nasr City
SELECT (:'today'::date - 30)::text AS fixed \gset
INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, status, booked_by,
  cancelled_at, cancelled_by, check_in_method, checked_in_at, check_in_note, hold_expires_at)
SELECT a.id::uuid, '11111111-1111-1111-1111-111111111111', a.branch::uuid, CASE WHEN a.status = 'expired' THEN NULL ELSE '70000000-0000-0000-0000-0000000000a1'::uuid END,
  a.doctor::uuid, (:'fixed'::date + a.at) AT TIME ZONE clinic_timezone(), (:'fixed'::date + a.at + interval '30 minutes') AT TIME ZONE clinic_timezone(),
  CASE WHEN a.status = 'expired' THEN 'website' ELSE 'phone' END, a.status,
  CASE WHEN a.status = 'expired' THEN NULL ELSE 'c0000000-0000-0000-0000-0000000000a2'::uuid END,
  CASE WHEN a.status = 'cancelled' THEN now() END, CASE WHEN a.status = 'cancelled' THEN 'clinic' END,
  CASE WHEN a.status = 'completed' THEN 'manual' END, CASE WHEN a.status = 'completed' THEN now() END, CASE WHEN a.status = 'completed' THEN 'حضر' END,
  CASE WHEN a.status = 'expired' THEN now() END
FROM (VALUES
  ('ad000000-0000-0000-0000-00000000e401', 'd0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000a1', time '10:00', 'completed'),
  ('ad000000-0000-0000-0000-00000000e402', 'd0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000a1', time '10:30', 'no_show'),
  ('ad000000-0000-0000-0000-00000000e403', 'd0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000a1', time '11:00', 'cancelled'),
  ('ad000000-0000-0000-0000-00000000e404', 'd0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000a1', time '11:30', 'confirmed'),
  ('ad000000-0000-0000-0000-00000000e405', 'd0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000a1', time '12:00', 'expired'),
  ('ad000000-0000-0000-0000-00000000e406', 'd0000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-0000000000a2', time '10:00', 'completed')
) a(id, branch, doctor, at, status);
INSERT INTO visits (id, tenant_id, patient_id, doctor_id, branch_id, visit_at) VALUES
 ('b4000000-0000-0000-0000-00000000e401','11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a2',
  'd0000000-0000-0000-0000-0000000000a1', (:'fixed'::date + time '13:00') AT TIME ZONE clinic_timezone());
INSERT INTO visit_procedures (tenant_id, visit_id, service_id, doctor_id, price_minor) VALUES
 ('11111111-1111-1111-1111-111111111111','b4000000-0000-0000-0000-00000000e401','90000000-0000-0000-0000-0000000000a3','f0000000-0000-0000-0000-0000000000a2', 120000);
SELECT test.ok((SELECT string_agg(status || '=' || n, ',' ORDER BY status) FROM report_attendance(:'fixed', :'fixed', 'd0000000-0000-0000-0000-0000000000a1'))
  = 'cancelled=1,completed=1,confirmed=1,no_show=1', 'REPORT-003: each outcome counted once; the lapsed hold is not an appointment');
SELECT test.ok((SELECT sum(n) FROM report_attendance(:'fixed', :'fixed', NULL, 'f0000000-0000-0000-0000-0000000000a2')) = 1, 'one doctor''s appointments only');
SELECT test.ok((SELECT (branch_id, doctor_id, amount, n) = ('d0000000-0000-0000-0000-0000000000a1'::uuid, 'f0000000-0000-0000-0000-0000000000a2'::uuid, 120000::bigint, 1::bigint)
  FROM report_procedures(:'fixed', :'fixed')), 'REPORT-005: the procedure counts at its visit''s branch and date, for the doctor who did it');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM report_procedures(:'fixed'::date - 1, :'fixed'::date - 1))
  AND NOT EXISTS (SELECT 1 FROM report_attendance(:'fixed'::date - 1, :'fixed'::date - 1)), 'nothing spills onto the day before');

-- counts and values equal the records over a long period; lapsed website holds are not appointments
SELECT test.ok((SELECT coalesce(sum(n), 0) FROM report_attendance(:'long_ago', :'today'::date + 60))
  = (SELECT count(*) FROM appointments a JOIN branches b ON b.id = a.branch_id WHERE a.status NOT IN ('held','expired')
       AND (a.starts_at AT TIME ZONE coalesce(b.timezone, clinic_timezone()))::date BETWEEN :'long_ago' AND :'today'::date + 60), 'attendance = the appointments in the period');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM report_attendance(:'long_ago', :'today'::date + 60) WHERE status IN ('held','expired')), 'holds are not counted');
SELECT test.ok((SELECT coalesce(sum(amount), 0) FROM report_procedures(:'long_ago', :'today'))
  = (SELECT coalesce(sum(vp.price_minor), 0) FROM visit_procedures vp JOIN visits v ON v.id = vp.visit_id JOIN branches b ON b.id = v.branch_id
       WHERE (v.visit_at AT TIME ZONE coalesce(b.timezone, clinic_timezone()))::date BETWEEN :'long_ago' AND :'today'), 'procedure value = the procedures performed');

-- REPORT-004: balances and overdue installments
SELECT test.ok((SELECT sum(balance) FROM report_outstanding()) = (SELECT sum(balance_minor) FROM invoices WHERE status IN ('issued','partially_paid')),
  'outstanding = the balances of the open invoices');
SELECT test.ok((SELECT balance FROM report_outstanding() WHERE patient_id = '70000000-0000-0000-0000-0000000000a1' AND branch_id = 'd0000000-0000-0000-0000-0000000000a1')
  >= 200000 - 50000 + 5000 - 1000, 'the new invoice''s balance (2 000 − 500 + 50 − 10) is owed');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM report_overdue_installments() WHERE due_date >= :'today' OR days_overdue < 1 OR remaining <= 0),
  'overdue = unpaid after the due date, with days overdue and what remains');

-- a branch-limited member (Maadi only) never sees another branch's figures
CREATE TEMP TABLE maadi_by_owner AS
SELECT (SELECT coalesce(sum(amount), 0) FROM report_money(:'long_ago', :'today', 'd0000000-0000-0000-0000-0000000000a2') WHERE kind = 'payment') AS paid,
       (SELECT coalesce(sum(n), 0) FROM report_attendance(:'long_ago', :'today', 'd0000000-0000-0000-0000-0000000000a2')) AS booked;
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-0000000000a4';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a4';
SELECT test.ok(NOT EXISTS (SELECT 1 FROM report_money(:'long_ago', :'today') WHERE branch_id <> 'd0000000-0000-0000-0000-0000000000a2')
  AND NOT EXISTS (SELECT 1 FROM report_expenses(:'long_ago', :'today') WHERE branch_id <> 'd0000000-0000-0000-0000-0000000000a2')
  AND NOT EXISTS (SELECT 1 FROM report_attendance(:'long_ago', :'today') WHERE branch_id <> 'd0000000-0000-0000-0000-0000000000a2')
  AND NOT EXISTS (SELECT 1 FROM report_procedures(:'long_ago', :'today') WHERE branch_id <> 'd0000000-0000-0000-0000-0000000000a2')
  AND NOT EXISTS (SELECT 1 FROM report_outstanding() WHERE branch_id <> 'd0000000-0000-0000-0000-0000000000a2')
  AND NOT EXISTS (SELECT 1 FROM report_overdue_installments() WHERE branch_id <> 'd0000000-0000-0000-0000-0000000000a2'),
  'a Maadi-only member gets Maadi rows only, from every report');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM report_money(:'long_ago', :'today', 'd0000000-0000-0000-0000-0000000000a1')),
  'asking for Nasr City by name returns nothing');
SELECT test.ok((SELECT coalesce(sum(amount), 0) FROM report_money(:'long_ago', :'today') WHERE kind = 'payment') = (SELECT paid FROM maadi_by_owner)
  AND (SELECT coalesce(sum(n), 0) FROM report_attendance(:'long_ago', :'today')) = (SELECT booked FROM maadi_by_owner),
  'and they are the same Maadi figures the owner sees');

-- another clinic sees none of it
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-0000000000b1';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000b1';
SELECT test.ok(NOT EXISTS (SELECT 1 FROM report_money(:'long_ago', :'today') WHERE branch_id IN ('d0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a2'))
  AND NOT EXISTS (SELECT 1 FROM report_outstanding() WHERE patient_id = '70000000-0000-0000-0000-0000000000a1'), 'another clinic sees none of it');
ROLLBACK;
