-- migrate:up
-- Review R11 (defence in depth): the platform panel gets its own database role.
-- The platform_*() functions are SECURITY DEFINER and trust the admin id they are given (p_actor); app_user, the role
-- of the whole clinic API, could execute them. One SQL injection anywhere in the clinic API was therefore enough to
-- suspend clinics, change plans or read every clinic's figures, given an admin's id. Now only app_platform — used by
-- the platform module alone, through its own connection (DATABASE_PLATFORM_URL) — executes them, reads the platform
-- audit log, and nothing else: it has no clinic data at all.
--
-- The role is created by ops in production (LOGIN, a secret password, NOSUPERUSER NOBYPASSRLS) and by
-- docker/postgres/init in a new dev volume. For an existing dev database it is created here without a password;
-- give it one once:  ALTER ROLE app_platform LOGIN PASSWORD 'app_platform_dev';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    CREATE ROLE app_platform NOLOGIN NOSUPERUSER NOBYPASSRLS;
    RAISE NOTICE 'created role app_platform without login: run ALTER ROLE app_platform LOGIN PASSWORD ''...''';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_platform;

-- every platform function moves from app_user to app_platform (expire_trials stays the worker's)
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS fn FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'platform\_%'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM app_user', f.fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_platform', f.fn);
  END LOOP;
END $$;
-- the panel's sign-in reads the one account being signed in to, like the clinic sign-in
GRANT EXECUTE ON FUNCTION login_candidate(text, text) TO app_platform;

-- what the panel reads directly (PlatformRepository): the platform audit log, plans, legal versions and their
-- acceptance counts, and the names of the people in them
GRANT SELECT ON platform_audit_log, plans, legal_documents TO app_platform;
GRANT SELECT (document_id) ON legal_acceptances TO app_platform;
GRANT SELECT (id, full_name, email) ON users TO app_platform;

-- the clinic API never reads what the platform did
REVOKE SELECT ON platform_audit_log FROM app_user;

-- migrate:down
GRANT SELECT ON platform_audit_log TO app_user;
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS fn FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'platform\_%'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_user', f.fn);
  END LOOP;
END $$;
-- the role itself is left in place (it may own nothing, but ops created it; dropping roles is theirs to do)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_platform;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM app_platform;
REVOKE USAGE ON SCHEMA public FROM app_platform;
