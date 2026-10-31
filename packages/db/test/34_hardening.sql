-- Review R11 (defence in depth): what the API role can no longer do even with a SQL injection
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';

-- the hard-delete switch is ignored for the API role: the guards and the audit triggers stay on
INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency)
VALUES ('1b000000-0000-0000-0000-000000000099','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
        '70000000-0000-0000-0000-0000000000a1','EGP');
INSERT INTO invoice_items (tenant_id, invoice_id, description, unit_price_minor, line_total_minor)
VALUES ('11111111-1111-1111-1111-111111111111','1b000000-0000-0000-0000-000000000099','Check-up', 30000, 30000);
UPDATE invoices SET status = 'issued', number = 'SMA-2099-9' WHERE id = '1b000000-0000-0000-0000-000000000099';
SET LOCAL app.allow_hard_delete = 'on';
SELECT test.ok(NOT hard_delete_allowed(), 'the API role cannot switch the guards off');
SELECT test.throws($$DELETE FROM invoices WHERE id = '1b000000-0000-0000-0000-000000000099'$$, 'void it instead',
  'an issued invoice stays, whatever the session says');
SET LOCAL app.allow_hard_delete = '';

-- DELETE only where the API deletes (drafts, schedules, links)
SELECT test.throws($$DELETE FROM tenants$$, 'permission denied', 'no DELETE on tenants');
SELECT test.throws($$DELETE FROM patients$$, 'permission denied', 'no DELETE on patients');
SELECT test.throws($$DELETE FROM appointments$$, 'permission denied', 'no DELETE on appointments');
SELECT test.throws($$DELETE FROM domains$$, 'permission denied', 'no DELETE on domains');
SELECT test.throws($$UPDATE domains SET status = 'active'$$, 'permission denied', 'nor marks a domain live');
SELECT test.lives($$DELETE FROM invoices WHERE status = 'draft' AND id = '00000000-0000-0000-0000-000000000000'$$, 'drafts are still deleted');

-- private columns and provider payloads
SELECT test.throws($$SELECT ip FROM legal_acceptances$$, 'permission denied', 'the IP an acceptance came from is hidden');
SELECT test.throws($$SELECT user_agent FROM legal_acceptances$$, 'permission denied', 'and the browser');
SELECT test.lives($$SELECT count(document_id) FROM legal_acceptances$$, 'which document was accepted is still read');
SELECT test.throws($$SELECT * FROM webhook_events$$, 'permission denied', 'provider payloads are the worker''s');
RESET ROLE;

-- every definer function searches pg_temp last
SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%pg_temp%')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')),
  'no SECURITY DEFINER function can be shadowed by a temp table');
-- and no guard reads the setting directly any more
SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'hard_delete_allowed'
     AND p.prosrc LIKE '%current_setting(''app.allow_hard_delete''%'), 'every guard asks hard_delete_allowed()');

-- the worker (BYPASSRLS) still erases clinics: it may switch the guards off
SET LOCAL ROLE app_worker;
SET LOCAL app.allow_hard_delete = 'on';
SELECT test.ok(hard_delete_allowed(), 'the worker may');
SET LOCAL app.allow_hard_delete = '';
RESET ROLE;
ROLLBACK;
