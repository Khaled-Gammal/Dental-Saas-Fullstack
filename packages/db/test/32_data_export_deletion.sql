-- Phase H8: data export and clinic deletion (NFR-08) — the owner asks, 90 days to restore, then everything goes
\set ON_ERROR_STOP 1
BEGIN;

-- ---------- export requests ----------
SET LOCAL ROLE app_user;
SELECT set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true);
INSERT INTO data_exports (tenant_id, requested_by) VALUES ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-0000000000a1');
SELECT test.ok((SELECT status = 'queued' FROM data_exports), 'the API asks for an export');
SELECT test.throws($$INSERT INTO data_exports (tenant_id, requested_by) VALUES ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-0000000000a1')$$,
  'data_exports_one_open', 'one export in the making per clinic');
SELECT test.throws($$INSERT INTO data_exports (tenant_id, requested_by) VALUES ('22222222-2222-2222-2222-222222222222', 'b0000000-0000-0000-0000-0000000000a1')$$,
  'row-level security', 'never for another clinic');
SELECT test.throws($$UPDATE data_exports SET status = 'ready'$$, 'permission denied', 'only the worker finishes an export');
SELECT test.throws($$INSERT INTO data_exports (tenant_id, requested_by, status) VALUES ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-0000000000a1', 'ready')$$,
  'permission denied', 'nor sets its status');
SELECT set_config('app.tenant_id', '22222222-2222-2222-2222-222222222222', true);
SELECT test.ok(NOT EXISTS (SELECT 1 FROM data_exports), 'a clinic sees its own exports only');

-- ---------- the owner asks for deletion ----------
SELECT test.throws($$SELECT request_clinic_deletion('b0000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111')$$,
  'only the clinic owner', 'staff cannot delete the clinic');
SELECT test.throws($$SELECT request_clinic_deletion('b0000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111')$$,
  'only the clinic owner', 'nor the owner of another clinic');
SELECT test.ok(request_clinic_deletion('b0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111') > now() + interval '89 days',
  'the owner does: erased in 90 days');
SELECT test.ok((SELECT tenant_status = 'cancelled' FROM member_access_state('c0000000-0000-0000-0000-0000000000a2')),
  'the clinic is closed to its staff at once');
SELECT test.ok(resolve_tenant_by_host('clinic-a.lvh.me') IS NULL, 'and its website is offline');
SELECT test.throws($$SELECT request_clinic_deletion('b0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111')$$,
  'the clinic is cancelled', 'asked once');
SELECT test.ok((SELECT count(*) = 1 FROM platform_audit_log WHERE action = 'tenant.deletion_requested' AND actor_user_id IS NULL),
  'the request is in the platform audit log');

-- ---------- the platform admin restores it within the 90 days ----------
SELECT test.throws($$SELECT platform_restore_clinic('b0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111')$$,
  'not a platform admin', 'only a platform admin restores');
SELECT platform_restore_clinic('b0000000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111');
SELECT test.ok((SELECT tenant_status <> 'cancelled' FROM member_access_state('c0000000-0000-0000-0000-0000000000a2')), 'restored as it was');
SELECT test.ok(resolve_tenant_by_host('clinic-a.lvh.me') IS NOT NULL, 'website back');
SELECT test.throws($$SELECT platform_restore_clinic('b0000000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111')$$,
  'not waiting for deletion', 'a clinic that is not waiting for deletion is not restored');

-- ---------- 90 days later: the worker erases it ----------
SELECT request_clinic_deletion('b0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SELECT test.throws($$SELECT purge_clinic('11111111-1111-1111-1111-111111111111')$$, 'permission denied', 'the API cannot erase a clinic');
RESET ROLE;
CREATE TEMP TABLE before AS SELECT (SELECT count(*) FROM patients WHERE tenant_id = '22222222-2222-2222-2222-222222222222') AS patients_b;
GRANT SELECT ON before TO app_worker;
SET LOCAL ROLE app_worker;
SELECT test.ok(NOT EXISTS (SELECT 1 FROM clinics_due_for_purge()), 'nothing is due before the 90 days');
SELECT test.ok(NOT purge_clinic('11111111-1111-1111-1111-111111111111'), 'and purge refuses it');
RESET ROLE;
UPDATE tenants SET delete_after = now() - interval '1 minute' WHERE id = '11111111-1111-1111-1111-111111111111';
INSERT INTO files (id, tenant_id, bucket, object_key, mime_type, size_bytes, kind, variant_widths) VALUES
  ('f8000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'private',
   't/11111111-1111-1111-1111-111111111111/clinical/f8000000-0000-0000-0000-000000000001', 'image/jpeg', 100, 'xray', '{}'),
  ('f8000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'private',
   't/11111111-1111-1111-1111-111111111111/f8000000-0000-0000-0000-000000000002', 'image/webp', 100, 'image', '{320,640}');
UPDATE data_exports SET status = 'ready', object_key = 't/11111111-1111-1111-1111-111111111111/exports/x.zip', expires_at = now() + interval '7 days';
SET LOCAL ROLE app_worker;
SELECT test.ok((SELECT array_agg(c) = '{11111111-1111-1111-1111-111111111111}' FROM clinics_due_for_purge() c), 'due after 90 days');
SELECT test.ok((SELECT array_agg(k ORDER BY k) = ARRAY[
    't/11111111-1111-1111-1111-111111111111/clinical/f8000000-0000-0000-0000-000000000001',
    't/11111111-1111-1111-1111-111111111111/exports/x.zip',
    't/11111111-1111-1111-1111-111111111111/f8000000-0000-0000-0000-000000000002/320.webp',
    't/11111111-1111-1111-1111-111111111111/f8000000-0000-0000-0000-000000000002/640.webp']
  FROM clinic_object_keys('11111111-1111-1111-1111-111111111111') k),
  'its storage objects are listed for deletion: files as stored, images as their renditions, its exports');
SELECT test.ok(purge_clinic('11111111-1111-1111-1111-111111111111'), 'the clinic is erased');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM tenants WHERE id = '11111111-1111-1111-1111-111111111111'), 'the clinic is gone');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM patients WHERE tenant_id = '11111111-1111-1111-1111-111111111111')
           AND NOT EXISTS (SELECT 1 FROM invoices WHERE tenant_id = '11111111-1111-1111-1111-111111111111')
           AND NOT EXISTS (SELECT 1 FROM payments WHERE tenant_id = '11111111-1111-1111-1111-111111111111')
           AND NOT EXISTS (SELECT 1 FROM visits WHERE tenant_id = '11111111-1111-1111-1111-111111111111')
           AND NOT EXISTS (SELECT 1 FROM files WHERE tenant_id = '11111111-1111-1111-1111-111111111111')
           AND NOT EXISTS (SELECT 1 FROM audit_log WHERE tenant_id = '11111111-1111-1111-1111-111111111111')
           AND NOT EXISTS (SELECT 1 FROM data_exports WHERE tenant_id = '11111111-1111-1111-1111-111111111111'),
  'patients, visits, invoices, payments, files, its audit trail and exports are erased');
RESET ROLE;
CREATE FUNCTION pg_temp.rows_left(p_tenant uuid) RETURNS int LANGUAGE plpgsql AS $f$
DECLARE v_t text; v_n int; v_sum int := 0;
BEGIN
  FOR v_t IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
             WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE' LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = $1', v_t) INTO v_n USING p_tenant;
    v_sum := v_sum + v_n;
  END LOOP;
  RETURN v_sum;
END $f$;
SELECT test.ok(pg_temp.rows_left('11111111-1111-1111-1111-111111111111') = 0, 'not one row of the clinic is left, in any table');
SET LOCAL ROLE app_worker;
SELECT test.ok(NOT EXISTS (SELECT 1 FROM users WHERE email IN ('owner.a@demo.test', 'reception.a@demo.test', 'doctor.a@demo.test')),
  'accounts that belonged to this clinic alone are erased');
SELECT test.ok(EXISTS (SELECT 1 FROM users WHERE email = 'admin@demo.test') AND EXISTS (SELECT 1 FROM users WHERE email = 'owner.b@demo.test'),
  'other accounts stay');
SELECT test.ok((SELECT patients_b FROM before) = (SELECT count(*) FROM patients WHERE tenant_id = '22222222-2222-2222-2222-222222222222'),
  'another clinic is untouched');
SELECT test.ok((SELECT details->>'slug' = 'clinic-a' AND tenant_id IS NULL FROM platform_audit_log WHERE action = 'tenant.purged'),
  'the platform audit log keeps the erasure (by name, the link is gone)');
SELECT test.ok(coalesce(current_setting('app.allow_hard_delete', true), '') = '', 'the guards are back on after the erasure');
ROLLBACK;
