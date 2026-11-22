-- =====================================================================================================================
-- Bridge: a database built from the original dental_saas_schema_3.sql  ->  migration 20261014000001_initial_schema
--
-- Every environment of this project is built by dbmate from packages/db/migrations, starting at 0001. 0001 is the v3
-- file plus the reception booking-code columns, the staff-author rules and check_in_by_code(), added before the first
-- deploy (diff: 64 lines, all on `appointments` plus one function). A database created from the bare v3 file
-- therefore cannot take 0002+ directly. This script adds exactly that difference and records 0001 as applied; then
-- `dbmate up` takes the database to the current schema (v4).
--
-- Run once, as the migration role, on a v3-file database only (never on one built by dbmate):
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f database/v3-to-0001.sql
--   pnpm db:migrate
-- It changes no rows. If existing appointments break the 0001 rules (a staff booking without its author, a visit
-- under way without a check-in method), it stops and says how many, for a person to fix first.
-- Tested 2026-11-22: v3 file -> this bridge -> 0002…0076 -> the full SQL test suite (docs/database/schema-v4-changelog.md).
-- =====================================================================================================================
\set ON_ERROR_STOP 1
BEGIN;

DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.appointments') IS NULL THEN
    RAISE EXCEPTION 'no appointments table: this is not a v3 database';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'appointments'
               AND column_name = 'check_in_code_hash') THEN
    RAISE EXCEPTION 'appointments.check_in_code_hash exists: this database is already at 0001 or later; run pnpm db:migrate instead';
  END IF;
  SELECT count(*) INTO n FROM appointments WHERE (source = 'website') <> (booked_by IS NULL);
  IF n > 0 THEN RAISE EXCEPTION '% appointment(s) break "website bookings have no staff author, staff bookings name one"; fix them first', n; END IF;
  SELECT count(*) INTO n FROM appointments WHERE status IN ('checked_in', 'in_progress', 'completed');
  IF n > 0 THEN RAISE EXCEPTION '% appointment(s) are checked in or later but v3 has no check-in method; give them one first', n; END IF;
END $$;

ALTER TABLE appointments
  ADD COLUMN check_in_code_hash        text,
  ADD COLUMN check_in_code_expires_at  timestamptz,
  ADD COLUMN check_in_code_used_at     timestamptz,
  ADD COLUMN check_in_method           text CHECK (check_in_method IN ('code','qr','manual','walk_in')),
  ADD COLUMN check_in_note             text,
  ADD COLUMN checked_in_by             uuid,
  ADD COLUMN override_reason           text;

ALTER TABLE appointments
  ADD CHECK ((check_in_code_hash IS NULL) = (check_in_code_expires_at IS NULL)),
  ADD CHECK (check_in_code_used_at IS NULL OR check_in_method IN ('code','qr')),
  ADD CHECK (status NOT IN ('checked_in','in_progress','completed') OR (check_in_method IS NOT NULL AND checked_in_at IS NOT NULL)),
  ADD CHECK (check_in_method IS DISTINCT FROM 'manual' OR check_in_note IS NOT NULL),
  ADD FOREIGN KEY (tenant_id, checked_in_by) REFERENCES tenant_members(tenant_id, id),
  ADD FOREIGN KEY (tenant_id, booked_by) REFERENCES tenant_members(tenant_id, id),
  ADD CHECK ((source = 'website') = (booked_by IS NULL)),
  ADD CHECK (override_reason IS NULL OR source <> 'website');

-- an unused code is unique inside the clinic, so reception lookup returns exactly one booking
CREATE UNIQUE INDEX appointments_open_code ON appointments (tenant_id, check_in_code_hash)
  WHERE check_in_code_used_at IS NULL AND check_in_code_hash IS NOT NULL;

-- Reception: check a patient in with the booking code (runs as app_user under RLS), as in 0001
CREATE OR REPLACE FUNCTION check_in_by_code(p_code_hash text, p_branch uuid, p_member uuid, p_method text DEFAULT 'code')
RETURNS TABLE (appointment_id uuid, patient_id uuid, doctor_id uuid, service_id uuid, starts_at timestamptz,
               payment_mode text, quoted_price_minor bigint, paid_online_minor bigint, amount_due_minor bigint)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_method NOT IN ('code','qr') THEN
    RAISE EXCEPTION 'check_in_by_code accepts code or qr only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN QUERY
  WITH hit AS (
    UPDATE appointments a SET
      status = 'checked_in', checked_in_at = now(), check_in_code_used_at = now(),
      check_in_method = p_method, checked_in_by = p_member
    WHERE a.check_in_code_hash = p_code_hash
      AND a.check_in_code_used_at IS NULL
      AND a.check_in_code_expires_at > now()
      AND a.branch_id = p_branch
      AND a.status IN ('pending','confirmed')
    RETURNING a.id, a.patient_id, a.doctor_id, a.service_id, a.starts_at, a.payment_mode, a.quoted_price_minor)
  SELECT h.id, h.patient_id, h.doctor_id, h.service_id, h.starts_at, h.payment_mode, h.quoted_price_minor,
         coalesce(pay.paid, 0)::bigint,
         greatest(coalesce(h.quoted_price_minor, 0) - coalesce(pay.paid, 0), 0)::bigint
  FROM hit h
  LEFT JOIN LATERAL (SELECT sum(p.amount_minor - p.refunded_minor) AS paid FROM payments p
                     WHERE p.appointment_id = h.id AND p.status IN ('succeeded','partially_refunded')) pay ON true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking code not valid for this branch today (wrong, used, expired or cancelled)'
      USING ERRCODE = 'no_data_found';
  END IF;
END $$;

-- dbmate's ledger, as dbmate creates it; 0001 is now applied
CREATE TABLE IF NOT EXISTS schema_migrations (version varchar NOT NULL PRIMARY KEY);
INSERT INTO schema_migrations (version) VALUES ('20261014000001') ON CONFLICT DO NOTHING;

COMMIT;
