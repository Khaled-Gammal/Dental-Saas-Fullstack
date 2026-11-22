-- ARC-01, phase ARC-3 (migration 0079): the website's patient context reaches only what the public paths use. Run as a
-- real app_user login (dblink) entered through a signed hostname, exactly as TenantDb.runForHost does.
\set ON_ERROR_STOP 1

-- fixtures (committed: the second session must see them; the test database is rebuilt on every run)
SET app.tenant_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO files (id, tenant_id, bucket, object_key, mime_type, size_bytes, kind, is_private) VALUES
  ('45f00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'private', 'a/45/xray.png', 'image/png', 10, 'xray', true),
  ('45f00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'public', 'a/45/logo', 'image/webp', 10, 'logo', false);
INSERT INTO patient_medical_history (tenant_id, patient_id, allergies) VALUES ('11111111-1111-1111-1111-111111111111', '70000000-0000-0000-0000-0000000000a1', '{penicillin}')
  ON CONFLICT (patient_id) DO NOTHING;
INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency)
VALUES ('45c00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-0000000000a1', 'EGP');
-- a website booking with a follow-up and a plan item booked on it
INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, status, source)
VALUES ('45a00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1',
        '70000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000a1', '2032-02-01 18:00+02', '2032-02-01 18:30+02', 'pending', 'website');
INSERT INTO recalls (id, tenant_id, patient_id, reason, due_date, status, appointment_id)
VALUES ('45e00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '70000000-0000-0000-0000-0000000000a1', 'checkup', '2032-02-01', 'booked',
        '45a00000-0000-0000-0000-000000000001');
INSERT INTO treatment_plans (id, tenant_id, patient_id, doctor_id, title)
VALUES ('45d00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '70000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000a1', 'Plan 45');
INSERT INTO treatment_plan_items (id, tenant_id, plan_id, service_id, price_minor, status, appointment_id)
VALUES ('45d10000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '45d00000-0000-0000-0000-000000000001',
        '90000000-0000-0000-0000-0000000000a1', 30000, 'scheduled', '45a00000-0000-0000-0000-000000000001');
RESET app.tenant_id;

SELECT test.ok(NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity
  AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname LIKE 'patient\_scope%')),
  'every table under RLS says what the patient context may do (a new table without it fails here)');

SELECT dblink_connect('pat', 'host=127.0.0.1 port=' || current_setting('port') || ' dbname=' || current_database() || ' user=app_user password=app_user_dev');
CREATE OR REPLACE FUNCTION test.pat(p_sql text) RETURNS text LANGUAGE sql AS $$ SELECT v FROM dblink('pat', p_sql) AS t(v text) $$;

SELECT dblink_exec('pat', 'BEGIN');
SELECT test.ok(test.pat(test.host_sql('clinic-a.lvh.me')) = '11111111-1111-1111-1111-111111111111', 'the website context of clinic A (signed hostname)');

-- what the website shows and the booking uses
SELECT test.ok(test.pat($q$SELECT (count(*) > 0)::text FROM services$q$) = 'true'
  AND test.pat($q$SELECT (count(*) > 0)::text FROM doctors$q$) = 'true'
  AND test.pat($q$SELECT (count(*) > 0)::text FROM branches$q$) = 'true'
  AND test.pat($q$SELECT (count(*) > 0)::text FROM doctor_schedules$q$) = 'true', 'it reads the catalogue: services, doctors, branches, schedules');
SELECT test.ok(test.pat($q$SELECT count(*)::text FROM appointments WHERE id = '45a00000-0000-0000-0000-000000000001'$q$) = '1', 'it reads appointments (booking, self-service)');
SELECT test.ok(test.pat($q$SELECT (count(*) > 0)::text FROM patients$q$) = 'true', 'and patients (matching the booker)');
SELECT test.ok(test.pat($q$SELECT count(*)::text FROM files WHERE id = '45f00000-0000-0000-0000-000000000002'$q$) = '1', 'and the clinic''s logo file');

-- what it no longer reaches (each of these has rows in clinic A)
SELECT test.ok(test.pat($q$SELECT count(*)::text FROM files WHERE id = '45f00000-0000-0000-0000-000000000001'$q$) = '0', 'not an x-ray file');
SELECT test.ok(test.pat($q$SELECT count(*)::text FROM patient_medical_history$q$) = '0', 'not the medical history');
SELECT test.ok(test.pat($q$SELECT count(*)::text FROM invoices$q$) = '0', 'not invoices');
SELECT test.ok(test.pat($q$SELECT count(*)::text FROM recalls$q$) = '0', 'not recalls');
SELECT test.ok(test.pat($q$SELECT count(*)::text FROM treatment_plans$q$) = '0' AND test.pat($q$SELECT count(*)::text FROM treatment_plan_items$q$) = '0',
  'not treatment plans or their items');
SELECT test.ok(test.pat($q$SELECT count(*)::text FROM tenant_members$q$) = '0' AND test.pat($q$SELECT count(*)::text FROM roles$q$) = '0',
  'not the staff or their roles');
SELECT test.ok(test.pat($q$SELECT count(*)::text FROM audit_log$q$) = '0', 'not the audit trail');
SELECT test.ok(test.pat($q$SELECT count(*)::text FROM domains$q$) = '0' AND test.pat($q$SELECT count(*)::text FROM tenant_counters$q$) = '0',
  'not domains or counters');
SELECT test.ok(test.pat($q$SELECT (sum(n) = 0)::text FROM (SELECT count(*) AS n FROM visits UNION ALL SELECT count(*) FROM tooth_records
  UNION ALL SELECT count(*) FROM prescriptions UNION ALL SELECT count(*) FROM patient_files UNION ALL SELECT count(*) FROM payments
  UNION ALL SELECT count(*) FROM expenses UNION ALL SELECT count(*) FROM invitations UNION ALL SELECT count(*) FROM data_exports) x$q$) = 'true',
  'nor visits, the dental chart, prescriptions, patient files, payments, expenses, invitations or exports');

-- writes
SELECT dblink_exec('pat', 'SAVEPOINT w');
SELECT test.throws($q$SELECT test.pat($x$INSERT INTO invoices (tenant_id, branch_id, patient_id, currency) VALUES ('11111111-1111-1111-1111-111111111111',
  'd0000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-0000000000a1', 'EGP') RETURNING 'x'$x$)$q$, 'row-level security', 'it cannot write an invoice');
SELECT dblink_exec('pat', 'ROLLBACK TO SAVEPOINT w');
SELECT test.ok(test.pat($q$WITH u AS (UPDATE services SET price_minor = 1 WHERE tenant_id = '11111111-1111-1111-1111-111111111111' RETURNING 1) SELECT count(*)::text FROM u$q$) = '0',
  'nor change a price (the catalogue is read-only to it)');
SELECT dblink_exec('pat', 'SAVEPOINT s');
SELECT dblink_exec('pat', $q$INSERT INTO audit_log (tenant_id, actor_type, action, entity_type) VALUES ('11111111-1111-1111-1111-111111111111', 'patient', 'test.45', 'test')$q$);
SELECT dblink_exec('pat', $q$INSERT INTO outbox_events (tenant_id, type, payload) VALUES ('11111111-1111-1111-1111-111111111111', 'test.45', '{}')$q$);
SELECT test.ok(true, 'it adds to the audit trail and the outbox, as booking and self-service do');
SELECT test.ok(test.pat($q$INSERT INTO patients (tenant_id, file_no, full_name, phone) VALUES ('11111111-1111-1111-1111-111111111111', next_tenant_counter('patient_file'),
  'Website booker', '+201000004545') RETURNING (file_no > 0)::text$q$) = 'true', 'a new booker gets a file number (next_tenant_counter as definer)');
SELECT dblink_exec('pat', 'ROLLBACK TO SAVEPOINT s');

-- changing its own actor to escape the limits drops the clinic altogether
SELECT dblink_exec('pat', $q$DO $x$ BEGIN PERFORM set_config('app.actor_type', 'member', true); END $x$$q$);
SELECT test.ok(test.pat($q$SELECT count(*)::text FROM invoices$q$) = '0' AND test.pat($q$SELECT coalesce(current_tenant_id()::text, 'none')$q$) = 'none',
  'posing as staff to lift the limits leaves no clinic at all');
SELECT dblink_exec('pat', 'ROLLBACK');

-- a patient cancelling from their own link still reopens the follow-up and the plan item booked on it
SELECT dblink_exec('pat', 'BEGIN');
SELECT test.pat(test.host_sql('clinic-a.lvh.me')) IS NOT NULL AS entered \gset
SELECT dblink_exec('pat', $q$UPDATE appointments SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'patient', cancel_reason = 'cannot come'
  WHERE id = '45a00000-0000-0000-0000-000000000001'$q$);
SELECT dblink_exec('pat', 'COMMIT');
SELECT test.ok((SELECT status = 'pending' AND appointment_id IS NULL FROM recalls WHERE id = '45e00000-0000-0000-0000-000000000001'),
  'the cancelled booking''s recall is open again');
SELECT test.ok((SELECT status = 'planned' AND appointment_id IS NULL FROM treatment_plan_items WHERE id = '45d10000-0000-0000-0000-000000000001'),
  'and so is its plan item');

-- staff contexts are not affected
SELECT dblink_exec('pat', 'BEGIN');
SELECT dblink_exec('pat', test.enter_sql('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a1'));
SELECT test.ok(test.pat($q$SELECT count(*)::text FROM invoices WHERE id = '45c00000-0000-0000-0000-000000000001'$q$) = '1'
  AND test.pat($q$SELECT count(*)::text FROM files WHERE id = '45f00000-0000-0000-0000-000000000001'$q$) = '1'
  AND test.pat($q$SELECT (count(*) > 0)::text FROM tenant_members$q$) = 'true', 'the owner still sees invoices, x-rays and staff');
SELECT dblink_exec('pat', 'ROLLBACK');
SELECT dblink_disconnect('pat');
