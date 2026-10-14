-- migrate:up
-- Senior review fixes after week 2 (performance + least privilege).

-- ---------------------------------------------------------------------
-- 1. RLS policies that can use indexes.
-- "tenant_id IS NOT DISTINCT FROM x" cannot use a btree index, so every query on every tenant
-- table was a full scan (measured 51.6 ms -> 0.12 ms on 90k services rows with "=").
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE p.polname = 'tenant_isolation' AND c.relname <> 'outbox_events'
  LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (tenant_id = current_tenant_id())
                     WITH CHECK (tenant_id = current_tenant_id())$p$, t);
  END LOOP;
END $$;

-- outbox_events is the only RLS table where tenant_id may be NULL (platform-level events)
DROP POLICY tenant_isolation ON outbox_events;
CREATE POLICY tenant_isolation ON outbox_events
  USING (tenant_id = current_tenant_id() OR (tenant_id IS NULL AND current_tenant_id() IS NULL))
  WITH CHECK (tenant_id = current_tenant_id() OR (tenant_id IS NULL AND current_tenant_id() IS NULL));

-- ---------------------------------------------------------------------
-- 2. Every RLS table gets an index that starts with tenant_id
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS branch_hours_tenant_idx        ON branch_hours (tenant_id, branch_id, weekday);
CREATE INDEX IF NOT EXISTS doctor_branches_tenant_idx     ON doctor_branches (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS doctor_schedules_tenant_idx    ON doctor_schedules (tenant_id, doctor_id, weekday);
CREATE INDEX IF NOT EXISTS doctor_services_tenant_idx     ON doctor_services (tenant_id, service_id);
CREATE INDEX IF NOT EXISTS doctor_time_off_tenant_idx     ON doctor_time_off (tenant_id, doctor_id, starts_at);
CREATE INDEX IF NOT EXISTS faqs_tenant_idx                ON faqs (tenant_id, sort_order);
CREATE INDEX IF NOT EXISTS gallery_items_tenant_idx       ON gallery_items (tenant_id, sort_order);
CREATE INDEX IF NOT EXISTS in_app_notifications_tenant_idx ON in_app_notifications (tenant_id, member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_stock_tenant_idx     ON inventory_stock (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS invitations_tenant_idx         ON invitations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoice_items_tenant_idx       ON invoice_items (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS member_branches_tenant_idx     ON member_branches (tenant_id, member_id);
CREATE INDEX IF NOT EXISTS outbox_events_tenant_idx       ON outbox_events (tenant_id, id);
CREATE INDEX IF NOT EXISTS patient_files_tenant_idx       ON patient_files (tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS patient_medical_history_tenant_idx ON patient_medical_history (tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS prescription_items_tenant_idx  ON prescription_items (tenant_id, prescription_id);
CREATE INDEX IF NOT EXISTS refunds_tenant_idx             ON refunds (tenant_id, payment_id);
CREATE INDEX IF NOT EXISTS site_pages_tenant_idx          ON site_pages (tenant_id, site_id, sort_order);

-- ---------------------------------------------------------------------
-- 3. Least privilege for the API role: platform tables are read-only,
--    and users.platform_role can never be written by the API.
-- ---------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON plans, templates, service_catalog, platform_audit_log, platform_invoices, leads FROM app_user;
GRANT INSERT ON leads TO app_user;                       -- landing-page lead form
REVOKE INSERT, UPDATE, DELETE ON users FROM app_user;
GRANT INSERT (email, phone, password_hash, google_sub, full_name, avatar_url, locale) ON users TO app_user;
GRANT UPDATE (email, phone, password_hash, google_sub, full_name, avatar_url, locale, email_verified_at,
              phone_verified_at, totp_secret_enc, last_login_at, updated_at) ON users TO app_user;

-- Absolute session lifetime: every rotated refresh token remembers when its login started
ALTER TABLE refresh_tokens ADD COLUMN family_started_at timestamptz NOT NULL DEFAULT now();

-- Daily housekeeping for the auth tables (run by the worker as app_worker)
CREATE OR REPLACE FUNCTION purge_auth_data() RETURNS TABLE (otp_deleted int, tokens_deleted int, events_deleted int)
LANGUAGE plpgsql AS $$
DECLARE a int; b int; c int;
BEGIN
  DELETE FROM otp_codes WHERE created_at < now() - interval '1 day'; GET DIAGNOSTICS a = ROW_COUNT;
  DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'
                                OR revoked_at < now() - interval '7 days'; GET DIAGNOSTICS b = ROW_COUNT;
  DELETE FROM auth_events WHERE created_at < now() - interval '180 days'; GET DIAGNOSTICS c = ROW_COUNT;
  RETURN QUERY SELECT a, b, c;
END $$;
REVOKE EXECUTE ON FUNCTION purge_auth_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_auth_data() TO app_worker;

-- migrate:down
DROP FUNCTION IF EXISTS purge_auth_data();
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS family_started_at;
GRANT INSERT, UPDATE, DELETE ON plans, templates, service_catalog, platform_audit_log, platform_invoices, leads, users TO app_user;
DROP INDEX IF EXISTS branch_hours_tenant_idx, doctor_branches_tenant_idx, doctor_schedules_tenant_idx, doctor_services_tenant_idx,
  doctor_time_off_tenant_idx, faqs_tenant_idx, gallery_items_tenant_idx, in_app_notifications_tenant_idx, inventory_stock_tenant_idx,
  invitations_tenant_idx, invoice_items_tenant_idx, member_branches_tenant_idx, outbox_events_tenant_idx, patient_files_tenant_idx,
  patient_medical_history_tenant_idx, prescription_items_tenant_idx, refunds_tenant_idx, site_pages_tenant_idx;
-- policies are left with "=" (equivalent results; the old form was only slower)
