-- migrate:up
-- ARC-01, phase ARC-3 (docs/database/arc-01-signed-tenant-context.md, docs/reviews/2026-11-22-arc-01-phase-3-patient-scope.md):
-- the website's context ('patient') reaches only what the website, online booking and patient self-service use.
--
-- Since ARC-1/2 SQL running as the API role cannot pick a clinic: it gets the one the API signed. But on the public site
-- the API itself enters whatever clinic the request's hostname names, as the patient, so an injection inside a public
-- endpoint could still read that clinic's visits, invoices or staff. Now every RLS table carries a RESTRICTIVE policy for
-- the patient context, from an inventory of the public paths (a trace of the public API suites plus reading every query
-- on those paths):
--   read         SELECT only: the catalogue the website and the slot search show
--   files        SELECT of non-clinical files only (logos, photos, gallery and before/after cases)
--   read_write   SELECT, INSERT, UPDATE: appointments (hold, book, cancel, move) and patients (match or create the booker)
--   insert_only  INSERT only: the audit trail and the outbox
--   deny         everything else (clinical, money, staff, settings that are not public, and any table added later until
--                its migration says otherwise; a test fails when a table has no patient policy)
-- Staff contexts, the worker and the definer functions are not affected.
--
-- Two writes the public paths made on tables they otherwise never read now run as definer functions, bound to their row:
--   * appointments_clinical_follow(): a patient's own cancellation reopens the recall and the plan item booked for that
--     appointment (rows the patient context may no longer touch);
--   * next_tenant_counter(): a booker who is a new patient gets a file number.

-- The patient context, read from the plain setting on purpose: it is part of the signed proof (0077), so changing it
-- drops the clinic altogether (no rows at all); reading it here costs nothing per row.
CREATE FUNCTION is_patient_context() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.actor_type', true), '') = 'patient' $$;

-- ---------- the two writes that move into definer functions ----------
ALTER FUNCTION appointments_clinical_follow() SECURITY DEFINER;
ALTER FUNCTION appointments_clinical_follow() SET search_path = public, pg_temp;
ALTER FUNCTION appointments_clinical_follow() OWNER TO app_definer;
-- what it updates, and what the triggers of those rows read (visits, recalls and treatment plans since 0022)
GRANT UPDATE ON treatment_plan_items TO app_definer;
GRANT SELECT ON visit_procedures TO app_definer;

ALTER FUNCTION next_tenant_counter(text) SECURITY DEFINER;
ALTER FUNCTION next_tenant_counter(text) SET search_path = public, pg_temp;
ALTER FUNCTION next_tenant_counter(text) OWNER TO app_definer;
GRANT SELECT, INSERT, UPDATE ON tenant_counters TO app_definer;
REVOKE EXECUTE ON FUNCTION next_tenant_counter(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION next_tenant_counter(text) TO app_user, app_worker;

-- ---------- the patient policies ----------
DO $$
DECLARE t record; v_mode text; v_n int;
BEGIN
  FOR t IN SELECT c.oid::regclass AS tbl, c.relname FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    v_mode := CASE
      WHEN t.relname IN ('branches', 'branch_hours', 'holidays', 'rooms', 'doctors', 'doctor_branches', 'doctor_schedules',
                         'doctor_services', 'doctor_time_off', 'services', 'service_categories', 'faqs', 'gallery_items', 'sites',
                         'tenant_settings', 'tenants', 'subscriptions') THEN 'read'
      WHEN t.relname = 'files' THEN 'files'
      WHEN t.relname IN ('appointments', 'patients') THEN 'read_write'
      WHEN t.relname IN ('audit_log', 'outbox_events') THEN 'insert_only'
      ELSE 'deny' END;
    IF v_mode = 'deny' THEN
      EXECUTE format('CREATE POLICY patient_scope ON %s AS RESTRICTIVE USING (NOT is_patient_context()) WITH CHECK (NOT is_patient_context())', t.tbl);
    END IF;
    IF v_mode IN ('read', 'files') THEN
      EXECUTE format('CREATE POLICY patient_scope_insert ON %s AS RESTRICTIVE FOR INSERT WITH CHECK (NOT is_patient_context())', t.tbl);
      EXECUTE format('CREATE POLICY patient_scope_update ON %s AS RESTRICTIVE FOR UPDATE USING (NOT is_patient_context())', t.tbl);
    END IF;
    IF v_mode IN ('read', 'files', 'read_write', 'insert_only') THEN
      EXECUTE format('CREATE POLICY patient_scope_delete ON %s AS RESTRICTIVE FOR DELETE USING (NOT is_patient_context())', t.tbl);
    END IF;
    IF v_mode = 'insert_only' THEN
      EXECUTE format('CREATE POLICY patient_scope_select ON %s AS RESTRICTIVE FOR SELECT USING (NOT is_patient_context())', t.tbl);
      EXECUTE format('CREATE POLICY patient_scope_update ON %s AS RESTRICTIVE FOR UPDATE USING (NOT is_patient_context())', t.tbl);
    END IF;
    IF v_mode = 'files' THEN
      EXECUTE format($p$CREATE POLICY patient_scope_select ON %s AS RESTRICTIVE FOR SELECT
                        USING (NOT is_patient_context() OR kind NOT IN ('xray', 'clinical_photo', 'consent', 'document', 'invoice_pdf'))$p$, t.tbl);
    END IF;
  END LOOP;
  -- every table under RLS now says what the patient context may do
  SELECT count(*) INTO v_n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity
     AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname LIKE 'patient\_scope%');
  IF v_n > 0 THEN RAISE EXCEPTION '% RLS table(s) have no patient policy', v_n; END IF;
END $$;

-- migrate:down
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.polname, p.polrelid::regclass AS tbl FROM pg_policy p WHERE p.polname LIKE 'patient\_scope%' LOOP
    EXECUTE format('DROP POLICY %I ON %s', r.polname, r.tbl);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION next_tenant_counter(text) TO PUBLIC;
ALTER FUNCTION next_tenant_counter(text) OWNER TO CURRENT_USER;
ALTER FUNCTION next_tenant_counter(text) RESET search_path;
ALTER FUNCTION next_tenant_counter(text) SECURITY INVOKER;
REVOKE SELECT, INSERT, UPDATE ON tenant_counters FROM app_definer;
ALTER FUNCTION appointments_clinical_follow() OWNER TO CURRENT_USER;
ALTER FUNCTION appointments_clinical_follow() RESET search_path;
ALTER FUNCTION appointments_clinical_follow() SECURITY INVOKER;
REVOKE SELECT ON visit_procedures FROM app_definer;
REVOKE UPDATE ON treatment_plan_items FROM app_definer;
DROP FUNCTION IF EXISTS is_patient_context();
