-- Test helpers, installed into the throwaway test database only (runs as admin).
CREATE EXTENSION IF NOT EXISTS dblink;
CREATE SCHEMA IF NOT EXISTS test;
GRANT USAGE ON SCHEMA test TO app_user, app_worker, app_platform;

-- passes when cond is true
CREATE OR REPLACE FUNCTION test.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'ok - %', label;
END $$;

-- passes when stmt raises an error whose message contains expected (its effects are rolled back)
CREATE OR REPLACE FUNCTION test.throws(stmt text, expected text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%' || expected || '%' THEN RAISE NOTICE 'ok - %', label; RETURN; END IF;
    RAISE EXCEPTION 'FAIL: % (expected an error containing "%", got "%")', label, expected, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL: % (expected an error containing "%", but it succeeded)', label, expected;
END $$;

-- passes when stmt succeeds
CREATE OR REPLACE FUNCTION test.lives(stmt text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE NOTICE 'ok - %', label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FAIL: % (unexpected error "%")', label, SQLERRM;
END $$;

-- ARC-01: a signed clinic context for a session that logged in as app_user (dblink), computed here with the key from
-- app_context_keys exactly as the API computes it with TENANT_CONTEXT_KEY (packages/db src/context.ts).
-- the statement the API sends at the start of a transaction, signed with key p_key
CREATE OR REPLACE FUNCTION test.enter_sql(p_tenant uuid, p_member uuid DEFAULT NULL, p_user uuid DEFAULT NULL, p_actor text DEFAULT 'member',
  p_issued_at bigint DEFAULT (extract(epoch FROM clock_timestamp()) * 1000)::bigint, p_key smallint DEFAULT 1, p_sig text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT format('DO $x$ BEGIN PERFORM enter_context(%L::uuid, %L::uuid, %L::uuid, %L::text, %s::bigint, %s::smallint, %L::text); END $x$',
    p_tenant, p_member, p_user, p_actor, p_issued_at, p_key,
    coalesce(p_sig, (SELECT context_mac(k.key, concat_ws('|', 'enter-v1', p_tenant::text, coalesce(p_member::text, ''), coalesce(p_user::text, ''),
      coalesce(p_actor, ''), p_issued_at::text)) FROM app_context_keys k WHERE k.id = p_key)))
$$;
CREATE OR REPLACE FUNCTION test.host_sql(p_host text, p_sig text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT enter_host_context(%L::text, %s::bigint, 1::smallint, %L::text)::text', p_host, t,
    coalesce(p_sig, (SELECT context_mac(k.key, concat_ws('|', 'host-v1', p_host, t::text)) FROM app_context_keys k WHERE k.id = 1)))
  FROM (SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS t) x
$$;

