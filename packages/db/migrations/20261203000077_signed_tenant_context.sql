-- migrate:up
-- ARC-01, phase ARC-1 (docs/database/arc-01-signed-tenant-context.md): the clinic context can no longer be chosen by
-- SQL running as the API role.
--
-- Until now current_tenant_id() returned app.tenant_id, a setting any role can change: one SQL injection could
-- set_config() another clinic's id (taken from its public hostname) and read that clinic. Now the API signs the context
-- of each transaction with a key the database role cannot read (TENANT_CONTEXT_KEY), enter_context() /
-- enter_host_context() check the signature and leave a proof bound to this connection and this transaction, and every
-- reader of the context (current_tenant_id, current_member_id, current_user_id, current_actor_type, and through them
-- every policy and guard) believes the settings only when the proof matches. A changed setting, a copied proof or a
-- forged signature gives NULL: no clinic, no rows.
--
-- Logins that already bypass RLS (the migration role, the worker, backups: session_user, as in hard_delete_allowed)
-- keep using the plain settings; they read every row anyway. So migrations, seeds, the worker and the SQL test files
-- (SET ROLE app_user inside an admin session) are unchanged.
--
-- Rollout (user's decision): the mode starts 'permissive' — a signed context is verified, an unsigned one is still
-- accepted, so the API deployed before this one keeps working. ARC-2 switches to 'enforce' once the signing API is
-- live. The key is never in a migration: `pnpm db:context-key` writes it (from the API's env) as the admin role.

-- ---------- the key and the mode: readable by the definer functions only ----------
CREATE TABLE app_context_keys (
  id          smallint PRIMARY KEY CHECK (id > 0),
  key         bytea NOT NULL CHECK (octet_length(key) >= 32),
  created_at  timestamptz NOT NULL DEFAULT now(),
  retired_at  timestamptz
);
CREATE TABLE app_context_settings (
  only_row    boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  mode        text NOT NULL CHECK (mode IN ('permissive', 'enforce')),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_context_settings (mode) VALUES ('permissive');
-- default privileges (0002) would give the API and the worker these tables: take everything back
REVOKE ALL ON app_context_keys, app_context_settings FROM PUBLIC, app_user, app_worker, app_platform;
GRANT SELECT ON app_context_keys, app_context_settings TO app_definer;

-- ---------- the proof ----------
-- HMAC-SHA256 as lowercase hex
CREATE FUNCTION context_mac(p_key bytea, p_message text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = public, pg_temp AS $$
  SELECT encode(hmac(convert_to(p_message, 'UTF8'), p_key, 'sha256'), 'hex')
$$;
-- what the proof covers: the four settings, this connection, this transaction (now() = its start)
CREATE FUNCTION context_proof_message() RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT concat_ws('|', 'ctx-v1', coalesce(current_setting('app.tenant_id', true), ''), coalesce(current_setting('app.member_id', true), ''),
                   coalesce(current_setting('app.user_id', true), ''), coalesce(current_setting('app.actor_type', true), ''),
                   pg_backend_pid()::text, extract(epoch FROM now())::text)
$$;

-- Are this transaction's context settings the ones enter_context() set?
CREATE FUNCTION context_verified() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_proof text := coalesce(current_setting('app.ctx_proof', true), ''); v_key bytea;
BEGIN
  IF v_proof ~ '^[0-9]{1,5}:[0-9a-f]{64}$' THEN
    SELECT k.key INTO v_key FROM app_context_keys k WHERE k.id = split_part(v_proof, ':', 1)::int;
    IF v_key IS NOT NULL AND split_part(v_proof, ':', 2) = context_mac(v_key, context_proof_message()) THEN RETURN true; END IF;
  END IF;
  -- logins that bypass RLS read every row anyway; their plain settings are believed
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = session_user AND (r.rolsuper OR r.rolbypassrls)) THEN RETURN true; END IF;
  -- permissive rollout: a context with no proof at all is still accepted (a wrong proof never is)
  RETURN v_proof = '' AND (SELECT s.mode FROM app_context_settings s) = 'permissive';
END $$;

-- ---------- entering a context (the API, once per transaction) ----------
-- p_sig = HMAC(key, 'enter-v1|tenant|member|user|actor|issued_at_ms'), computed by the API (packages/db context.ts)
CREATE FUNCTION enter_context(p_tenant uuid, p_member uuid, p_user uuid, p_actor text, p_issued_at bigint, p_key_id smallint, p_sig text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_key bytea;
BEGIN
  IF p_tenant IS NULL OR (p_actor IS NOT NULL AND p_actor NOT IN ('member', 'patient', 'system')) THEN
    RAISE EXCEPTION 'clinic context incomplete' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT k.key INTO v_key FROM app_context_keys k WHERE k.id = p_key_id AND k.retired_at IS NULL;
  IF v_key IS NULL OR p_sig IS DISTINCT FROM context_mac(v_key, concat_ws('|', 'enter-v1', p_tenant::text, coalesce(p_member::text, ''),
       coalesce(p_user::text, ''), coalesce(p_actor, ''), p_issued_at::text)) THEN
    RAISE EXCEPTION 'clinic context signature not valid' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'context_signature';
  END IF;
  IF abs(extract(epoch FROM clock_timestamp()) * 1000 - p_issued_at) > 300000 THEN
    RAISE EXCEPTION 'clinic context signature expired' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'context_signature';
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant::text, true), set_config('app.member_id', coalesce(p_member::text, ''), true),
          set_config('app.user_id', coalesce(p_user::text, ''), true), set_config('app.actor_type', coalesce(p_actor, ''), true);
  PERFORM set_config('app.ctx_proof', p_key_id::text || ':' || context_mac(v_key, context_proof_message()), true);
END $$;

-- The public website: p_sig = HMAC(key, 'host-v1|host|issued_at_ms'). Resolves the clinic like resolve_tenant_by_host()
-- and enters it as the patient; returns the clinic, or NULL (and no context) when no live clinic owns the host.
CREATE FUNCTION enter_host_context(p_host text, p_issued_at bigint, p_key_id smallint, p_sig text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_key bytea; v_tenant uuid;
BEGIN
  SELECT k.key INTO v_key FROM app_context_keys k WHERE k.id = p_key_id AND k.retired_at IS NULL;
  IF v_key IS NULL OR p_sig IS DISTINCT FROM context_mac(v_key, concat_ws('|', 'host-v1', coalesce(p_host, ''), p_issued_at::text)) THEN
    RAISE EXCEPTION 'clinic context signature not valid' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'context_signature';
  END IF;
  IF abs(extract(epoch FROM clock_timestamp()) * 1000 - p_issued_at) > 300000 THEN
    RAISE EXCEPTION 'clinic context signature expired' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'context_signature';
  END IF;
  v_tenant := resolve_tenant_by_host(p_host);
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('app.tenant_id', v_tenant::text, true), set_config('app.member_id', '', true),
          set_config('app.user_id', '', true), set_config('app.actor_type', 'patient', true);
  PERFORM set_config('app.ctx_proof', p_key_id::text || ':' || context_mac(v_key, context_proof_message()), true);
  RETURN v_tenant;
END $$;

ALTER FUNCTION context_mac(bytea, text) OWNER TO app_definer;
ALTER FUNCTION context_proof_message() OWNER TO app_definer;
ALTER FUNCTION context_verified() OWNER TO app_definer;
ALTER FUNCTION enter_context(uuid, uuid, uuid, text, bigint, smallint, text) OWNER TO app_definer;
ALTER FUNCTION enter_host_context(text, bigint, smallint, text) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION context_mac(bytea, text), context_proof_message(), enter_context(uuid, uuid, uuid, text, bigint, smallint, text),
  enter_host_context(text, bigint, smallint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enter_context(uuid, uuid, uuid, text, bigint, smallint, text), enter_host_context(text, bigint, smallint, text) TO app_user;
-- context_verified() stays executable by every role: the readers below run with the caller's rights

-- ---------- the readers ----------
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN coalesce(current_setting('app.tenant_id', true), '') = '' THEN NULL
              WHEN context_verified() THEN current_setting('app.tenant_id', true)::uuid END
$$;
CREATE OR REPLACE FUNCTION current_member_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN coalesce(current_setting('app.member_id', true), '') = '' THEN NULL
              WHEN context_verified() THEN current_setting('app.member_id', true)::uuid END
$$;
CREATE FUNCTION current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN coalesce(current_setting('app.user_id', true), '') = '' THEN NULL
              WHEN context_verified() THEN current_setting('app.user_id', true)::uuid END
$$;
CREATE FUNCTION current_actor_type() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN coalesce(current_setting('app.actor_type', true), '') = '' THEN NULL
              WHEN context_verified() THEN current_setting('app.actor_type', true) END
$$;

-- The functions that read the member, the user or the actor straight from the settings now ask the readers. Found by
-- their text (as 0046 did) and checked at the end, so none is missed.
DO $$
DECLARE r record; v_def text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('member_branch_ids()', 'nullif(current_setting(''app.member_id'', true), '''')::uuid', 'current_member_id()'),
      ('gallery_items_consent_stamp()', 'nullif(current_setting(''app.member_id'', true), '''')::uuid', 'current_member_id()'),
      ('audit_row_change()', 'nullif(current_setting(''app.user_id'', true), '''')::uuid', 'current_user_id()'),
      ('audit_row_change()', 'nullif(current_setting(''app.actor_type'', true), '''')', 'current_actor_type()'),
      ('request_clinic_deletion(uuid,uuid)', 'nullif(current_setting(''app.user_id'', true), '''')::uuid', 'current_user_id()')) t(fn, old, new)
  LOOP
    v_def := pg_get_functiondef(r.fn::regprocedure);
    IF position(r.old IN v_def) = 0 THEN RAISE EXCEPTION '% does not read % as expected', r.fn, r.old; END IF;
    EXECUTE replace(v_def, r.old, r.new);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
               AND p.prosrc ~ 'current_setting\(''app\.(tenant_id|member_id|user_id|actor_type)'''
               AND p.proname NOT IN ('current_tenant_id', 'current_member_id', 'current_user_id', 'current_actor_type', 'context_proof_message')) THEN
    RAISE EXCEPTION 'a function still reads the clinic context settings directly: %', (
      SELECT string_agg(p.proname, ', ') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.prosrc ~ 'current_setting\(''app\.(tenant_id|member_id|user_id|actor_type)'''
        AND p.proname NOT IN ('current_tenant_id', 'current_member_id', 'current_user_id', 'current_actor_type', 'context_proof_message'));
  END IF;
END $$;

-- ---------- the policies: the verified clinic, read once per statement (an InitPlan, index still used) ----------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.oid::regclass AS tbl FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
           WHERE p.polname = 'tenant_isolation' AND c.relname <> 'outbox_events'
  LOOP
    EXECUTE format('ALTER POLICY tenant_isolation ON %s USING (tenant_id = (SELECT current_tenant_id())) WITH CHECK (tenant_id = (SELECT current_tenant_id()))', r.tbl);
  END LOOP;
END $$;
ALTER POLICY tenant_isolation ON outbox_events
  USING (tenant_id = (SELECT current_tenant_id()) OR (tenant_id IS NULL AND (SELECT current_tenant_id()) IS NULL))
  WITH CHECK (tenant_id = (SELECT current_tenant_id()) OR (tenant_id IS NULL AND (SELECT current_tenant_id()) IS NULL));
ALTER POLICY tenant_self ON tenants USING (id = (SELECT current_tenant_id())) WITH CHECK (id = (SELECT current_tenant_id()));

-- migrate:down
ALTER POLICY tenant_self ON tenants USING (id = current_tenant_id()) WITH CHECK (id = current_tenant_id());
ALTER POLICY tenant_isolation ON outbox_events
  USING (tenant_id = current_tenant_id() OR (tenant_id IS NULL AND current_tenant_id() IS NULL))
  WITH CHECK (tenant_id = current_tenant_id() OR (tenant_id IS NULL AND current_tenant_id() IS NULL));
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.oid::regclass AS tbl FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
           WHERE p.polname = 'tenant_isolation' AND c.relname <> 'outbox_events'
  LOOP
    EXECUTE format('ALTER POLICY tenant_isolation ON %s USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', r.tbl);
  END LOOP;
END $$;
DO $$
DECLARE r record; v_def text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('member_branch_ids()', 'current_member_id()', 'nullif(current_setting(''app.member_id'', true), '''')::uuid'),
      ('gallery_items_consent_stamp()', 'current_member_id()', 'nullif(current_setting(''app.member_id'', true), '''')::uuid'),
      ('audit_row_change()', 'current_user_id()', 'nullif(current_setting(''app.user_id'', true), '''')::uuid'),
      ('audit_row_change()', 'current_actor_type()', 'nullif(current_setting(''app.actor_type'', true), '''')'),
      ('request_clinic_deletion(uuid,uuid)', 'current_user_id()', 'nullif(current_setting(''app.user_id'', true), '''')::uuid')) t(fn, old, new)
  LOOP
    v_def := pg_get_functiondef(r.fn::regprocedure);
    EXECUTE replace(v_def, r.old, r.new);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS current_actor_type();
DROP FUNCTION IF EXISTS current_user_id();
CREATE OR REPLACE FUNCTION current_member_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.member_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
DROP FUNCTION IF EXISTS enter_host_context(text, bigint, smallint, text);
DROP FUNCTION IF EXISTS enter_context(uuid, uuid, uuid, text, bigint, smallint, text);
DROP FUNCTION IF EXISTS context_verified();
DROP FUNCTION IF EXISTS context_proof_message();
DROP FUNCTION IF EXISTS context_mac(bytea, text);
DROP TABLE IF EXISTS app_context_settings;
DROP TABLE IF EXISTS app_context_keys;
