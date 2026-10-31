-- migrate:up
-- Review R11: most SECURITY DEFINER functions were declared with SET search_path = public. Without pg_temp named
-- last, the caller's temporary schema is searched FIRST for tables and views, so a session able to create a temp table
-- (any role, by default) could shadow e.g. "users" inside a function that runs as app_definer. Every definer function
-- in public now searches public, then pg_temp (pg_catalog stays implicitly first). Extension functions are left alone.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS fn FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
             AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%pg_temp%')
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') -- extensions' own
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.fn);
  END LOOP;
END $$;

-- migrate:down
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS fn FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
             AND 'search_path=public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))
             AND p.proname NOT IN ('merge_patients', 'patient_merge_counts') -- these had pg_temp already (0022)
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', f.fn);
  END LOOP;
END $$;
