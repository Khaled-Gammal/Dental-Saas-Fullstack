-- Phase E3: expenses and the daily cash box (SRS EXP-001…004, CASH-001…004, CLR-03/04)
\set ON_ERROR_STOP 1
BEGIN;
SELECT test.ok((SELECT count(*) = 8 FROM expense_categories WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND key IS NOT NULL),
  'every clinic starts with the eight Arabic categories');
-- seeding again adopts a same-name category that has no key and leaves a renamed one alone (no duplicates)
UPDATE expense_categories SET name = 'إيجار العيادة' WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND key = 'rent';
UPDATE expense_categories SET key = NULL WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND key = 'supplies';
SELECT seed_expense_categories('11111111-1111-1111-1111-111111111111');
SELECT test.ok((SELECT count(*) = 8 AND count(*) FILTER (WHERE key IS NULL) = 0 AND bool_or(name = 'إيجار العيادة') AND NOT bool_or(name = 'إيجار')
  FROM expense_categories WHERE tenant_id = '11111111-1111-1111-1111-111111111111'), 'seeding the categories again is safe');
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-0000000000a2';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a2';
SELECT id AS supplies FROM expense_categories WHERE key = 'supplies' \gset
SELECT business_date(now(), '11111111-1111-1111-1111-111111111111') AS today \gset

-- the seed already moved money today on this branch, so the check measures what this test adds
SELECT (t->>'cash_in')::int AS base_in, (t->>'cash_refunds')::int AS base_ref, (t->>'cash_expenses')::int AS base_exp,
  coalesce((t->'payments'->>'card')::int, 0) AS base_card FROM cash_day_totals('d0000000-0000-0000-0000-0000000000a1', :'today') t \gset

-- expenses: method and reference, no future date, not edited, approved by someone else, voided not deleted
SELECT test.throws(format($$INSERT INTO expenses (tenant_id, branch_id, category_id, amount_minor, currency, spent_on, payment_method, created_by)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1', %L, 1000, 'EGP', %L::date + 1, 'cash', 'c0000000-0000-0000-0000-0000000000a2')$$, :'supplies', :'today'),
  'not dated in the future', 'an expense is not dated in the future');
SELECT test.throws(format($$INSERT INTO expenses (tenant_id, branch_id, category_id, amount_minor, currency, spent_on, payment_method, created_by)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1', %L, 1000, 'EGP', %L, 'wallet', 'c0000000-0000-0000-0000-0000000000a2')$$, :'supplies', :'today'),
  'expenses_reference_required', 'a wallet expense needs its reference');
INSERT INTO expenses (id, tenant_id, branch_id, category_id, amount_minor, currency, spent_on, payment_method, description, status, created_by)
VALUES ('5e000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1', :'supplies', 10000, 'EGP', :'today', 'cash', 'قفازات', 'pending', 'c0000000-0000-0000-0000-0000000000a2');
SELECT test.throws($$UPDATE expenses SET amount_minor = 9000 WHERE id = '5e000000-0000-0000-0000-000000000001'$$, 'not edited', 'a recorded expense is not edited');
SELECT test.throws($$UPDATE expenses SET status = 'approved', approved_by = 'c0000000-0000-0000-0000-0000000000a2', approved_at = now() WHERE id = '5e000000-0000-0000-0000-000000000001'$$,
  'expenses_self_approval', 'nobody approves their own expense');
UPDATE expenses SET status = 'approved', approved_by = 'c0000000-0000-0000-0000-0000000000a1', approved_at = now() WHERE id = '5e000000-0000-0000-0000-000000000001';
SELECT test.throws($$UPDATE expenses SET status = 'pending' WHERE id = '5e000000-0000-0000-0000-000000000001'$$, 'cannot go from', 'an approved expense does not go back');
SELECT test.throws($$DELETE FROM expenses WHERE id = '5e000000-0000-0000-0000-000000000001'$$, 'permission denied', 'expenses are not deleted');

-- the SRS example (CASH-002): opening 1000, a 500 cash and a 200 card payment, a 100 cash expense -> expected 1400, card 200 apart
INSERT INTO cash_sessions (id, tenant_id, branch_id, business_date, currency, opening_minor, opened_by)
VALUES ('6e000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1', :'today', 'EGP', 100000, 'c0000000-0000-0000-0000-0000000000a2');
SELECT test.throws(format($$INSERT INTO cash_sessions (tenant_id, branch_id, business_date, currency, opening_minor, opened_by)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1', %L, 'EGP', 0, 'c0000000-0000-0000-0000-0000000000a2')$$, :'today'),
  'cash_sessions_one_per_day', 'one cash session per branch per day');
INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency) VALUES
 ('1d000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','EGP');
INSERT INTO invoice_items (tenant_id, invoice_id, description, quantity, unit_price_minor, line_total_minor) VALUES
 ('11111111-1111-1111-1111-111111111111','1d000000-0000-0000-0000-000000000001','علاج', 1, 200000, 200000);
SELECT issue_invoice('1d000000-0000-0000-0000-000000000001');
INSERT INTO payments (id, tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at, received_by) VALUES
 ('2d000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  '1d000000-0000-0000-0000-000000000001', 50000, 'EGP', 'cash', now(), 'c0000000-0000-0000-0000-0000000000a2'),
 ('2d000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  '1d000000-0000-0000-0000-000000000001', 20000, 'EGP', 'card', now(), 'c0000000-0000-0000-0000-0000000000a2');
SELECT test.ok((SELECT (t->>'cash_in')::int - :base_in = 50000 AND (t->>'cash_expenses')::int - :base_exp = 10000
  AND (t->'payments'->>'card')::int - :base_card = 20000 AND (t->>'cash_refunds')::int = :base_ref
  AND 100000 + ((t->>'cash_in')::int - :base_in) - ((t->>'cash_refunds')::int - :base_ref) - ((t->>'cash_expenses')::int - :base_exp) = 140000
  FROM cash_day_totals('d0000000-0000-0000-0000-0000000000a1', :'today') t), 'expected cash 1400; the card 200 is listed apart (CASH-002 acceptance)');
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at, received_by) VALUES
  ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','1d000000-0000-0000-0000-000000000001',
   100, 'EGP', 'cash', now() + interval '1 day', 'c0000000-0000-0000-0000-0000000000a2')$$, 'not dated in the future', 'a payment is not dated in the future');
INSERT INTO expenses (id, tenant_id, branch_id, category_id, amount_minor, currency, spent_on, payment_method, status, created_by)
VALUES ('5e000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1', :'supplies', 2000, 'EGP', :'today', 'cash', 'pending', 'c0000000-0000-0000-0000-0000000000a2');

-- closing: a difference needs a note; then the day is closed to every movement (CLR-04)
SELECT test.throws($$UPDATE cash_sessions SET status = 'closed', counted_minor = 139000, expected_minor = 140000, closed_at = now(),
  closed_by = 'c0000000-0000-0000-0000-0000000000a2' WHERE id = '6e000000-0000-0000-0000-000000000001'$$, 'cash_sessions_difference_note', 'a difference needs a note');
UPDATE cash_sessions SET status = 'closed', counted_minor = 139000, expected_minor = 140000, closed_at = now(), note = 'نقص 10 جنيه في الفكة',
  closed_by = 'c0000000-0000-0000-0000-0000000000a2' WHERE id = '6e000000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT difference_minor = -1000 FROM cash_sessions WHERE id = '6e000000-0000-0000-0000-000000000001'), 'difference = counted − expected');
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at, received_by) VALUES
  ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','1d000000-0000-0000-0000-000000000001',
   100, 'EGP', 'cash', now(), 'c0000000-0000-0000-0000-0000000000a2')$$, 'is closed', 'no payment is dated into a closed day');
SELECT test.throws($$UPDATE payments SET status = 'reversed', reversed_at = now(), reversed_by = 'c0000000-0000-0000-0000-0000000000a2', reversal_reason = 'خطأ'
  WHERE id = '2d000000-0000-0000-0000-000000000001'$$, 'is closed', 'no reversal on a closed day');
SELECT test.throws($$INSERT INTO refunds (tenant_id, payment_id, amount_minor, reason, method) VALUES
  ('11111111-1111-1111-1111-111111111111','2d000000-0000-0000-0000-000000000002', 100, 'ارجاع', 'cash')$$, 'is closed', 'no refund on a closed day');
SELECT test.throws(format($$INSERT INTO expenses (tenant_id, branch_id, category_id, amount_minor, currency, spent_on, payment_method, created_by)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1', %L, 500, 'EGP', %L, 'cash', 'c0000000-0000-0000-0000-0000000000a2')$$, :'supplies', :'today'),
  'is closed', 'no expense on a closed day');
SELECT test.throws($$UPDATE expenses SET status = 'void', void_reason = 'خطأ', voided_at = now() WHERE id = '5e000000-0000-0000-0000-000000000001'$$,
  'is closed', 'no void that changes a closed day');
SELECT test.lives($$UPDATE expenses SET status = 'rejected', approved_by = 'c0000000-0000-0000-0000-0000000000a1', approved_at = now(), decision_note = 'بدون فاتورة'
  WHERE id = '5e000000-0000-0000-0000-000000000002'$$, 'the owner still decides on a closed day: the cash left the drawer either way');
SELECT test.throws($$UPDATE cash_sessions SET note = 'غير ذلك' WHERE id = '6e000000-0000-0000-0000-000000000001'$$, 'does not change', 'a closed session does not change');

-- reopening (CASH-004): only with its reason recorded, the earlier figures kept
SELECT test.throws($$UPDATE cash_sessions SET status = 'open', counted_minor = NULL, expected_minor = NULL, closed_at = NULL, closed_by = NULL
  WHERE id = '6e000000-0000-0000-0000-000000000001'$$, 'reason recorded', 'a session is reopened only with a reason');
INSERT INTO cash_session_reopenings (tenant_id, session_id, reason, previous_counted, previous_expected, previous_note, previous_closed_by, previous_closed_at, reopened_by)
SELECT tenant_id, id, 'وُجد إيصال لم يُسجل', counted_minor, expected_minor, note, closed_by, closed_at, 'c0000000-0000-0000-0000-0000000000a1'
FROM cash_sessions WHERE id = '6e000000-0000-0000-0000-000000000001';
UPDATE cash_sessions SET status = 'open', counted_minor = NULL, expected_minor = NULL, closed_at = NULL, closed_by = NULL, note = NULL, closing_totals = NULL
 WHERE id = '6e000000-0000-0000-0000-000000000001';
SELECT test.lives($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at, received_by) VALUES
  ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','1d000000-0000-0000-0000-000000000001',
   100, 'EGP', 'cash', now(), 'c0000000-0000-0000-0000-0000000000a2')$$, 'the reopened day takes payments again');
SELECT test.throws($$UPDATE cash_session_reopenings SET reason = 'x'$$, 'permission denied', 'the reopening history is not edited');
SELECT test.throws($$INSERT INTO cash_sessions (tenant_id, branch_id, business_date, currency, opening_minor, opened_by)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1', current_date - 1, 'EGP', 0, 'c0000000-0000-0000-0000-0000000000a2')$$,
  'cash_sessions_one_open_per_branch', 'one open session per branch');

-- another clinic sees none of it
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SELECT test.ok((SELECT count(*) FROM cash_sessions) + (SELECT count(*) FROM expenses) = 0, 'another clinic sees no cash sessions or expenses');
ROLLBACK;
