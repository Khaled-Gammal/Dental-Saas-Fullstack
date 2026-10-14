-- migrate:up
-- Database roles (created beforehand: docker/postgres/init/01-roles-and-databases.sql in dev,
-- by ops in production). See SRS section 6.10.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('app_user','app_worker','app_definer')) <> 3 THEN
    RAISE EXCEPTION 'Roles app_user, app_worker, app_definer must exist first. '
                    'Dev: docker compose down -v && docker compose up -d (runs docker/postgres/init).';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_user, app_worker, app_definer;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user, app_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user, app_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user, app_worker;

-- Lookups that run before a tenant is known: owned by app_definer (BYPASSRLS), callable by the API only.
GRANT SELECT ON tenants, tenant_members, roles, invitations, payments, domains TO app_definer;
GRANT SELECT, UPDATE ON appointments TO app_definer;
ALTER FUNCTION memberships_for_user(uuid)          OWNER TO app_definer;
ALTER FUNCTION invitation_by_token(text)           OWNER TO app_definer;
ALTER FUNCTION tenant_for_payment(text, text)      OWNER TO app_definer;
ALTER FUNCTION resolve_tenant_by_host(text)        OWNER TO app_definer;
ALTER FUNCTION domain_allowed_for_tls(text)        OWNER TO app_definer;
ALTER FUNCTION release_all_expired_holds()         OWNER TO app_definer;
GRANT EXECUTE ON FUNCTION memberships_for_user(uuid), invitation_by_token(text), tenant_for_payment(text, text),
  resolve_tenant_by_host(text), domain_allowed_for_tls(text) TO app_user;
GRANT EXECUTE ON FUNCTION release_all_expired_holds() TO app_worker;

-- Append-only and platform-controlled data
REVOKE UPDATE, DELETE ON audit_log, platform_audit_log, tooth_records FROM app_user;
REVOKE UPDATE, DELETE ON subscriptions, usage_counters, platform_invoices FROM app_user;
REVOKE UPDATE ON tenants FROM app_user;
GRANT UPDATE (name_en, name_ar, onboarding_step, default_locale, timezone, logo_file_id, primary_phone, whatsapp,
  email, social_links, specialties, about_en, about_ar, updated_at) ON tenants TO app_user;

-- migrate:down
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_user, app_worker, app_definer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_user, app_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM app_user, app_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM app_user, app_worker;
ALTER FUNCTION memberships_for_user(uuid)     OWNER TO CURRENT_USER;
ALTER FUNCTION invitation_by_token(text)      OWNER TO CURRENT_USER;
ALTER FUNCTION tenant_for_payment(text, text) OWNER TO CURRENT_USER;
ALTER FUNCTION resolve_tenant_by_host(text)   OWNER TO CURRENT_USER;
ALTER FUNCTION domain_allowed_for_tls(text)   OWNER TO CURRENT_USER;
ALTER FUNCTION release_all_expired_holds()    OWNER TO CURRENT_USER;
REVOKE USAGE ON SCHEMA public FROM app_user, app_worker, app_definer;
