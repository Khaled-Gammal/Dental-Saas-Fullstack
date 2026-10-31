-- migrate:up
-- Review R11 (defence in depth). Two gaps that a single SQL injection in the API would have turned into silent loss:
--
-- 1. The clinical and money guards (and the audit triggers) stand aside when app.allow_hard_delete = 'on', a setting
--    any role can change — the API role included. Now the setting counts only for a session that logged in as a role
--    that already bypasses RLS (app_worker, which runs purge_clinic(); a superuser), never while acting as app_user.
--    session_user, not current_user: the cascades of a purge run as the table owner, and definer functions change
--    current_user but never session_user. Every function that read the setting is rewritten to ask
--    hard_delete_allowed() instead (found by its text, so no guard is missed; checked at the end).
--
-- 2. app_user could DELETE from almost every table (0002 granted it on ALL TABLES, and by default on new ones), so the
--    guards were the only thing between it and tenants, payments or visits. It now keeps DELETE only on the tables the
--    API really deletes from (drafts, schedules, links); everything else is refused by privilege. Tables added later
--    get no DELETE for app_user unless their migration grants it.
CREATE OR REPLACE FUNCTION hard_delete_allowed() RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF coalesce(current_setting('app.allow_hard_delete', true), '') <> 'on' THEN RETURN false; END IF;
  RETURN current_user <> 'app_user'
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = session_user AND (r.rolsuper OR r.rolbypassrls));
END $$;
GRANT EXECUTE ON FUNCTION hard_delete_allowed() TO PUBLIC;

DO $$
DECLARE f record; v_def text; v_count int := 0;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
             AND p.prosrc LIKE '%current_setting(''app.allow_hard_delete'', true)%'
             AND p.proname <> 'hard_delete_allowed'
  LOOP
    v_def := pg_get_functiondef(f.oid);
    v_def := replace(v_def, 'coalesce(current_setting(''app.allow_hard_delete'', true), '''') <> ''on''', 'NOT public.hard_delete_allowed()');
    v_def := replace(v_def, 'coalesce(current_setting(''app.allow_hard_delete'', true), '''') = ''on''', 'public.hard_delete_allowed()');
    EXECUTE v_def;
    v_count := v_count + 1;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'hard_delete_allowed'
               AND p.prosrc LIKE '%current_setting(''app.allow_hard_delete''%') THEN
    RAISE EXCEPTION 'a guard still reads app.allow_hard_delete directly: %', (
      SELECT string_agg(p.proname, ', ') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'hard_delete_allowed'
        AND p.prosrc LIKE '%current_setting(''app.allow_hard_delete''%');
  END IF;
  RAISE NOTICE 'hard_delete_allowed(): % guard functions rewritten', v_count;
END $$;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.oid::regclass AS tbl FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
             AND c.relname NOT IN ('branch_hours', 'doctor_branches', 'doctor_schedules', 'doctor_services', 'doctor_time_off',
                                   'files', 'gallery_items', 'holidays', 'invoice_items', 'invoices', 'member_branches', 'roles',
                                   'services', 'treatment_plan_items', 'visit_procedures')
  LOOP
    EXECUTE format('REVOKE DELETE ON %s FROM app_user', t.tbl);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE DELETE ON TABLES FROM app_user;
-- domains are written by provision_tenant() at sign-up only; the API never changes one
REVOKE UPDATE ON domains FROM app_user;

-- migrate:down
GRANT UPDATE ON domains TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT DELETE ON TABLES TO app_user;
DO $$
DECLARE t record;
BEGIN
  -- back to what 0002 and the later migrations left: DELETE everywhere but the append-only tables
  FOR t IN SELECT c.oid::regclass AS tbl FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
             AND c.relname NOT IN ('audit_log', 'platform_audit_log', 'tooth_records', 'subscriptions', 'usage_counters',
                                   'platform_invoices', 'plans', 'templates', 'service_catalog', 'leads', 'users', 'refunds',
                                   'patient_medical_history_versions', 'visit_amendments', 'prescriptions', 'prescription_items',
                                   'balance_adjustments', 'expense_categories', 'expenses', 'cash_sessions',
                                   'cash_session_reopenings', 'legal_documents', 'legal_acceptances', 'consent_templates',
                                   'patient_consents', 'data_exports', 'platform_tenant_notes')
  LOOP
    EXECUTE format('GRANT DELETE ON %s TO app_user', t.tbl);
  END LOOP;
END $$;
DO $$
DECLARE f record; v_def text;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prosrc LIKE '%public.hard_delete_allowed()%'
  LOOP
    v_def := pg_get_functiondef(f.oid);
    v_def := replace(v_def, 'NOT public.hard_delete_allowed()', 'coalesce(current_setting(''app.allow_hard_delete'', true), '''') <> ''on''');
    v_def := replace(v_def, 'public.hard_delete_allowed()', 'coalesce(current_setting(''app.allow_hard_delete'', true), '''') = ''on''');
    EXECUTE v_def;
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS hard_delete_allowed();
