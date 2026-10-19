-- Phase C: branch-scoped access (SRS ACCESS-003). Hala (member a4) is a receptionist limited to the Maadi branch.
\set ON_ERROR_STOP 1
BEGIN;
-- fixtures as admin: one booking, invoice, item, payment and refund in each branch of clinic A
INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, status, source, booked_by) VALUES
 ('ae000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
  '70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a2','2031-04-01 18:00+02','2031-04-01 18:30+02','confirmed','phone','c0000000-0000-0000-0000-0000000000a2'),
 ('ae000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a2',
  '70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a2','2031-04-02 18:00+02','2031-04-02 18:30+02','confirmed','phone','c0000000-0000-0000-0000-0000000000a2');
-- a stale website hold of Dr Mona at Nasr City (expired 1 minute ago, not yet released)
INSERT INTO appointments (id, tenant_id, branch_id, doctor_id, starts_at, ends_at, source, status, hold_expires_at) VALUES
 ('ae000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-0000000000a2','2031-04-03 18:00+02','2031-04-03 18:30+02','website','held', now() - interval '1 minute');
INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency) VALUES
 ('1e000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','EGP'),
 ('1e000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a2','70000000-0000-0000-0000-0000000000a1','EGP');
INSERT INTO invoice_items (tenant_id, invoice_id, description, unit_price_minor, line_total_minor) VALUES
 ('11111111-1111-1111-1111-111111111111','1e000000-0000-0000-0000-0000000000a1','Nasr line', 10000, 10000),
 ('11111111-1111-1111-1111-111111111111','1e000000-0000-0000-0000-0000000000a2','Maadi line', 10000, 10000);
UPDATE invoices SET status = 'issued', number = 'SMA-E-' || right(id::text, 2) WHERE id IN ('1e000000-0000-0000-0000-0000000000a1','1e000000-0000-0000-0000-0000000000a2');
INSERT INTO payments (id, tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at) VALUES
 ('2e000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','1e000000-0000-0000-0000-0000000000a1', 5000,'EGP','cash',now()),
 ('2e000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a2','70000000-0000-0000-0000-0000000000a1','1e000000-0000-0000-0000-0000000000a2', 5000,'EGP','cash',now());
INSERT INTO refunds (tenant_id, payment_id, amount_minor, reason) VALUES
 ('11111111-1111-1111-1111-111111111111','2e000000-0000-0000-0000-0000000000a1', 1000, 'x'),
 ('11111111-1111-1111-1111-111111111111','2e000000-0000-0000-0000-0000000000a2', 1000, 'x');

SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a4';

SELECT test.ok(member_branch_ids() = ARRAY['d0000000-0000-0000-0000-0000000000a2']::uuid[], 'Hala works at Maadi only');
SELECT test.ok(branch_allowed('d0000000-0000-0000-0000-0000000000a2') AND NOT branch_allowed('d0000000-0000-0000-0000-0000000000a1'),
  'branch_allowed answers for the API');
SELECT test.ok((SELECT array_agg(id) FROM appointments WHERE id::text LIKE 'ae000000%') = ARRAY['ae000000-0000-0000-0000-0000000000a2']::uuid[],
  'she sees only the Maadi booking');
SELECT test.ok((SELECT count(*) = 1 FROM invoices WHERE id::text LIKE '1e000000%') AND (SELECT count(*) = 1 FROM invoice_items WHERE description LIKE '% line')
  AND (SELECT count(*) = 1 FROM payments WHERE id::text LIKE '2e000000%') AND (SELECT count(*) = 1 FROM refunds WHERE reason = 'x'),
  'invoices, their lines, payments and refunds follow the branch');
SELECT test.ok((SELECT count(*) FROM patients WHERE id IN ('70000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a2')) = 2,
  'patients stay clinic-wide (both registered at Nasr City, both visible)');
DO $$ DECLARE n int; BEGIN
  UPDATE appointments SET internal_notes = 'x' WHERE id = 'ae000000-0000-0000-0000-0000000000a1';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM test.ok(n = 0, 'she cannot change a Nasr City booking');
END $$;
SELECT test.throws($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, status, source, booked_by)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-0000000000a2','2031-04-05 18:00+02','2031-04-05 18:30+02','confirmed','phone','c0000000-0000-0000-0000-0000000000a4')$$,
  'row-level security', 'she cannot book at Nasr City');
SELECT test.throws($$UPDATE appointments SET branch_id = 'd0000000-0000-0000-0000-0000000000a1' WHERE id = 'ae000000-0000-0000-0000-0000000000a2'$$,
  'row-level security', 'she cannot move a Maadi booking into Nasr City');
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a2','70000000-0000-0000-0000-0000000000a1',
  '1e000000-0000-0000-0000-0000000000a1', 1000, 'EGP', 'cash', now())$$, 'not found', 'she cannot pay a Nasr City invoice, even booked at Maadi');
SELECT test.throws($$INSERT INTO invoice_items (tenant_id, invoice_id, description, unit_price_minor, line_total_minor)
  VALUES ('11111111-1111-1111-1111-111111111111','1e000000-0000-0000-0000-0000000000a1','x', 1, 1)$$,
  'row-level security', 'she cannot add a line to a Nasr City invoice');

-- slot search still sees the doctor's time in every branch (busy intervals only), and stale holds anywhere are freed
SELECT test.ok((SELECT count(*) = 2 FROM doctor_busy_intervals(ARRAY['f0000000-0000-0000-0000-0000000000a2']::uuid[], '2031-04-01', '2031-04-04')),
  'busy intervals of Dr Mona include her Nasr City booking (the stale hold does not count)');
SELECT test.ok(release_expired_holds('f0000000-0000-0000-0000-0000000000a2') = 1, 'a stale hold in another branch is released for her booking');

-- other members and contexts
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a2';
SELECT test.ok((SELECT count(*) FROM appointments WHERE id::text LIKE 'ae000000%') = 3, 'an all-branch receptionist sees every branch');
SET LOCAL app.member_id = '';
SELECT test.ok((SELECT count(*) FROM appointments WHERE id::text LIKE 'ae000000%') = 3, 'without a member (website, sign-in) there is no branch filter');
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000b1';
SELECT test.ok((SELECT count(*) FROM appointments) = 0 AND member_branch_ids() = ARRAY[]::uuid[],
  'a member id of another clinic sees nothing');
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a4';
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SELECT test.ok((SELECT count(*) FROM appointments) = 0, 'a member id never opens another clinic');
ROLLBACK;

-- a disabled member sees nothing at all
BEGIN;
UPDATE tenant_members SET status = 'disabled' WHERE id = 'c0000000-0000-0000-0000-0000000000a2';
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a2';
SELECT test.ok(member_branch_ids() = ARRAY[]::uuid[], 'a disabled member has no branches');
ROLLBACK;
