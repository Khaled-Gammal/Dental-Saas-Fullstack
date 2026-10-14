-- Tenant isolation through row-level security (SRS NFR-01)
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;

SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SELECT test.ok((SELECT count(*) FROM patients) = 1, 'clinic B sees only its own patient');
SELECT test.ok((SELECT count(*) FROM tenants) = 1, 'clinic B sees only its own tenant row');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM services WHERE tenant_id = '11111111-1111-1111-1111-111111111111'), 'clinic B cannot read clinic A services');
SELECT test.throws($$INSERT INTO patients (tenant_id, file_no, full_name, phone)
  VALUES ('11111111-1111-1111-1111-111111111111', 99, 'X', '+201000000999')$$, 'row-level security', 'clinic B cannot insert into clinic A');
DO $$ DECLARE n int; BEGIN
  UPDATE patients SET notes = 'x' WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM test.ok(n = 0, 'clinic B cannot update clinic A rows');
END $$;
SELECT test.throws($$UPDATE tenants SET status = 'active'$$, 'permission denied', 'app role cannot change its own subscription status');

SET LOCAL app.tenant_id = '';
SELECT test.ok((SELECT count(*) FROM patients) = 0, 'no tenant set: zero clinic rows visible');
SELECT test.lives($$INSERT INTO outbox_events (tenant_id, type, payload) VALUES (NULL, 'platform.test', '{}')$$,
  'platform-level outbox event can be written without a tenant');

-- lookups that run before a tenant is known
SELECT test.ok((SELECT count(*) FROM memberships_for_user('b0000000-0000-0000-0000-0000000000a2')) = 1, 'login lists the receptionist''s clinic');
SELECT test.ok(resolve_tenant_by_host('clinic-a.lvh.me') = '11111111-1111-1111-1111-111111111111', 'website host resolves to clinic A');
SELECT test.ok(resolve_tenant_by_host('unknown.lvh.me') IS NULL, 'unknown host resolves to nothing');
ROLLBACK;

-- a pending domain claim cannot squat a live hostname
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SELECT test.lives($$INSERT INTO domains (tenant_id, hostname, type, status) VALUES ('22222222-2222-2222-2222-222222222222','clinic-a.lvh.me','custom','pending')$$,
  'pending claim of another clinic''s hostname is allowed but inert');
SELECT test.throws($$UPDATE domains SET status = 'verified' WHERE hostname = 'clinic-a.lvh.me'$$, 'domains_live_hostname',
  'it can never become verified while the real owner holds it');
ROLLBACK;

-- Review fixes: RLS policies use the tenant_id index; API role cannot touch platform data
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL enable_seqscan = off;  -- with tiny seed tables, force the planner to show whether an index is usable
DO $$ DECLARE r record; plan text := ''; BEGIN
  FOR r IN EXPLAIN SELECT id FROM services LOOP plan := plan || r."QUERY PLAN" || ' '; END LOOP;
  PERFORM test.ok(plan NOT LIKE '%Seq Scan%', 'RLS filter on services can use the tenant_id index');
END $$;
SELECT test.throws($$UPDATE plans SET price_monthly_minor = 0$$, 'permission denied', 'API role cannot change plan prices');
SELECT test.throws($$UPDATE users SET platform_role = 'super_admin'$$, 'permission denied', 'API role cannot make anyone a super admin');
SELECT test.throws($$INSERT INTO users (email, full_name, platform_role) VALUES ('x@y.z','x','super_admin')$$, 'permission denied',
  'API role cannot create a super admin');
ROLLBACK;

BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '';
SELECT test.lives($$INSERT INTO outbox_events (tenant_id, type, payload) VALUES (NULL, 'platform.check', '{}')$$,
  'platform event still writable with no clinic set');
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SELECT test.ok((SELECT count(*) FROM outbox_events WHERE tenant_id IS NULL) = 0, 'clinics cannot read platform events');
ROLLBACK;
