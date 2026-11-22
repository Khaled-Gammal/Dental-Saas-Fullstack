-- migrate:up
-- ARC-01, phase ARC-2 (docs/database/arc-01-signed-tenant-context.md): only a signed clinic context counts.
-- 0077 shipped 'permissive' so the API deployed before it kept working; the API now signs every context (verified by
-- running the whole API suite with the test database in this mode). From here an unsigned app.tenant_id is ignored for
-- every login that does not bypass RLS: SQL running as the API role cannot pick a clinic any more.
--
-- Deploy only after the signing API is live everywhere, and after `pnpm db:context-key` wrote its key (without a key
-- the API cannot enter any clinic, in either mode). Emergency switch back, as the admin role, no migration needed:
--   UPDATE app_context_settings SET mode = 'permissive', updated_at = now();
UPDATE app_context_settings SET mode = 'enforce', updated_at = now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_context_keys WHERE retired_at IS NULL) THEN
    RAISE WARNING 'no clinic context key yet: run pnpm db:context-key (with the API''s TENANT_CONTEXT_KEY) before the API starts';
  END IF;
END $$;

-- migrate:down
UPDATE app_context_settings SET mode = 'permissive', updated_at = now();
