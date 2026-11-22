-- migrate:up
-- Schema v4 audit, SEC-03 / SEC-04 / SEC-08 (docs/database/schema-v3-audit.md). The clinic API role (app_user) kept
-- INSERT on three platform-controlled tables, and read and write rights on dbmate's migration ledger:
--   * domains: an insert could create a live custom domain with no DNS proof; resolve_tenant_by_host() then routed it
--     and domain_allowed_for_tls() let Caddy issue a certificate for it. The API writes a domain only through
--     provision_tenant() at sign-up (0046), so app_user may now add just that one: the clinic's own subdomain, while
--     it has no domain yet. Custom domains are the platform's (or a future verified flow's) to write.
--   * subscriptions: an insert could add a live subscription on any plan whenever none was live. app_user may now add
--     only the first one, the trial provision_tenant() creates. Plans change through the platform functions.
--   * usage_counters: never used by the API; the INSERT goes (UPDATE and DELETE went in 0002 and 0046).
--   * schema_migrations: a forged row would make dbmate skip a migration. Only the migration role touches it.

CREATE FUNCTION domains_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user <> 'app_user' THEN RETURN NEW; END IF;
  IF NEW.type <> 'subdomain'
     OR split_part(NEW.hostname::text, '.', 1) IS DISTINCT FROM (SELECT slug::text FROM tenants WHERE id = NEW.tenant_id)
     OR EXISTS (SELECT 1 FROM domains WHERE tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'the clinic API adds only the clinic''s own subdomain, at sign-up' USING ERRCODE = 'insufficient_privilege',
      CONSTRAINT = 'domains_signup_only';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER domains_insert_guard BEFORE INSERT ON domains FOR EACH ROW EXECUTE FUNCTION domains_insert_guard();

CREATE FUNCTION subscriptions_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user <> 'app_user' THEN RETURN NEW; END IF;
  IF NEW.status <> 'trialing' OR EXISTS (SELECT 1 FROM subscriptions WHERE tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'the clinic API adds only the sign-up trial' USING ERRCODE = 'insufficient_privilege',
      CONSTRAINT = 'subscriptions_signup_only';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER subscriptions_insert_guard BEFORE INSERT ON subscriptions FOR EACH ROW EXECUTE FUNCTION subscriptions_insert_guard();

REVOKE INSERT ON usage_counters FROM app_user;
REVOKE ALL ON schema_migrations FROM app_user, app_worker;

-- migrate:down
GRANT SELECT, INSERT, UPDATE ON schema_migrations TO app_user;          -- as 0002 and 0046 left them
GRANT SELECT, INSERT, UPDATE, DELETE ON schema_migrations TO app_worker;
GRANT INSERT ON usage_counters TO app_user;
DROP TRIGGER IF EXISTS subscriptions_insert_guard ON subscriptions;
DROP FUNCTION IF EXISTS subscriptions_insert_guard();
DROP TRIGGER IF EXISTS domains_insert_guard ON domains;
DROP FUNCTION IF EXISTS domains_insert_guard();
