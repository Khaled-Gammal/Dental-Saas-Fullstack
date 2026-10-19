-- Phase F3: clinic websites are Arabic only (CLR-07, F-01)
\set ON_ERROR_STOP 1
BEGIN;
SELECT test.ok((SELECT bool_and(locales = '{ar}') FROM sites), 'every existing site is Arabic only');
SELECT test.ok((SELECT column_default LIKE '%{ar}%' AND column_default NOT LIKE '%en%' FROM information_schema.columns
  WHERE table_name = 'sites' AND column_name = 'locales'), 'a new site starts Arabic only');
SELECT test.throws($$UPDATE sites SET locales = '{fr}'$$, 'check', 'only known languages are allowed (the CHECK stays)');
ROLLBACK;
