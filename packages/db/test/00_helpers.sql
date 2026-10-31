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
