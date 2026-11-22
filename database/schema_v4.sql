-- =====================================================================================================================
-- Dental Clinic SaaS: schema v4, GENERATED SNAPSHOT (reference only, never applied)
--
-- What runs is packages/db/migrations (dbmate): 0001 (the v3 design) + 0002…0076. This file is
-- `pg_dump --schema-only` of a database built from those migrations (2026-11-22, PostgreSQL 16.14, migrations up to
-- 20261202000076), kept so a reviewer can read the whole schema in one place: tables, constraints, indexes,
-- functions, triggers, RLS policies, ownership and grants. The roles it grants to (app_user, app_worker,
-- app_definer, app_platform, app_backup) are created outside the migrations (docker/postgres/init in dev, by ops in
-- production).
--
-- Regenerate after a migration:
--   docker compose exec -T postgres pg_dump -U postgres -d dental --schema-only --no-tablespaces > database/schema_v4.sql
-- (then put this header back and drop the \restrict / \unrestrict lines, whose token changes on every dump).
-- The audit that led to 0070…0076: docs/database/schema-v3-audit.md; deploy notes: docs/database/schema-v4-migration-guide.md.
-- =====================================================================================================================

--
-- PostgreSQL database dump
--

\restrict 5ahh8VR2z6TXdOQVfJVrVMOZ68zR1EcoAU8W9cCgAYD9uRh3Hz5Q3v3QG97gCV5

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: btree_gin; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA public;


--
-- Name: EXTENSION btree_gin; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION btree_gin IS 'support for indexing common datatypes in GIN';


--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: acting_member_is_owner(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.acting_member_is_owner() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (SELECT 1 FROM tenant_members m JOIN roles r ON r.id = m.role_id
                  WHERE m.id = current_member_id() AND m.tenant_id = current_tenant_id()
                    AND m.status = 'active' AND r.key = 'owner' AND r.is_system)
$$;


ALTER FUNCTION public.acting_member_is_owner() OWNER TO postgres;

--
-- Name: appointments_clear_code(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.appointments_clear_code() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'no_show', 'expired') AND NEW.check_in_code_used_at IS NULL THEN
    NEW.check_in_code_hash := NULL;
    NEW.check_in_code_expires_at := NULL;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.appointments_clear_code() OWNER TO postgres;

--
-- Name: appointments_clinical_follow(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.appointments_clinical_follow() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    UPDATE visits SET status = 'final' WHERE appointment_id = NEW.id AND status = 'draft';
    UPDATE recalls SET status = 'done' WHERE appointment_id = NEW.id AND status = 'booked';
  ELSE -- cancelled or no-show
    -- the booked follow-up and the scheduled plan item are open again (APPT-007, VISIT-005)
    UPDATE recalls SET status = 'pending', appointment_id = NULL WHERE appointment_id = NEW.id AND status = 'booked';
    UPDATE treatment_plan_items SET status = 'planned', appointment_id = NULL WHERE appointment_id = NEW.id AND status = 'scheduled';
  END IF;
  RETURN NULL;
END $$;


ALTER FUNCTION public.appointments_clinical_follow() OWNER TO postgres;

--
-- Name: appointments_move_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.appointments_move_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF (NEW.starts_at, NEW.ends_at, NEW.doctor_id, NEW.branch_id) IS DISTINCT FROM (OLD.starts_at, OLD.ends_at, OLD.doctor_id, OLD.branch_id)
     AND OLD.status NOT IN ('held', 'pending', 'confirmed') THEN
    RAISE EXCEPTION 'a % appointment keeps its time, doctor and branch', OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'appointments_move_status';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.appointments_move_guard() OWNER TO postgres;

--
-- Name: appointments_transition(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.appointments_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF OLD.status = 'confirmed' AND NEW.status = 'pending' AND NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN
    NEW.confirmed_at := NULL;
    RETURN NEW;
  END IF;
  IF (OLD.status, NEW.status) NOT IN (
      ('held','expired'), ('held','pending'), ('held','confirmed'), ('held','cancelled'),
      ('pending','confirmed'), ('pending','checked_in'), ('pending','cancelled'), ('pending','no_show'),
      ('confirmed','checked_in'), ('confirmed','cancelled'), ('confirmed','no_show'),
      ('checked_in','in_progress'), ('checked_in','completed'), ('checked_in','cancelled'),
      ('in_progress','completed')) THEN
    RAISE EXCEPTION 'appointment cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.appointments_transition() OWNER TO postgres;

--
-- Name: appointments_validate_doctor(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.appointments_validate_doctor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM doctors d JOIN doctor_branches db ON db.doctor_id = d.id AND db.branch_id = NEW.branch_id
                 WHERE d.id = NEW.doctor_id AND d.is_active) THEN
    RAISE EXCEPTION 'the doctor is not active at this branch' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.appointments_validate_doctor() OWNER TO postgres;

--
-- Name: ar_normalize(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ar_normalize(p text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT btrim(regexp_replace(
    translate(lower(regexp_replace(coalesce(p, ''), '[ً-ٰٟـ]', '', 'g')), 'أإآٱةىؤئ', 'ااااهيوي'),
    '\s+', ' ', 'g'))
$$;


ALTER FUNCTION public.ar_normalize(p text) OWNER TO postgres;

--
-- Name: audit_row_change(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.audit_row_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  r jsonb;
  v_entity text := TG_ARGV[0];
  v_secret text[] := coalesce(TG_ARGV[1:], ARRAY[]::text[]);
  v_changes jsonb := '{}';
  v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  v_actor text := nullif(current_setting('app.actor_type', true), '');
  k text;
BEGIN
  IF public.hard_delete_allowed() THEN RETURN NULL; END IF;
  r := coalesce(n, o);
  FOR k IN SELECT jsonb_object_keys(r) LOOP
    -- access_version is bookkeeping (it changes because something audited changed)
    CONTINUE WHEN k IN ('id', 'tenant_id', 'updated_at', 'created_at', 'access_version');
    IF (o -> k) IS DISTINCT FROM (n -> k) THEN
      v_changes := v_changes || jsonb_build_object(k,
        CASE WHEN k = ANY (v_secret) THEN 'true'::jsonb ELSE jsonb_build_array(o -> k, n -> k) END);
    END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND v_changes = '{}' THEN RETURN NULL; END IF;
  INSERT INTO audit_log (tenant_id, actor_type, actor_user_id, action, entity_type, entity_id, changes)
  VALUES (coalesce(r ->> 'tenant_id', CASE WHEN TG_TABLE_NAME = 'tenants' THEN r ->> 'id' END)::uuid,
          coalesce(v_actor, CASE WHEN v_user IS NOT NULL THEN 'member' ELSE 'system' END),
          CASE WHEN coalesce(v_actor, 'member') = 'member' THEN v_user END,
          v_entity || '.' || CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,
          v_entity, coalesce(r ->> 'id', r ->> 'member_id', r ->> 'doctor_id', r ->> 'tenant_id')::uuid, v_changes);
  RETURN NULL;
END $$;


ALTER FUNCTION public.audit_row_change() OWNER TO postgres;

--
-- Name: balance_adjustments_apply(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.balance_adjustments_apply() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.installment_id IS NOT NULL THEN
    UPDATE installments SET status = 'waived', waived_at = now(), waived_by = NEW.created_by, waived_reason = NEW.reason WHERE id = NEW.installment_id;
  END IF;
  PERFORM recalc_invoice(NEW.invoice_id);
  RETURN NULL;
END $$;


ALTER FUNCTION public.balance_adjustments_apply() OWNER TO postgres;

--
-- Name: balance_adjustments_validate(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.balance_adjustments_validate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE inv record; ins record;
BEGIN
  SELECT status, total_minor, paid_minor, adjusted_minor INTO inv FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF inv.status NOT IN ('issued', 'partially_paid') THEN
    RAISE EXCEPTION 'only an open invoice is adjusted (this one is %)', inv.status USING ERRCODE = 'check_violation', CONSTRAINT = 'balance_adjustments_invoice_open';
  END IF;
  IF NEW.amount_minor > inv.total_minor - inv.paid_minor - inv.adjusted_minor THEN
    RAISE EXCEPTION 'the adjustment is more than what is owed' USING ERRCODE = 'check_violation', CONSTRAINT = 'balance_adjustments_exceeds_balance';
  END IF;
  IF NEW.installment_id IS NOT NULL THEN
    SELECT s.status, s.amount_minor, s.paid_minor, p.invoice_id INTO ins
      FROM installments s JOIN payment_plans p ON p.id = s.plan_id WHERE s.id = NEW.installment_id FOR UPDATE OF s;
    IF ins.invoice_id IS DISTINCT FROM NEW.invoice_id OR ins.status NOT IN ('due', 'partially_paid') THEN
      RAISE EXCEPTION 'only an unpaid installment of this invoice is waived' USING ERRCODE = 'check_violation', CONSTRAINT = 'balance_adjustments_installment';
    END IF;
    NEW.amount_minor := ins.amount_minor - ins.paid_minor; -- a waiver is what is left of the installment
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.balance_adjustments_validate() OWNER TO postgres;

--
-- Name: billing_instructions(); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.billing_instructions() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT value FROM platform_settings WHERE key = 'billing_instructions'
$$;


ALTER FUNCTION public.billing_instructions() OWNER TO app_definer;

--
-- Name: branch_allowed(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.branch_allowed(p_branch uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT b IS NULL OR p_branch = ANY (b) FROM (SELECT member_branch_ids() AS b) x
$$;


ALTER FUNCTION public.branch_allowed(p_branch uuid) OWNER TO postgres;

--
-- Name: business_date(timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.business_date(p_at timestamp with time zone, p_tenant uuid) RETURNS date
    LANGUAGE sql STABLE
    AS $$
  SELECT (p_at AT TIME ZONE coalesce((SELECT timezone FROM tenants WHERE id = p_tenant), 'Africa/Cairo'))::date
$$;


ALTER FUNCTION public.business_date(p_at timestamp with time zone, p_tenant uuid) OWNER TO postgres;

--
-- Name: cash_day_closed(uuid, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cash_day_closed(p_branch uuid, p_date date) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM cash_sessions WHERE branch_id = p_branch AND business_date = p_date FOR SHARE;
  RETURN coalesce(v_status = 'closed', false);
END $$;


ALTER FUNCTION public.cash_day_closed(p_branch uuid, p_date date) OWNER TO postgres;

--
-- Name: cash_day_open_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cash_day_open_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_day date;
BEGIN
  IF public.hard_delete_allowed() THEN RETURN coalesce(NEW, OLD); END IF;
  IF TG_TABLE_NAME = 'payments' THEN
    IF TG_OP = 'UPDATE' AND NOT (NEW.status = 'reversed' AND OLD.status <> 'reversed') THEN RETURN NEW; END IF; -- refunds have their own day
    IF NEW.paid_at IS NULL THEN RETURN NEW; END IF;
    IF NEW.paid_at > now() + interval '5 minutes' THEN
      RAISE EXCEPTION 'a payment is not dated in the future' USING ERRCODE = 'check_violation', CONSTRAINT = 'payments_future';
    END IF;
    v_day := business_date(NEW.paid_at, NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'refunds' THEN
    v_day := business_date(NEW.refunded_at, NEW.tenant_id);
  ELSE -- expenses: a new one, or one whose status changes what the day expects
    -- money that left the drawer stays on its day whatever the owner decides; only a void (recorded in error) changes it
    IF TG_OP = 'UPDATE' AND NOT (NEW.status = 'void' AND OLD.status <> 'void') THEN RETURN NEW; END IF;
    v_day := NEW.spent_on;
  END IF;
  IF cash_day_closed(NEW.branch_id, v_day) THEN
    RAISE EXCEPTION 'the cash day % of this branch is closed', v_day USING ERRCODE = 'check_violation', CONSTRAINT = 'cash_session_closed';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.cash_day_open_guard() OWNER TO postgres;

--
-- Name: cash_day_totals(uuid, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cash_day_totals(p_branch uuid, p_date date) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  WITH w AS (SELECT * FROM cash_day_window(p_branch, p_date)),
  pay AS (
    SELECT p.method, sum(p.amount_minor) AS amount FROM payments p, w
    WHERE p.tenant_id = w.tenant_id AND p.branch_id = p_branch AND p.status IN ('succeeded', 'partially_refunded', 'refunded')
      AND p.paid_at >= w.day_start AND p.paid_at < w.day_end GROUP BY p.method),
  ref AS (
    SELECT r.method, sum(r.amount_minor) AS amount FROM refunds r, w
    WHERE r.tenant_id = w.tenant_id AND r.branch_id = p_branch AND r.refunded_at >= w.day_start AND r.refunded_at < w.day_end GROUP BY r.method),
  exp AS (
    SELECT e.payment_method AS method, sum(e.amount_minor) AS amount FROM expenses e
    WHERE e.branch_id = p_branch AND e.spent_on = p_date AND e.status <> 'void' AND e.payment_method IS NOT NULL
    GROUP BY e.payment_method)
  SELECT jsonb_build_object(
    'payments', coalesce((SELECT jsonb_object_agg(method, amount) FROM pay), '{}'),
    'refunds', coalesce((SELECT jsonb_object_agg(method, amount) FROM ref), '{}'),
    'expenses', coalesce((SELECT jsonb_object_agg(method, amount) FROM exp), '{}'),
    'cash_in', coalesce((SELECT amount FROM pay WHERE method = 'cash'), 0),
    'cash_refunds', coalesce((SELECT amount FROM ref WHERE method = 'cash'), 0),
    'cash_expenses', coalesce((SELECT amount FROM exp WHERE method = 'cash'), 0))
$$;


ALTER FUNCTION public.cash_day_totals(p_branch uuid, p_date date) OWNER TO postgres;

--
-- Name: cash_day_window(uuid, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cash_day_window(p_branch uuid, p_date date, OUT tenant_id uuid, OUT day_start timestamp with time zone, OUT day_end timestamp with time zone) RETURNS record
    LANGUAGE sql STABLE
    AS $$
  SELECT b.tenant_id,
         p_date::timestamp AT TIME ZONE coalesce(t.timezone, 'Africa/Cairo'),
         (p_date + 1)::timestamp AT TIME ZONE coalesce(t.timezone, 'Africa/Cairo')
    FROM branches b LEFT JOIN tenants t ON t.id = b.tenant_id
   WHERE b.id = p_branch
$$;


ALTER FUNCTION public.cash_day_window(p_branch uuid, p_date date, OUT tenant_id uuid, OUT day_start timestamp with time zone, OUT day_end timestamp with time zone) OWNER TO postgres;

--
-- Name: cash_sessions_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cash_sessions_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF public.hard_delete_allowed() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN RAISE EXCEPTION 'a session opens first' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.branch_id, NEW.business_date, NEW.currency, NEW.opening_minor, NEW.opened_by, NEW.opened_at)
     IS DISTINCT FROM (OLD.branch_id, OLD.business_date, OLD.currency, OLD.opening_minor, OLD.opened_by, OLD.opened_at) THEN
    RAISE EXCEPTION 'the opening of a session is fixed' USING ERRCODE = 'check_violation', CONSTRAINT = 'cash_session_closed';
  END IF;
  IF OLD.status = 'closed' AND NEW.status = 'closed' THEN
    RAISE EXCEPTION 'a closed session does not change' USING ERRCODE = 'check_violation', CONSTRAINT = 'cash_session_closed';
  END IF;
  IF OLD.status = 'closed' AND NEW.status = 'open' AND NOT EXISTS (
       SELECT 1 FROM cash_session_reopenings WHERE session_id = OLD.id AND reopened_at = now()) THEN
    RAISE EXCEPTION 'a session is reopened only with its reason recorded' USING ERRCODE = 'check_violation', CONSTRAINT = 'cash_session_closed';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.cash_sessions_guard() OWNER TO postgres;

--
-- Name: check_in_by_code(text, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.check_in_by_code(p_code_hash text, p_branch uuid, p_member uuid, p_method text DEFAULT 'code'::text) RETURNS TABLE(appointment_id uuid, patient_id uuid, doctor_id uuid, service_id uuid, starts_at timestamp with time zone, payment_mode text, quoted_price_minor bigint, paid_online_minor bigint, amount_due_minor bigint)
    LANGUAGE plpgsql
    AS $$
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


ALTER FUNCTION public.check_in_by_code(p_code_hash text, p_branch uuid, p_member uuid, p_method text) OWNER TO postgres;

--
-- Name: clinic_object_keys(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.clinic_object_keys(p_tenant uuid) RETURNS SETOF text
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT f.object_key FROM files f WHERE f.tenant_id = p_tenant AND coalesce(cardinality(f.variant_widths), 0) = 0
  UNION ALL
  SELECT f.object_key || '/' || w || '.webp' FROM files f, unnest(f.variant_widths) w WHERE f.tenant_id = p_tenant
  UNION ALL
  SELECT e.object_key FROM data_exports e WHERE e.tenant_id = p_tenant AND e.object_key IS NOT NULL
$$;


ALTER FUNCTION public.clinic_object_keys(p_tenant uuid) OWNER TO postgres;

--
-- Name: clinic_timezone(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.clinic_timezone() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT coalesce((SELECT timezone FROM tenants WHERE id = current_tenant_id()), 'Africa/Cairo')
$$;


ALTER FUNCTION public.clinic_timezone() OWNER TO postgres;

--
-- Name: clinics_due_for_purge(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.clinics_due_for_purge() RETURNS SETOF uuid
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT id FROM tenants WHERE status = 'cancelled' AND delete_after IS NOT NULL AND delete_after <= now() ORDER BY delete_after
$$;


ALTER FUNCTION public.clinics_due_for_purge() OWNER TO postgres;

--
-- Name: consent_templates_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.consent_templates_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF current_user <> 'app_user' THEN RETURN coalesce(NEW, OLD); END IF; -- migrations, seeds, the clinic's erase
  IF (NEW.key, NEW.version, NEW.title_ar, NEW.body_ar, NEW.reviewed_at, NEW.reviewed_by, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.key, OLD.version, OLD.title_ar, OLD.body_ar, OLD.reviewed_at, OLD.reviewed_by, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a consent text is never edited: save a new version' USING ERRCODE = 'check_violation', CONSTRAINT = 'consent_templates_locked';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.consent_templates_guard() OWNER TO postgres;

--
-- Name: current_member_id(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.current_member_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('app.member_id', true), '')::uuid $$;


ALTER FUNCTION public.current_member_id() OWNER TO postgres;

--
-- Name: current_tenant_id(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.current_tenant_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;


ALTER FUNCTION public.current_tenant_id() OWNER TO postgres;

--
-- Name: default_role_discount_bp(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.default_role_discount_bp(p_role text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE p_role WHEN 'receptionist' THEN 1000 WHEN 'accountant' THEN 2000 ELSE 0 END
$$;


ALTER FUNCTION public.default_role_discount_bp(p_role text) OWNER TO postgres;

--
-- Name: default_role_permissions(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.default_role_permissions(p_role text) RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN ARRAY['*']
    WHEN 'doctor' THEN ARRAY['branches:read','patients:read','patients:write','patients:merge','clinical:read','clinical:write',
      'appointments:read','appointments:write:own','treatments:write:own','invoices:read:own','reports:read:own']
    WHEN 'receptionist' THEN ARRAY['branches:read','patients:read','patients:write','patients:merge','patients:block','clinical:read',
      'appointments:read','appointments:write','appointments:override','invoices:read','invoices:write','payments:write',
      'payments:reverse','discounts:apply','reports:read:daily','cash:operate']
    WHEN 'assistant' THEN ARRAY['branches:read','patients:read','clinical:read','appointments:read','appointments:write',
      'inventory:read','inventory:write']
    WHEN 'accountant' THEN ARRAY['branches:read','patients:read','appointments:read','invoices:read','invoices:write','invoices:void',
      'payments:write','payments:refund','discounts:apply','expenses:read','expenses:write','inventory:read','reports:read',
      'subscription:read','cash:operate']
    ELSE ARRAY[]::text[] END
$$;


ALTER FUNCTION public.default_role_permissions(p_role text) OWNER TO postgres;

--
-- Name: doctor_busy_intervals(uuid[], timestamp with time zone, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.doctor_busy_intervals(p_doctors uuid[], p_from timestamp with time zone, p_to timestamp with time zone, p_exclude uuid DEFAULT NULL::uuid) RETURNS TABLE(doctor_id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT a.doctor_id, a.starts_at, a.ends_at FROM appointments a
  WHERE a.tenant_id = current_tenant_id()
    AND a.doctor_id = ANY (p_doctors) AND a.starts_at < p_to AND a.ends_at > p_from
    AND a.status IN ('held','pending','confirmed','checked_in','in_progress','completed')
    AND (a.status <> 'held' OR a.hold_expires_at > now())
    AND (p_exclude IS NULL OR a.id <> p_exclude)
$$;


ALTER FUNCTION public.doctor_busy_intervals(p_doctors uuid[], p_from timestamp with time zone, p_to timestamp with time zone, p_exclude uuid) OWNER TO app_definer;

--
-- Name: doctor_payouts_derive(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.doctor_payouts_derive() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' AND NEW.status <> 'paid' THEN
    RAISE EXCEPTION 'payout % is already paid', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  NEW.amount_minor := (SELECT coalesce(sum(commission_minor), 0) FROM visit_procedures WHERE payout_id = NEW.id);
  RETURN NEW;
END $$;


ALTER FUNCTION public.doctor_payouts_derive() OWNER TO postgres;

--
-- Name: domain_allowed_for_tls(text); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.domain_allowed_for_tls(p_host text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (SELECT 1 FROM domains WHERE hostname = p_host::citext AND status IN ('verified','active'))
$$;


ALTER FUNCTION public.domain_allowed_for_tls(p_host text) OWNER TO app_definer;

--
-- Name: domains_insert_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.domains_insert_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION public.domains_insert_guard() OWNER TO postgres;

--
-- Name: expenses_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.expenses_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.file_id IS NOT NULL AND NEW.file_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.file_id END)
     AND NOT EXISTS (SELECT 1 FROM files WHERE id = NEW.file_id AND tenant_id = NEW.tenant_id AND is_private) THEN
    RAISE EXCEPTION 'an expense document is a private file of the clinic' USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_document_private';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.spent_on > business_date(now(), NEW.tenant_id) THEN
      RAISE EXCEPTION 'an expense is not dated in the future' USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_future';
    END IF;
    IF NEW.currency <> (SELECT currency FROM tenants WHERE id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'an expense is in the clinic currency' USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_clinic_currency';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.branch_id, NEW.category_id, NEW.amount_minor, NEW.currency, NEW.spent_on, NEW.payment_method, NEW.reference, NEW.supplier_name,
      NEW.description, NEW.created_by, NEW.created_at) IS DISTINCT FROM
     (OLD.branch_id, OLD.category_id, OLD.amount_minor, OLD.currency, OLD.spent_on, OLD.payment_method, OLD.reference, OLD.supplier_name,
      OLD.description, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a recorded expense is not edited; void it and record it again' USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_locked';
  END IF;
  IF NEW.file_id IS DISTINCT FROM OLD.file_id AND (OLD.file_id IS NOT NULL OR OLD.status = 'void') THEN
    RAISE EXCEPTION 'the document of an expense is attached once, while it is not void' USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_document_fixed';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'void'))
    OR (OLD.status IN ('approved', 'rejected') AND NEW.status = 'void')) THEN
    RAISE EXCEPTION 'an expense cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_locked';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;


ALTER FUNCTION public.expenses_guard() OWNER TO postgres;

--
-- Name: expire_subscriptions(integer); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.expire_subscriptions(p_grace_days integer) RETURNS TABLE(past_due integer, suspended integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_due uuid[]; v_cut uuid[];
BEGIN
  -- every write takes the clinic and its subscription together (FOR UPDATE OF t, s SKIP LOCKED), the order
  -- platform_record_payment and platform_reactivate take them: a clinic being paid for or reactivated right now is
  -- left for the next run, and the worker never waits on them (no deadlock)
  WITH cand AS (
    SELECT s.id FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id
     WHERE s.status = 'active' AND s.current_period_end <= now() AND t.deleted_at IS NULL AND t.status <> 'cancelled'
     FOR UPDATE OF t, s SKIP LOCKED),
  due AS (
    UPDATE subscriptions s SET status = 'past_due', grace_ends_at = now() + make_interval(days => p_grace_days), updated_at = now()
      FROM cand WHERE s.id = cand.id
    RETURNING s.tenant_id)
  SELECT array_agg(tenant_id) INTO v_due FROM due;
  -- a past-due subscription without a grace (its clinic was reactivated from a manual suspension) gets a full one now
  WITH g AS (
    SELECT s.id FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id
     WHERE s.status = 'past_due' AND s.grace_ends_at IS NULL
     FOR UPDATE OF t, s SKIP LOCKED)
  UPDATE subscriptions s SET grace_ends_at = now() + make_interval(days => p_grace_days), updated_at = now() FROM g WHERE s.id = g.id;
  -- the clinic shows as past due too (unless it is suspended for another reason; one reactivated from a manual
  -- suspension while its subscription was past due is caught up here)
  WITH c AS (
    SELECT t.id FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id
     WHERE t.status = 'active' AND s.status = 'past_due'
     FOR UPDATE OF t, s SKIP LOCKED)
  UPDATE tenants t SET status = 'past_due', updated_at = now() FROM c WHERE t.id = c.id;

  WITH cut AS (
    SELECT t.id, t.status FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id AND s.status = 'past_due'
     WHERE s.grace_ends_at <= now()
       AND t.status NOT IN ('suspended', 'cancelled') AND t.deleted_at IS NULL
     -- both rows: a payment recorded meanwhile (it holds them) is skipped, and one committed meanwhile is seen
     FOR UPDATE OF t, s SKIP LOCKED),
  done AS (
    UPDATE tenants t SET status = 'suspended', suspended_at = now(), suspension_reason = 'انتهى الاشتراك ولم يُجدَّد',
           suspension_kind = 'unpaid', status_before_suspension = cut.status, updated_at = now()
      FROM cut WHERE t.id = cut.id RETURNING t.id)
  SELECT array_agg(id) INTO v_cut FROM done;
  IF v_cut IS NOT NULL THEN
    UPDATE tenant_members SET access_version = access_version + 1 WHERE tenant_id = ANY (v_cut);
  END IF;
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id) SELECT NULL, 'tenant.subscription_past_due', unnest(coalesce(v_due, '{}'));
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id) SELECT NULL, 'tenant.unpaid_suspended', unnest(coalesce(v_cut, '{}'));
  RETURN QUERY SELECT coalesce(cardinality(v_due), 0), coalesce(cardinality(v_cut), 0);
END $$;


ALTER FUNCTION public.expire_subscriptions(p_grace_days integer) OWNER TO app_definer;

--
-- Name: expire_trials(); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.expire_trials() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_ids uuid[];
BEGIN
  WITH due AS (
    SELECT t.id, t.status FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id AND s.status = 'trialing'
     WHERE s.trial_ends_at <= now() AND t.status NOT IN ('suspended', 'cancelled') AND t.deleted_at IS NULL
     FOR UPDATE OF t SKIP LOCKED),
  done AS (
    UPDATE tenants t SET status = 'suspended', suspended_at = now(), suspension_reason = 'انتهت الفترة التجريبية دون تفعيل خطة',
           suspension_kind = 'trial_ended', status_before_suspension = due.status, updated_at = now()
      FROM due WHERE t.id = due.id RETURNING t.id)
  SELECT array_agg(id) INTO v_ids FROM done;
  IF v_ids IS NULL THEN RETURN 0; END IF;
  UPDATE tenant_members SET access_version = access_version + 1 WHERE tenant_id = ANY (v_ids);
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id) SELECT NULL, 'tenant.trial_expired', unnest(v_ids);
  RETURN cardinality(v_ids);
END $$;


ALTER FUNCTION public.expire_trials() OWNER TO app_definer;

--
-- Name: file_in_use(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.file_in_use(p_file uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (SELECT 1 FROM gallery_items g WHERE g.image_file_id = p_file OR g.before_file_id = p_file)
      OR EXISTS (SELECT 1 FROM tenants t  WHERE t.logo_file_id = p_file)
      OR EXISTS (SELECT 1 FROM doctors d  WHERE d.photo_file_id = p_file)
      OR EXISTS (SELECT 1 FROM services s WHERE s.image_file_id = p_file)
      OR EXISTS (SELECT 1 FROM branches b WHERE b.photo_file_id = p_file)
      OR EXISTS (SELECT 1 FROM sites x    WHERE x.favicon_file_id = p_file OR x.share_file_id = p_file)
      OR EXISTS (SELECT 1 FROM posts p    WHERE p.cover_file_id = p_file)
      OR EXISTS (SELECT 1 FROM patient_files pf WHERE pf.file_id = p_file)
      OR EXISTS (SELECT 1 FROM patient_consents c WHERE c.signature_file_id = p_file)
      OR EXISTS (SELECT 1 FROM expenses e WHERE e.file_id = p_file)
$$;


ALTER FUNCTION public.file_in_use(p_file uuid) OWNER TO postgres;

--
-- Name: file_is_public(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.file_is_public(p_file uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT NOT EXISTS (SELECT 1 FROM files f WHERE f.id = p_file AND f.kind IN ('xray', 'clinical_photo', 'consent', 'document', 'invoice_pdf'))
     AND (EXISTS (SELECT 1 FROM gallery_items g WHERE g.is_published AND (g.image_file_id = p_file OR g.before_file_id = p_file))
       OR EXISTS (SELECT 1 FROM tenants t  WHERE t.logo_file_id = p_file AND t.deleted_at IS NULL)
       OR EXISTS (SELECT 1 FROM doctors d  WHERE d.photo_file_id = p_file AND d.is_active AND d.show_on_website)
       OR EXISTS (SELECT 1 FROM services s WHERE s.image_file_id = p_file AND s.is_active AND s.show_on_website)
       OR EXISTS (SELECT 1 FROM branches b WHERE b.photo_file_id = p_file AND b.is_active))
$$;


ALTER FUNCTION public.file_is_public(p_file uuid) OWNER TO postgres;

--
-- Name: gallery_items_consent_stamp(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.gallery_items_consent_stamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- new images are confirmed again (the API asks for it): the record names who confirmed these images, and when
  IF NEW.consent_confirmed AND (TG_OP = 'INSERT' OR NOT OLD.consent_confirmed OR NEW.image_file_id IS DISTINCT FROM OLD.image_file_id
                                OR NEW.before_file_id IS DISTINCT FROM OLD.before_file_id) THEN
    NEW.consent_confirmed_at := now();
    NEW.consent_confirmed_by := nullif(current_setting('app.member_id', true), '')::uuid;
  ELSIF NOT NEW.consent_confirmed THEN
    NEW.consent_confirmed_at := NULL;
    NEW.consent_confirmed_by := NULL;
  ELSE
    NEW.consent_confirmed_at := OLD.consent_confirmed_at; -- kept as first recorded
    NEW.consent_confirmed_by := OLD.consent_confirmed_by;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.gallery_items_consent_stamp() OWNER TO postgres;

--
-- Name: gallery_items_files_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.gallery_items_files_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.type = 'photo' THEN
    IF EXISTS (SELECT 1 FROM files WHERE id = NEW.image_file_id AND kind = 'case') THEN
      RAISE EXCEPTION 'a case image is not a photo' USING ERRCODE = 'check_violation', CONSTRAINT = 'gallery_items_case_files';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM files WHERE id IN (NEW.image_file_id, NEW.before_file_id) AND kind <> 'case') THEN
      RAISE EXCEPTION 'a case shows case images' USING ERRCODE = 'check_violation', CONSTRAINT = 'gallery_items_case_files';
    END IF;
    IF EXISTS (SELECT 1 FROM gallery_items g WHERE g.id <> NEW.id
                AND (g.image_file_id IN (NEW.image_file_id, NEW.before_file_id) OR g.before_file_id IN (NEW.image_file_id, NEW.before_file_id))) THEN
      RAISE EXCEPTION 'a case image belongs to one case' USING ERRCODE = 'check_violation', CONSTRAINT = 'gallery_items_case_files';
    END IF;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.gallery_items_files_guard() OWNER TO postgres;

--
-- Name: grantable_permissions(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.grantable_permissions() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT ARRAY[
    'branches:read','branches:write','settings:write','website:write','staff:manage',
    'patients:read','patients:write','patients:merge','patients:block','clinical:read','clinical:write','treatments:write:own',
    'appointments:read','appointments:write','appointments:write:own','appointments:override',
    'invoices:read','invoices:read:own','invoices:write','invoices:void',
    'payments:write','payments:refund','payments:reverse','payments:adjust','discounts:apply','discounts:approve',
    'expenses:read','expenses:write','expenses:approve','cash:operate','cash:reopen',
    'reports:read','reports:read:daily','reports:read:own','audit:read']
$$;


ALTER FUNCTION public.grantable_permissions() OWNER TO postgres;

--
-- Name: hard_delete_allowed(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.hard_delete_allowed() RETURNS boolean
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  IF coalesce(current_setting('app.allow_hard_delete', true), '') <> 'on' THEN RETURN false; END IF;
  RETURN current_user <> 'app_user'
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = session_user AND (r.rolsuper OR r.rolbypassrls));
END $$;


ALTER FUNCTION public.hard_delete_allowed() OWNER TO postgres;

--
-- Name: installments_plan_status(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.installments_plan_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE payment_plans pp SET status =
    CASE WHEN EXISTS (SELECT 1 FROM installments WHERE plan_id = pp.id AND status IN ('due','partially_paid')) THEN 'active' ELSE 'completed' END
  WHERE pp.id = NEW.plan_id AND pp.status IN ('active','completed');
  RETURN NULL;
END $$;


ALTER FUNCTION public.installments_plan_status() OWNER TO postgres;

--
-- Name: invitations_owner_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.invitations_owner_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF current_user <> 'app_user' THEN RETURN NEW; END IF;
  IF (TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id) AND is_owner_role(NEW.role_id) AND NOT acting_member_is_owner() THEN
    RAISE EXCEPTION 'only an owner invites an owner' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'owner_role_only';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.invitations_owner_guard() OWNER TO postgres;

--
-- Name: invoice_items_changed(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.invoice_items_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN PERFORM recalc_invoice(NEW.invoice_id); END IF;
  IF TG_OP <> 'INSERT' AND (TG_OP = 'DELETE' OR OLD.invoice_id <> NEW.invoice_id) THEN
    PERFORM recalc_invoice(OLD.invoice_id);
  END IF;
  RETURN NULL;
END $$;


ALTER FUNCTION public.invoice_items_changed() OWNER TO postgres;

--
-- Name: invoice_items_derive(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.invoice_items_derive() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.discount_type = 'percent' THEN
    NEW.discount_minor := (NEW.quantity * NEW.unit_price_minor * NEW.discount_bp + 5000) / 10000;
  END IF;
  IF NEW.discount_minor = 0 THEN NEW.discount_type := NULL; NEW.discount_bp := NULL; NEW.discount_reason := NULL; END IF;
  NEW.line_total_minor := NEW.quantity * NEW.unit_price_minor - NEW.discount_minor;
  RETURN NEW;
END $$;


ALTER FUNCTION public.invoice_items_derive() OWNER TO postgres;

--
-- Name: invoice_items_validate(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.invoice_items_validate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_inv uuid; v_status text; v_inv_patient uuid; v_visit_patient uuid;
BEGIN
  FOR v_inv IN SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.invoice_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.invoice_id END]) AS x WHERE x IS NOT NULL
  LOOP
    SELECT status INTO v_status FROM invoices WHERE id = v_inv FOR UPDATE;
    IF FOUND AND v_status <> 'draft' THEN
      RAISE EXCEPTION 'invoice % is %, lines can only change on a draft', v_inv, v_status USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF TG_OP <> 'DELETE' AND NEW.visit_procedure_id IS NOT NULL THEN
    SELECT v.patient_id INTO v_visit_patient
      FROM visit_procedures vp JOIN visits v ON v.id = vp.visit_id
     WHERE vp.id = NEW.visit_procedure_id
       FOR UPDATE OF vp;
    SELECT patient_id INTO v_inv_patient FROM invoices WHERE id = NEW.invoice_id;
    IF v_visit_patient IS NULL OR v_visit_patient IS DISTINCT FROM v_inv_patient THEN
      RAISE EXCEPTION 'procedure % belongs to another patient (or is not visible), not to the invoice''s patient', NEW.visit_procedure_id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'invoice_item_patient';
    END IF;
    IF visit_procedure_billed_elsewhere(NEW.visit_procedure_id, NEW.id) THEN
      RAISE EXCEPTION 'procedure % is already billed', NEW.visit_procedure_id USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.invoice_items_validate() OWNER TO postgres;

--
-- Name: invoices_derive(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.invoices_derive() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND patient_merge_only(TG_RELID, to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF; -- PATIENT-003 merge moves the patient only
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
      RAISE EXCEPTION 'invoice % cannot go back to draft', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'void' AND NEW.status <> 'void' THEN
      RAISE EXCEPTION 'a void invoice cannot be reopened' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'draft' AND (NEW.discount_minor <> OLD.discount_minor OR NEW.tax_minor <> OLD.tax_minor
        OR NEW.currency <> OLD.currency OR NEW.patient_id <> OLD.patient_id
        OR (NEW.discount_type, NEW.discount_bp, NEW.discount_reason, NEW.discount_status) IS DISTINCT FROM
           (OLD.discount_type, OLD.discount_bp, OLD.discount_reason, OLD.discount_status)) THEN
      RAISE EXCEPTION 'issued invoice % is locked (discount, tax, currency, patient)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.subtotal_minor := (SELECT coalesce(sum(line_total_minor), 0) FROM invoice_items WHERE invoice_id = NEW.id);
  IF NEW.status = 'draft' AND NEW.discount_type = 'percent' THEN
    NEW.discount_minor := (NEW.subtotal_minor * NEW.discount_bp + 5000) / 10000;  -- half up, follows the lines
  END IF;
  IF NEW.status = 'draft' AND NEW.discount_minor = 0 THEN NEW.discount_type := NULL; NEW.discount_bp := NULL; NEW.discount_reason := NULL; END IF;
  NEW.paid_minor     := (SELECT coalesce(sum(amount_minor - refunded_minor), 0) FROM payments
                         WHERE invoice_id = NEW.id AND status IN ('succeeded','partially_refunded','refunded'));
  NEW.adjusted_minor := (SELECT coalesce(sum(amount_minor), 0) FROM balance_adjustments WHERE invoice_id = NEW.id);
  NEW.total_minor    := NEW.subtotal_minor - NEW.discount_minor + NEW.tax_minor;
  IF NEW.status = 'void' AND (NEW.paid_minor > 0 OR NEW.adjusted_minor > 0) THEN
    RAISE EXCEPTION 'refund the % already paid before voiding invoice %', NEW.paid_minor, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status NOT IN ('draft','void') THEN
    NEW.status := CASE WHEN NEW.paid_minor + NEW.adjusted_minor >= NEW.total_minor THEN 'paid'   -- includes 100% discount and write-offs
                       WHEN NEW.paid_minor = 0 AND NEW.adjusted_minor = 0 THEN 'issued'
                       ELSE 'partially_paid' END;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.invoices_derive() OWNER TO postgres;

--
-- Name: invoices_discount_settled(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.invoices_discount_settled() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status <> 'draft' AND NEW.status <> 'void' AND NEW.discount_status IN ('pending', 'rejected') THEN
    RAISE EXCEPTION 'the discount on invoice % is %', NEW.id, NEW.discount_status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_discount_pending';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.invoices_discount_settled() OWNER TO postgres;

--
-- Name: invoices_guard_delete(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.invoices_guard_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status <> 'draft' AND NOT public.hard_delete_allowed() THEN
    RAISE EXCEPTION 'invoice % is %; void it instead of deleting', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;


ALTER FUNCTION public.invoices_guard_delete() OWNER TO postgres;

--
-- Name: invoices_lock_number(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.invoices_lock_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.currency <> (SELECT currency FROM tenants WHERE id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'an invoice is in the clinic currency' USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_clinic_currency';
    END IF;
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'an invoice starts as a draft' USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_locked';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'draft' AND (NEW.number, NEW.issue_date) IS DISTINCT FROM (OLD.number, OLD.issue_date) THEN
    RAISE EXCEPTION 'the number and date of an issued invoice do not change' USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_locked';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.invoices_lock_number() OWNER TO postgres;

--
-- Name: is_owner_role(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_owner_role(p_role uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (SELECT 1 FROM roles WHERE id = p_role AND key = 'owner' AND is_system)
$$;


ALTER FUNCTION public.is_owner_role(p_role uuid) OWNER TO postgres;

--
-- Name: is_reserved_slug(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_reserved_slug(p_slug text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT lower(p_slug) = ANY (ARRAY['www','app','api','admin','dashboard','mail','smtp','static','assets','cdn','docs',
    'help','support','status','blog','billing','pay','auth','login','signup','register','account','demo','test','dev',
    'staging','internal','root','system'])
$$;


ALTER FUNCTION public.is_reserved_slug(p_slug text) OWNER TO postgres;

--
-- Name: issue_invoice(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.issue_invoice(p_invoice uuid) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE inv invoices; s tenant_settings; v_tz text; v_year text; v_seq bigint; v_number text; v_taxable bigint;
BEGIN
  SELECT * INTO inv FROM invoices WHERE id = p_invoice FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'invoice not found' USING ERRCODE = 'no_data_found'; END IF;
  IF inv.status <> 'draft' THEN
    RAISE EXCEPTION 'invoice % is already %', p_invoice, inv.status USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_locked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM invoice_items WHERE invoice_id = p_invoice) THEN
    RAISE EXCEPTION 'an invoice needs at least one line' USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_empty';
  END IF;
  SELECT * INTO s FROM tenant_settings WHERE tenant_id = inv.tenant_id;
  SELECT timezone INTO v_tz FROM tenants WHERE id = inv.tenant_id;
  v_year := to_char(now() AT TIME ZONE coalesce(v_tz, 'Africa/Cairo'), 'YYYY');
  -- the counter row is locked until this transaction ends: concurrent issues queue, and a rollback gives the number back
  v_seq := next_tenant_counter('invoice:' || v_year);
  v_number := coalesce(s.invoice_prefix, 'INV') || '-' || v_year || '-' || lpad(v_seq::text, 5, '0');
  v_taxable := inv.subtotal_minor - inv.discount_minor;
  UPDATE invoices SET
    status = 'issued', number = v_number, issue_date = (now() AT TIME ZONE coalesce(v_tz, 'Africa/Cairo'))::date,
    -- tax rounded half up to the piastre
    tax_minor = (v_taxable * coalesce(s.tax_rate_bp, 0) + 5000) / 10000
  WHERE id = p_invoice;
  RETURN v_number;
END $$;


ALTER FUNCTION public.issue_invoice(p_invoice uuid) OWNER TO postgres;

--
-- Name: legal_pending(uuid, uuid, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.legal_pending(p_user uuid, p_tenant uuid, p_owner boolean) RETURNS TABLE(id uuid, kind text, version integer, title_ar text)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  WITH kinds AS (
    SELECT k FROM unnest(CASE WHEN p_owner THEN ARRAY['terms', 'privacy', 'dpa'] ELSE ARRAY['terms', 'privacy'] END) k),
  latest AS (
    SELECT DISTINCT ON (d.kind) d.id, d.kind, d.version, d.title_ar FROM legal_documents d JOIN kinds ON kinds.k = d.kind
    ORDER BY d.kind, d.version DESC),
  accepted AS (
    SELECT d.kind, max(d.version) AS version FROM legal_acceptances a JOIN legal_documents d ON d.id = a.document_id
    WHERE a.user_id = p_user AND (d.kind <> 'dpa' OR a.tenant_id = p_tenant)
    GROUP BY d.kind)
  SELECT l.id, l.kind, l.version, l.title_ar FROM latest l LEFT JOIN accepted acc ON acc.kind = l.kind
  WHERE acc.version IS NULL
     OR EXISTS (SELECT 1 FROM legal_documents n WHERE n.kind = l.kind AND n.version > acc.version AND n.requires_reacceptance)
  ORDER BY array_position(ARRAY['terms', 'privacy', 'dpa'], l.kind)
$$;


ALTER FUNCTION public.legal_pending(p_user uuid, p_tenant uuid, p_owner boolean) OWNER TO postgres;

--
-- Name: login_candidate(text, text); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.login_candidate(p_email text, p_phone text) RETURNS TABLE(id uuid, password_hash text, is_active boolean, email text, phone text, email_verified_at timestamp with time zone, phone_verified_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT u.id, u.password_hash, u.is_active, u.email::text, u.phone, u.email_verified_at, u.phone_verified_at
  FROM users u
  WHERE u.email = p_email::citext OR (p_phone IS NOT NULL AND u.phone = p_phone)
  ORDER BY (u.email = p_email::citext) DESC
  LIMIT 1
$$;


ALTER FUNCTION public.login_candidate(p_email text, p_phone text) OWNER TO app_definer;

--
-- Name: mark_no_shows(interval); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.mark_no_shows(p_grace interval DEFAULT '02:00:00'::interval) RETURNS integer
    LANGUAGE sql
    AS $$
  WITH x AS (
    UPDATE appointments SET status = 'no_show'
    WHERE status IN ('pending', 'confirmed') AND ends_at < now() - p_grace
    RETURNING 1)
  SELECT count(*)::int FROM x
$$;


ALTER FUNCTION public.mark_no_shows(p_grace interval) OWNER TO postgres;

--
-- Name: member_access_state(uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.member_access_state(p_member uuid) RETURNS TABLE(tenant_id uuid, status text, access_version integer, tenant_status text, sessions_revoked_at timestamp with time zone, user_active boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT m.tenant_id, m.status, m.access_version, t.status, u.sessions_revoked_at, u.is_active
  FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id JOIN users u ON u.id = m.user_id
  WHERE m.id = p_member
$$;


ALTER FUNCTION public.member_access_state(p_member uuid) OWNER TO app_definer;

--
-- Name: member_branch_ids(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.member_branch_ids() RETURNS uuid[]
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE v_member uuid := nullif(current_setting('app.member_id', true), '')::uuid; m record;
BEGIN
  IF v_member IS NULL THEN RETURN NULL; END IF;
  SELECT all_branches, status INTO m FROM tenant_members WHERE id = v_member AND tenant_id = current_tenant_id();
  IF NOT FOUND OR m.status <> 'active' THEN RETURN ARRAY[]::uuid[]; END IF;
  IF m.all_branches THEN RETURN NULL; END IF;
  RETURN coalesce((SELECT array_agg(branch_id) FROM member_branches WHERE member_id = v_member), ARRAY[]::uuid[]);
END $$;


ALTER FUNCTION public.member_branch_ids() OWNER TO postgres;

--
-- Name: member_branches_bump_access(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.member_branches_bump_access() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE tenant_members SET access_version = access_version + 1 WHERE id = coalesce(NEW.member_id, OLD.member_id);
  RETURN NULL;
END $$;


ALTER FUNCTION public.member_branches_bump_access() OWNER TO postgres;

--
-- Name: memberships_for_user(uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.memberships_for_user(p_user uuid) RETURNS TABLE(tenant_id uuid, slug public.citext, name_en text, name_ar text, tenant_status text, role_key text, member_status text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT t.id, t.slug, t.name_en, t.name_ar, t.status, r.key, m.status
  FROM tenant_members m
  JOIN tenants t ON t.id = m.tenant_id
  JOIN roles r ON r.id = m.role_id
  WHERE m.user_id = p_user
$$;


ALTER FUNCTION public.memberships_for_user(p_user uuid) OWNER TO app_definer;

--
-- Name: merge_patients(uuid, uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.merge_patients(p_survivor uuid, p_merged uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_member uuid := current_member_id();
  s patients; m patients; hs patient_medical_history; hm patient_medical_history;
  v_moved jsonb := '{}'; n int; t text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no clinic for this request' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_survivor = p_merged THEN
    RAISE EXCEPTION 'a record cannot be merged into itself' USING ERRCODE = 'check_violation', CONSTRAINT = 'patients_merge_self';
  END IF;
  -- both rows locked in one order, so two merges of the same pair cannot cross
  PERFORM 1 FROM patients WHERE tenant_id = v_tenant AND id IN (p_survivor, p_merged) ORDER BY id FOR UPDATE;
  SELECT * INTO s FROM patients WHERE tenant_id = v_tenant AND id = p_survivor AND deleted_at IS NULL;
  SELECT * INTO m FROM patients WHERE tenant_id = v_tenant AND id = p_merged AND deleted_at IS NULL;
  IF s.id IS NULL OR m.id IS NULL THEN RAISE EXCEPTION 'patient not found' USING ERRCODE = 'no_data_found'; END IF;
  IF s.merged_into_id IS NOT NULL OR m.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'one of the records is already merged' USING ERRCODE = 'check_violation', CONSTRAINT = 'patients_already_merged';
  END IF;

  PERFORM set_config('app.patient_merge', 'on', true);
  -- in this order: a row moves after the rows it is checked against (payment -> invoice, visit -> appointment)
  FOREACH t IN ARRAY ARRAY['appointments', 'invoices', 'payment_plans', 'payments', 'visits', 'treatment_plans', 'prescriptions', 'tooth_records', 'recalls', 'patient_files', 'patient_consents', 'lab_orders', 'reviews', 'waitlist_entries', 'notifications', 'patient_medical_history_versions'] LOOP
    EXECUTE format('UPDATE %I SET patient_id = $1 WHERE tenant_id = $2 AND patient_id = $3', t) USING p_survivor, v_tenant, p_merged;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN v_moved := v_moved || jsonb_build_object(t, n); END IF;
  END LOOP;

  -- CLR-15: the lists are combined; the survivor's flags and notes are kept (the merged ones stay in its versions)
  SELECT * INTO hs FROM patient_medical_history WHERE tenant_id = v_tenant AND patient_id = p_survivor;
  SELECT * INTO hm FROM patient_medical_history WHERE tenant_id = v_tenant AND patient_id = p_merged;
  IF hm.patient_id IS NOT NULL THEN
    IF hs.patient_id IS NULL THEN
      INSERT INTO patient_medical_history (tenant_id, patient_id, allergies, conditions, medications, is_pregnant, is_smoker, notes, updated_by)
      VALUES (v_tenant, p_survivor, hm.allergies, hm.conditions, hm.medications, hm.is_pregnant, hm.is_smoker, hm.notes, v_member);
    ELSE
      UPDATE patient_medical_history SET
        allergies = text_array_union(hs.allergies, hm.allergies), conditions = text_array_union(hs.conditions, hm.conditions),
        medications = text_array_union(hs.medications, hm.medications), updated_by = v_member, updated_at = now()
      WHERE tenant_id = v_tenant AND patient_id = p_survivor;
    END IF;
    DELETE FROM patient_medical_history WHERE tenant_id = v_tenant AND patient_id = p_merged;
    v_moved := v_moved || jsonb_build_object('patient_medical_history', 1);
  END IF;

  -- family links and earlier merges follow the survivor; the merged record leaves every list
  UPDATE patients SET guardian_patient_id = CASE WHEN id = p_survivor THEN NULL ELSE p_survivor END
   WHERE tenant_id = v_tenant AND guardian_patient_id = p_merged;
  UPDATE patients SET merged_into_id = p_survivor WHERE tenant_id = v_tenant AND merged_into_id = p_merged;
  UPDATE patients SET merged_into_id = p_survivor, merged_at = now(), updated_at = now() WHERE tenant_id = v_tenant AND id = p_merged;
  PERFORM set_config('app.patient_merge', '', true);
  RETURN v_moved;
END $_$;


ALTER FUNCTION public.merge_patients(p_survivor uuid, p_merged uuid) OWNER TO app_definer;

--
-- Name: next_tenant_counter(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.next_tenant_counter(p_key text) RETURNS bigint
    LANGUAGE sql
    AS $$
  INSERT INTO tenant_counters (tenant_id, key, value)
  VALUES (current_tenant_id(), p_key, 1)
  ON CONFLICT (tenant_id, key) DO UPDATE SET value = tenant_counters.value + 1
  RETURNING value
$$;


ALTER FUNCTION public.next_tenant_counter(p_key text) OWNER TO postgres;

--
-- Name: open_invitation(text); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.open_invitation(p_token_hash text) RETURNS TABLE(invitation_id uuid, tenant_id uuid, email text, role_id uuid, role_key text, role_name_ar text, branch_ids uuid[], job_title text, doctor_id uuid, expires_at timestamp with time zone, clinic_slug text, clinic_name_ar text, clinic_name_en text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT i.id, i.tenant_id, i.email::text, i.role_id, r.key, r.name_ar, i.branch_ids, i.job_title, i.doctor_id, i.expires_at,
         t.slug::text, t.name_ar, t.name_en
  FROM invitations i
  JOIN roles r ON r.id = i.role_id
  JOIN tenants t ON t.id = i.tenant_id
  WHERE i.token_hash = p_token_hash AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
    AND t.deleted_at IS NULL AND t.status <> 'cancelled'
$$;


ALTER FUNCTION public.open_invitation(p_token_hash text) OWNER TO app_definer;

--
-- Name: patient_consents_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.patient_consents_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_t record; v_file uuid;
BEGIN
  IF current_user <> 'app_user' THEN RETURN coalesce(NEW, OLD); END IF; -- migrations, seeds, patient merge, the erase
  IF TG_OP = 'INSERT' THEN
    SELECT title_ar, body_ar, reviewed_at, is_active INTO v_t FROM consent_templates WHERE id = NEW.template_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'consent text not found' USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'consent_template_missing';
    END IF;
    IF v_t.reviewed_at IS NULL THEN
      RAISE EXCEPTION 'a draft is reviewed before it is signed' USING ERRCODE = 'check_violation', CONSTRAINT = 'consent_template_draft';
    END IF;
    IF NOT v_t.is_active THEN
      RAISE EXCEPTION 'this consent text is archived' USING ERRCODE = 'check_violation', CONSTRAINT = 'consent_template_archived';
    END IF;
    IF EXISTS (SELECT 1 FROM consent_templates n JOIN consent_templates t ON t.id = NEW.template_id
               WHERE n.key = t.key AND n.version > t.version) THEN
      RAISE EXCEPTION 'a newer version of this consent text exists' USING ERRCODE = 'check_violation', CONSTRAINT = 'consent_template_outdated';
    END IF;
    v_file := coalesce(NEW.signature_file_id, NEW.paper_file_id);
    IF NOT EXISTS (SELECT 1 FROM files WHERE id = v_file AND kind = 'consent' AND is_private) THEN
      RAISE EXCEPTION 'the signature is a private consent file' USING ERRCODE = 'check_violation', CONSTRAINT = 'patient_consents_file';
    END IF;
    IF NEW.visit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM visits WHERE id = NEW.visit_id AND patient_id = NEW.patient_id) THEN
      RAISE EXCEPTION 'the visit is another patient''s' USING ERRCODE = 'check_violation', CONSTRAINT = 'patient_consents_visit';
    END IF;
    NEW.title_snapshot := v_t.title_ar;
    NEW.body_snapshot := v_t.body_ar;
    NEW.locale := 'ar';
    NEW.signed_at := now();
    NEW.revoked_at := NULL; NEW.revoked_by := NULL; NEW.revoke_reason := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a signed consent is never deleted' USING ERRCODE = 'check_violation', CONSTRAINT = 'patient_consents_locked';
  END IF;
  -- UPDATE: withdrawing it, once, is the only change
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
     OR (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.template_id, NEW.visit_id, NEW.treatment_plan_id, NEW.locale, NEW.body_snapshot, NEW.title_snapshot,
         NEW.signer_name, NEW.signer_relation, NEW.signature_file_id, NEW.paper_file_id, NEW.method, NEW.witness_member_id, NEW.recorded_by,
         NEW.signed_at, NEW.signed_ip)
        IS DISTINCT FROM
        (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.template_id, OLD.visit_id, OLD.treatment_plan_id, OLD.locale, OLD.body_snapshot, OLD.title_snapshot,
         OLD.signer_name, OLD.signer_relation, OLD.signature_file_id, OLD.paper_file_id, OLD.method, OLD.witness_member_id, OLD.recorded_by,
         OLD.signed_at, OLD.signed_ip) THEN
    RAISE EXCEPTION 'a signed consent is never changed; it can be withdrawn once' USING ERRCODE = 'check_violation', CONSTRAINT = 'patient_consents_locked';
  END IF;
  NEW.revoked_at := now();
  RETURN NEW;
END $$;


ALTER FUNCTION public.patient_consents_guard() OWNER TO postgres;

--
-- Name: patient_medical_history_version(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.patient_medical_history_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.allergies, NEW.conditions, NEW.medications, NEW.is_pregnant, NEW.is_smoker, NEW.notes)
       IS NOT DISTINCT FROM (OLD.allergies, OLD.conditions, OLD.medications, OLD.is_pregnant, OLD.is_smoker, OLD.notes) THEN
    RETURN NULL; -- a save that changed nothing is not a new version
  END IF;
  INSERT INTO patient_medical_history_versions (tenant_id, patient_id, allergies, conditions, medications, is_pregnant, is_smoker, notes, saved_by, saved_at)
  VALUES (NEW.tenant_id, NEW.patient_id, NEW.allergies, NEW.conditions, NEW.medications, NEW.is_pregnant, NEW.is_smoker, NEW.notes, NEW.updated_by, NEW.updated_at);
  RETURN NULL;
END $$;


ALTER FUNCTION public.patient_medical_history_version() OWNER TO postgres;

--
-- Name: patient_merge_counts(uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.patient_merge_counts(p_patient uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE v_tenant uuid := current_tenant_id(); v jsonb := '{}'; n int; t text;
BEGIN
  IF v_tenant IS NULL OR NOT EXISTS (SELECT 1 FROM patients WHERE id = p_patient AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'patient not found' USING ERRCODE = 'no_data_found';
  END IF;
  FOREACH t IN ARRAY ARRAY['appointments', 'invoices', 'payment_plans', 'payments', 'visits', 'treatment_plans', 'prescriptions', 'tooth_records', 'recalls', 'patient_files', 'patient_consents', 'lab_orders', 'reviews', 'waitlist_entries', 'notifications', 'patient_medical_history_versions'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = $1 AND patient_id = $2', t) INTO n USING v_tenant, p_patient;
    IF n > 0 THEN v := v || jsonb_build_object(t, n); END IF;
  END LOOP;
  RETURN v;
END $_$;


ALTER FUNCTION public.patient_merge_counts(p_patient uuid) OWNER TO app_definer;

--
-- Name: patient_merge_only(oid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.patient_merge_only(p_rel oid, o jsonb, n jsonb) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT current_user = 'app_definer' AND coalesce(current_setting('app.patient_merge', true), '') = 'on'
     AND (o - 'patient_id' - 'updated_at' - g) = (n - 'patient_id' - 'updated_at' - g)
  FROM (SELECT coalesce(array_agg(attname::text), '{}') AS g FROM pg_attribute WHERE attrelid = p_rel AND attgenerated = 's') x
$$;


ALTER FUNCTION public.patient_merge_only(p_rel oid, o jsonb, n jsonb) OWNER TO postgres;

--
-- Name: payment_plans_check_totals(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.payment_plans_check_totals() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_plan uuid; p record; v_sum bigint; v_count int;
BEGIN
  -- one function for both tables; fields are read through jsonb because the two row types differ
  IF TG_TABLE_NAME = 'payment_plans' THEN v_plan := NEW.id;
  ELSE v_plan := coalesce(to_jsonb(NEW) ->> 'plan_id', to_jsonb(OLD) ->> 'plan_id')::uuid;
  END IF;
  SELECT total_minor, down_payment_minor, installments_count INTO p FROM payment_plans WHERE id = v_plan;
  IF NOT FOUND THEN RETURN NULL; END IF;  -- the plan itself was deleted in this transaction
  SELECT coalesce(sum(amount_minor), 0), count(*) INTO v_sum, v_count FROM installments WHERE plan_id = v_plan;
  IF p.down_payment_minor + v_sum <> p.total_minor OR v_count <> p.installments_count THEN
    RAISE EXCEPTION 'installments (% x %, sum %) plus down payment % do not add up to the plan total %',
      v_count, p.installments_count, v_sum, p.down_payment_minor, p.total_minor USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;


ALTER FUNCTION public.payment_plans_check_totals() OWNER TO postgres;

--
-- Name: payment_plans_validate(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.payment_plans_validate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE inv record;
BEGIN
  IF NEW.invoice_id IS NOT NULL THEN
    SELECT currency, patient_id, status, total_minor INTO inv FROM invoices WHERE id = NEW.invoice_id;
    IF inv.currency <> NEW.currency OR inv.patient_id <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment plan currency/patient does not match the invoice' USING ERRCODE = 'check_violation';
    END IF;
    IF inv.status IN ('draft','void') THEN
      RAISE EXCEPTION 'an installment plan needs an issued invoice (this one is %)', inv.status USING ERRCODE = 'check_violation';
    END IF;
    IF inv.total_minor <> NEW.total_minor THEN
      RAISE EXCEPTION 'payment plan total % differs from the invoice total %', NEW.total_minor, inv.total_minor
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.payment_plans_validate() OWNER TO postgres;

--
-- Name: payments_changed(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.payments_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT x.inv, x.inst FROM (VALUES
             (NEW.invoice_id, NEW.installment_id), (OLD.invoice_id, OLD.installment_id)) AS x(inv, inst)
  LOOP
    IF r.inv IS NOT NULL THEN PERFORM recalc_invoice(r.inv); END IF;
    IF r.inst IS NOT NULL THEN
      UPDATE installments s SET
        paid_minor = least(s.amount_minor, (SELECT coalesce(sum(amount_minor - refunded_minor), 0) FROM payments
                     WHERE installment_id = r.inst AND status IN ('succeeded','partially_refunded','refunded')))
      WHERE s.id = r.inst;
      UPDATE installments s SET
        status  = CASE WHEN s.status = 'waived' THEN 'waived'
                       WHEN s.paid_minor = 0 THEN 'due'
                       WHEN s.paid_minor >= s.amount_minor THEN 'paid'
                       ELSE 'partially_paid' END,
        paid_at = CASE WHEN s.paid_minor >= s.amount_minor THEN coalesce(s.paid_at, now()) END
      WHERE s.id = r.inst;
      UPDATE payment_plans pp SET status =
        CASE WHEN EXISTS (SELECT 1 FROM installments WHERE plan_id = pp.id AND status IN ('due','partially_paid'))
             THEN 'active' ELSE 'completed' END
      WHERE pp.id = (SELECT plan_id FROM installments WHERE id = r.inst) AND pp.status IN ('active','completed');
    END IF;
  END LOOP;
  RETURN NULL;
END $$;


ALTER FUNCTION public.payments_changed() OWNER TO postgres;

--
-- Name: payments_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.payments_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND patient_merge_only(TG_RELID, to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF; -- PATIENT-003 merge moves the patient only
  IF TG_OP = 'DELETE' THEN
    IF NOT public.hard_delete_allowed() THEN
      RAISE EXCEPTION 'payment % cannot be deleted; refund it instead', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'pending' THEN
    IF NEW.status = 'pending' OR NEW.status IN ('succeeded','failed') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'a pending payment can only succeed or fail (got %)', NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.tenant_id, NEW.branch_id, NEW.patient_id, NEW.invoice_id, NEW.appointment_id, NEW.installment_id, NEW.amount_minor,
      NEW.currency, NEW.method, NEW.paid_at, NEW.received_by, NEW.provider, NEW.provider_ref, NEW.idempotency_key, NEW.created_at, NEW.reference)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.branch_id, OLD.patient_id, OLD.invoice_id, OLD.appointment_id, OLD.installment_id, OLD.amount_minor,
      OLD.currency, OLD.method, OLD.paid_at, OLD.received_by, OLD.provider, OLD.provider_ref, OLD.idempotency_key, OLD.created_at, OLD.reference) THEN
    RAISE EXCEPTION 'payment % is recorded and cannot be changed; refund it instead', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('failed', 'reversed') AND (NEW.status, NEW.refunded_minor) IS DISTINCT FROM (OLD.status, OLD.refunded_minor) THEN
    RAISE EXCEPTION 'a % payment cannot change', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'reversed' AND OLD.status <> 'reversed' THEN
    IF OLD.status <> 'succeeded' OR OLD.refunded_minor > 0 THEN
      RAISE EXCEPTION 'only a payment with no refunds can be reversed' USING ERRCODE = 'check_violation', CONSTRAINT = 'payments_not_reversible';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.reversed_at, NEW.reversed_by, NEW.reversal_reason) IS DISTINCT FROM (OLD.reversed_at, OLD.reversed_by, OLD.reversal_reason) THEN
    RAISE EXCEPTION 'the reversal fields are set only when reversing' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('succeeded','partially_refunded','refunded') AND NEW.status NOT IN ('succeeded','partially_refunded','refunded') THEN
    RAISE EXCEPTION 'payment % cannot go from % to %', OLD.id, OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.payments_guard() OWNER TO postgres;

--
-- Name: payments_validate(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.payments_validate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE inv record; pl record; v_appt_patient uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS NOT NULL AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM 1 FROM invoices WHERE id = OLD.invoice_id FOR UPDATE;
  END IF;
  IF NEW.invoice_id IS NOT NULL THEN
    SELECT currency, status, patient_id, branch_id INTO inv FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
    -- not visible to this caller (another branch): never pay an invoice the caller cannot see
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice % not found', NEW.invoice_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF inv.currency <> NEW.currency THEN
      RAISE EXCEPTION 'payment currency % differs from invoice currency %', NEW.currency, inv.currency
        USING ERRCODE = 'check_violation';
    END IF;
    IF inv.patient_id <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment patient does not match the invoice patient' USING ERRCODE = 'check_violation';
    END IF;
    IF inv.branch_id <> NEW.branch_id THEN
      RAISE EXCEPTION 'payment branch does not match the invoice branch' USING ERRCODE = 'check_violation';
    END IF;
    IF inv.status IN ('draft','void') AND NEW.status IN ('succeeded','partially_refunded')
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.invoice_id IS DISTINCT FROM NEW.invoice_id) THEN
      RAISE EXCEPTION 'cannot pay a % invoice', inv.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.installment_id IS NOT NULL THEN
    SELECT p.currency, p.patient_id, p.invoice_id INTO pl
    FROM installments s JOIN payment_plans p ON p.id = s.plan_id
    WHERE s.id = NEW.installment_id FOR UPDATE OF s;
    IF NOT FOUND THEN RAISE EXCEPTION 'installment % not found', NEW.installment_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF pl.currency <> NEW.currency OR pl.patient_id <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment currency/patient does not match the installment plan' USING ERRCODE = 'check_violation';
    END IF;
    IF pl.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
      RAISE EXCEPTION 'an installment payment must be made against its plan''s invoice' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.appointment_id IS NOT NULL THEN
    SELECT patient_id INTO v_appt_patient FROM appointments WHERE id = NEW.appointment_id;
    IF v_appt_patient IS NOT NULL AND v_appt_patient <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment patient does not match the appointment patient' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.payments_validate() OWNER TO postgres;

--
-- Name: platform_activate(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_activate(p_actor uuid, p_tenant uuid, p_cycle text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_sub text;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  IF p_cycle NOT IN ('monthly', 'yearly') THEN
    RAISE EXCEPTION 'a subscription is monthly or yearly' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_cycle';
  END IF;
  SELECT status INTO v_sub FROM subscriptions WHERE tenant_id = p_tenant AND status <> 'cancelled' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinic not found' USING ERRCODE = 'no_data_found', CONSTRAINT = 'platform_clinic_missing'; END IF;
  IF v_sub NOT IN ('trialing', 'past_due', 'suspended') THEN
    RAISE EXCEPTION 'the subscription is already %', v_sub USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_already_active';
  END IF;
  UPDATE subscriptions SET status = 'active', billing_cycle = p_cycle, current_period_start = now(),
         current_period_end = now() + CASE p_cycle WHEN 'yearly' THEN interval '1 year' ELSE interval '1 month' END, updated_at = now()
   WHERE tenant_id = p_tenant AND status <> 'cancelled';
  UPDATE tenants SET status = 'active', suspended_at = NULL, suspension_reason = NULL, suspension_kind = NULL, status_before_suspension = NULL, updated_at = now()
   WHERE id = p_tenant AND (status IN ('onboarding', 'trialing', 'past_due') OR (status = 'suspended' AND suspension_kind = 'trial_ended'));
  -- a manually suspended clinic stays suspended, but returns as active when reactivated
  UPDATE tenants SET status_before_suspension = 'active', updated_at = now() WHERE id = p_tenant AND status = 'suspended';
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (p_actor, 'tenant.activated', p_tenant, jsonb_build_object('cycle', p_cycle, 'from', v_sub));
END $$;


ALTER FUNCTION public.platform_activate(p_actor uuid, p_tenant uuid, p_cycle text) OWNER TO app_definer;

--
-- Name: platform_add_note(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_add_note(p_actor uuid, p_tenant uuid, p_body text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'clinic not found' USING ERRCODE = 'no_data_found', CONSTRAINT = 'platform_clinic_missing';
  END IF;
  INSERT INTO platform_tenant_notes (tenant_id, author_user_id, body) VALUES (p_tenant, p_actor, btrim(p_body));
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id) VALUES (p_actor, 'tenant.note_added', p_tenant);
END $$;


ALTER FUNCTION public.platform_add_note(p_actor uuid, p_tenant uuid, p_body text) OWNER TO app_definer;

--
-- Name: platform_assert_admin(uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_assert_admin(p_actor uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_actor AND platform_role = 'super_admin' AND is_active) THEN
    RAISE EXCEPTION 'not a platform admin' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'platform_admin_only';
  END IF;
END $$;


ALTER FUNCTION public.platform_assert_admin(p_actor uuid) OWNER TO app_definer;

--
-- Name: platform_change_plan(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_change_plan(p_actor uuid, p_tenant uuid, p_plan uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_before uuid;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  IF NOT EXISTS (SELECT 1 FROM plans WHERE id = p_plan) THEN
    RAISE EXCEPTION 'plan not found' USING ERRCODE = 'no_data_found', CONSTRAINT = 'platform_plan_missing';
  END IF;
  SELECT plan_id INTO v_before FROM subscriptions WHERE tenant_id = p_tenant AND status <> 'cancelled' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinic not found' USING ERRCODE = 'no_data_found', CONSTRAINT = 'platform_clinic_missing'; END IF;
  IF v_before = p_plan THEN RETURN; END IF;
  UPDATE subscriptions SET plan_id = p_plan, updated_at = now() WHERE tenant_id = p_tenant AND status <> 'cancelled';
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (p_actor, 'tenant.plan_changed', p_tenant, jsonb_build_object('from', v_before, 'to', p_plan));
END $$;


ALTER FUNCTION public.platform_change_plan(p_actor uuid, p_tenant uuid, p_plan uuid) OWNER TO app_definer;

--
-- Name: platform_clinics(uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_clinics(p_actor uuid) RETURNS TABLE(id uuid, slug text, name_ar text, name_en text, status text, created_at timestamp with time zone, suspended_at timestamp with time zone, suspension_reason text, suspension_kind text, plan_code text, plan_name_ar text, subscription_status text, trial_ends_at timestamp with time zone, billing_cycle text, current_period_end timestamp with time zone, members integer, branches integer, patients integer, appointments_30d integer, last_login_at timestamp with time zone, owner_email text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN QUERY
  SELECT t.id, t.slug::text, t.name_ar, t.name_en, t.status, t.created_at, t.suspended_at, t.suspension_reason, t.suspension_kind,
         p.code, p.name_ar, s.status, s.trial_ends_at, s.billing_cycle, s.current_period_end,
         (SELECT count(*)::int FROM tenant_members m WHERE m.tenant_id = t.id AND m.status = 'active'),
         (SELECT count(*)::int FROM branches b WHERE b.tenant_id = t.id AND b.is_active),
         (SELECT count(*)::int FROM patients pa WHERE pa.tenant_id = t.id AND pa.deleted_at IS NULL),
         (SELECT count(*)::int FROM appointments a WHERE a.tenant_id = t.id AND a.starts_at > now() - interval '30 days' AND a.starts_at <= now()),
         (SELECT max(u.last_login_at) FROM tenant_members m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = t.id),
         (SELECT u.email::text FROM tenant_members m JOIN roles r ON r.id = m.role_id JOIN users u ON u.id = m.user_id
           WHERE m.tenant_id = t.id AND r.key = 'owner' AND m.status = 'active' ORDER BY m.created_at LIMIT 1)
  FROM tenants t
  LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status <> 'cancelled'
  LEFT JOIN plans p ON p.id = s.plan_id
  ORDER BY t.created_at DESC;
END $$;


ALTER FUNCTION public.platform_clinics(p_actor uuid) OWNER TO app_definer;

--
-- Name: platform_create_plan(uuid, jsonb, inet); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_create_plan(p_actor uuid, p_plan jsonb, p_ip inet) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_code text := lower(btrim(p_plan->>'code'));
  v_name text := btrim(p_plan->>'name_ar');
  v_id   uuid;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  IF v_code IS NULL OR v_code !~ '^[a-z0-9][a-z0-9_-]{1,39}$' THEN
    RAISE EXCEPTION 'plan code is a Latin slug' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_plan_code';
  END IF;
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'plan name is 2 to 60 characters' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_plan_name';
  END IF;
  INSERT INTO plans (code, name_en, name_ar, price_monthly_minor, price_yearly_minor, trial_days, limits, features, is_public, sort_order)
  VALUES (v_code, v_name, v_name, (p_plan->>'price_monthly_minor')::bigint, (p_plan->>'price_yearly_minor')::bigint,
          coalesce((p_plan->>'trial_days')::int, 14), coalesce(p_plan->'limits', '{}'), coalesce(p_plan->'features', '{}'),
          coalesce((p_plan->>'is_public')::boolean, true), (SELECT coalesce(max(sort_order), 0) + 1 FROM plans))
  RETURNING id INTO v_id;
  INSERT INTO platform_audit_log (actor_user_id, action, details, ip) VALUES (p_actor, 'plan.created', jsonb_build_object('plan', v_code, 'values', p_plan), p_ip);
  RETURN v_id;
END $_$;


ALTER FUNCTION public.platform_create_plan(p_actor uuid, p_plan jsonb, p_ip inet) OWNER TO app_definer;

--
-- Name: platform_deletions(uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_deletions(p_actor uuid) RETURNS TABLE(tenant_id uuid, requested_at timestamp with time zone, delete_after timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN QUERY SELECT t.id, t.deleted_at, t.delete_after FROM tenants t WHERE t.delete_after IS NOT NULL ORDER BY t.delete_after;
END $$;


ALTER FUNCTION public.platform_deletions(p_actor uuid) OWNER TO app_definer;

--
-- Name: platform_extend_trial(uuid, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_extend_trial(p_actor uuid, p_tenant uuid, p_until timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_before timestamptz;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  IF p_until <= now() OR p_until > now() + interval '366 days' THEN
    RAISE EXCEPTION 'a trial ends after now and within a year' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_trial_range';
  END IF;
  SELECT trial_ends_at INTO v_before FROM subscriptions WHERE tenant_id = p_tenant AND status = 'trialing' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the clinic is not on a trial' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_not_trialing';
  END IF;
  UPDATE subscriptions SET trial_ends_at = p_until, updated_at = now() WHERE tenant_id = p_tenant AND status = 'trialing';
  -- a clinic the trial's end suspended opens again (a manual suspension stays)
  UPDATE tenants SET status = status_before_suspension, suspended_at = NULL, suspension_reason = NULL, suspension_kind = NULL,
         status_before_suspension = NULL, updated_at = now()
   WHERE id = p_tenant AND status = 'suspended' AND suspension_kind = 'trial_ended';
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (p_actor, 'tenant.trial_extended', p_tenant, jsonb_build_object('from', v_before, 'to', p_until));
END $$;


ALTER FUNCTION public.platform_extend_trial(p_actor uuid, p_tenant uuid, p_until timestamp with time zone) OWNER TO app_definer;

--
-- Name: platform_grace(uuid, uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_grace(p_actor uuid, p_tenant uuid) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN (SELECT grace_ends_at FROM subscriptions WHERE tenant_id = p_tenant AND status = 'past_due');
END $$;


ALTER FUNCTION public.platform_grace(p_actor uuid, p_tenant uuid) OWNER TO app_definer;

--
-- Name: platform_leads(uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_leads(p_actor uuid) RETURNS TABLE(id uuid, kind text, full_name text, phone text, email text, clinic_name text, city text, message text, source text, status text, billing_cycle text, clinic_id uuid, plan_code text, plan_name_ar text, created_at timestamp with time zone, updated_at timestamp with time zone, updated_by_name text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN QUERY
  SELECT l.id, l.kind, l.full_name, l.phone, l.email::text, l.clinic_name, l.city, l.message, l.source, l.status, l.billing_cycle,
         l.clinic_id, p.code, p.name_ar,
         l.created_at, l.updated_at, u.full_name
  FROM leads l LEFT JOIN plans p ON p.id = l.plan_id LEFT JOIN users u ON u.id = l.updated_by
  ORDER BY l.created_at DESC
  LIMIT 500;
END $$;


ALTER FUNCTION public.platform_leads(p_actor uuid) OWNER TO app_definer;

--
-- Name: platform_notes(uuid, uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_notes(p_actor uuid, p_tenant uuid) RETURNS TABLE(id uuid, body text, created_at timestamp with time zone, author text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN QUERY SELECT n.id, n.body, n.created_at, u.full_name FROM platform_tenant_notes n JOIN users u ON u.id = n.author_user_id
   WHERE n.tenant_id = p_tenant ORDER BY n.created_at DESC LIMIT 100;
END $$;


ALTER FUNCTION public.platform_notes(p_actor uuid, p_tenant uuid) OWNER TO app_definer;

--
-- Name: platform_payments(uuid, uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_payments(p_actor uuid, p_tenant uuid) RETURNS TABLE(id uuid, number text, period_start date, period_end date, amount_minor bigint, currency character, status text, method text, reference text, billing_cycle text, note text, paid_at timestamp with time zone, recorded_by_name text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN QUERY
    SELECT i.id, i.number, i.period_start, i.period_end, i.amount_minor, i.currency, i.status, i.provider, i.provider_ref, i.billing_cycle, i.note,
           i.paid_at, u.full_name::text
      FROM platform_invoices i LEFT JOIN users u ON u.id = i.recorded_by
     WHERE i.tenant_id = p_tenant ORDER BY i.issued_at DESC, i.number DESC LIMIT 200;
END $$;


ALTER FUNCTION public.platform_payments(p_actor uuid, p_tenant uuid) OWNER TO app_definer;

--
-- Name: platform_plan_clinics(uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_plan_clinics(p_actor uuid) RETURNS TABLE(plan_id uuid, clinics integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN QUERY
  SELECT s.plan_id, count(*)::int FROM subscriptions s WHERE s.status <> 'cancelled' GROUP BY s.plan_id;
END $$;


ALTER FUNCTION public.platform_plan_clinics(p_actor uuid) OWNER TO app_definer;

--
-- Name: platform_publish_legal(uuid, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_publish_legal(p_actor uuid, p_kind text, p_title text, p_body text, p_reaccept boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_id uuid; v_version int;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  PERFORM pg_advisory_xact_lock(hashtext('legal_documents'), hashtext(p_kind));
  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM legal_documents WHERE kind = p_kind;
  INSERT INTO legal_documents (kind, version, title_ar, body_ar, requires_reacceptance, published_by)
  VALUES (p_kind, v_version, btrim(p_title), btrim(p_body), coalesce(p_reaccept, false), p_actor) RETURNING id INTO v_id;
  INSERT INTO platform_audit_log (actor_user_id, action, details)
  VALUES (p_actor, 'legal.published', jsonb_build_object('kind', p_kind, 'version', v_version, 'requires_reacceptance', coalesce(p_reaccept, false)));
  RETURN v_id;
END $$;


ALTER FUNCTION public.platform_publish_legal(p_actor uuid, p_kind text, p_title text, p_body text, p_reaccept boolean) OWNER TO app_definer;

--
-- Name: platform_reactivate(uuid, uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_reactivate(p_actor uuid, p_tenant uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_back text; v_kind text;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  SELECT status_before_suspension, suspension_kind INTO v_back, v_kind FROM tenants WHERE id = p_tenant AND status = 'suspended' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the clinic is not suspended' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_status';
  END IF;
  -- a trial that has ended would be suspended again at once: extend it or activate the subscription instead
  IF EXISTS (SELECT 1 FROM subscriptions WHERE tenant_id = p_tenant AND status = 'trialing' AND trial_ends_at <= now()) THEN
    RAISE EXCEPTION 'the trial has ended' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_trial_ended';
  END IF;
  IF v_kind = 'unpaid' AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE tenant_id = p_tenant AND status = 'active' AND current_period_end > now()) THEN
    RAISE EXCEPTION 'the subscription is unpaid' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_unpaid';
  END IF;
  IF v_kind = 'unpaid' THEN v_back := 'active'; END IF;
  UPDATE subscriptions SET grace_ends_at = NULL, updated_at = now() WHERE tenant_id = p_tenant AND status = 'past_due';
  UPDATE tenants SET status = v_back, suspended_at = NULL, suspension_reason = NULL, suspension_kind = NULL, status_before_suspension = NULL, updated_at = now()
   WHERE id = p_tenant;
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (p_actor, 'tenant.reactivated', p_tenant, jsonb_build_object('to', v_back));
END $$;


ALTER FUNCTION public.platform_reactivate(p_actor uuid, p_tenant uuid) OWNER TO app_definer;

--
-- Name: platform_record(uuid, text, uuid, jsonb, inet); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_record(p_actor uuid, p_action text, p_tenant uuid, p_details jsonb, p_ip inet) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details, ip) VALUES (p_actor, p_action, p_tenant, coalesce(p_details, '{}'), p_ip);
END $$;


ALTER FUNCTION public.platform_record(p_actor uuid, p_action text, p_tenant uuid, p_details jsonb, p_ip inet) OWNER TO app_definer;

--
-- Name: platform_record_payment(uuid, uuid, bigint, text, text, text, text, uuid, inet); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_record_payment(p_actor uuid, p_tenant uuid, p_amount_minor bigint, p_cycle text, p_method text, p_reference text, p_note text, p_key uuid, p_ip inet) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_sub subscriptions%ROWTYPE;
  v_currency char(3);
  v_start timestamptz;
  v_end timestamptz;
  v_id uuid;
  v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
BEGIN
  PERFORM platform_assert_admin(p_actor);
  IF p_cycle NOT IN ('monthly', 'yearly') THEN
    RAISE EXCEPTION 'a subscription is monthly or yearly' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_cycle';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'the amount must be positive' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_payment_amount';
  END IF;
  -- the clinic, then its subscription, locked (the order expire_subscriptions takes them): two payments for one clinic
  -- are recorded one after the other, and the worker never suspends a clinic whose payment is being recorded
  PERFORM 1 FROM tenants WHERE id = p_tenant FOR UPDATE;
  SELECT * INTO v_sub FROM subscriptions WHERE tenant_id = p_tenant AND status <> 'cancelled' FOR UPDATE;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant AND (deleted_at IS NOT NULL OR status = 'cancelled')) THEN
    RAISE EXCEPTION 'clinic not found' USING ERRCODE = 'no_data_found', CONSTRAINT = 'platform_clinic_missing';
  END IF;
  -- a repeated submission of the same form (checked under the lock, so a double click that raced waits and finds the
  -- first one): the payment it already recorded. A key used for another clinic fails on the unique index.
  IF p_key IS NOT NULL THEN
    SELECT id INTO v_id FROM platform_invoices WHERE idempotency_key = p_key AND tenant_id = p_tenant;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;
  SELECT currency INTO v_currency FROM plans WHERE id = v_sub.plan_id;
  -- renewing early extends the paid period; otherwise (trial, past due, suspended) the new one starts now
  v_start := CASE WHEN v_sub.status = 'active' AND v_sub.current_period_end > now() THEN v_sub.current_period_end ELSE now() END;
  v_end := v_start + CASE p_cycle WHEN 'yearly' THEN interval '1 year' ELSE interval '1 month' END;

  INSERT INTO platform_invoices (tenant_id, subscription_id, number, period_start, period_end, amount_minor, currency, status, provider, provider_ref,
                                 paid_at, billing_cycle, note, recorded_by, idempotency_key)
  VALUES (p_tenant, v_sub.id, 'P' || to_char(now() AT TIME ZONE 'Africa/Cairo', 'YYYY') || '-' || lpad(nextval('platform_invoice_number_seq')::text, 6, '0'),
          (v_start AT TIME ZONE 'Africa/Cairo')::date, (v_end AT TIME ZONE 'Africa/Cairo')::date, p_amount_minor, coalesce(v_currency, 'EGP'), 'paid',
          p_method, v_ref, now(), p_cycle, nullif(btrim(coalesce(p_note, '')), ''), p_actor, p_key)
  RETURNING id INTO v_id;

  UPDATE subscriptions SET status = 'active', billing_cycle = p_cycle, grace_ends_at = NULL,
         current_period_start = CASE WHEN v_start > now() THEN current_period_start ELSE v_start END, current_period_end = v_end, updated_at = now()
   WHERE id = v_sub.id;
  -- the clinic works again: a trial that ended or an unpaid subscription lifts its suspension; a manual one stays (it
  -- was suspended for another reason) but comes back as active when the platform reactivates it
  UPDATE tenants SET status = 'active', suspended_at = NULL, suspension_reason = NULL, suspension_kind = NULL, status_before_suspension = NULL, updated_at = now()
   WHERE id = p_tenant AND (status IN ('onboarding', 'trialing', 'past_due') OR (status = 'suspended' AND suspension_kind IN ('trial_ended', 'unpaid')));
  UPDATE tenants SET status_before_suspension = 'active', updated_at = now() WHERE id = p_tenant AND status = 'suspended';

  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details, ip)
  VALUES (p_actor, 'tenant.payment_recorded', p_tenant, jsonb_build_object('invoice', v_id, 'amount_minor', p_amount_minor, 'cycle', p_cycle,
          'method', p_method, 'from', v_sub.status, 'until', v_end), p_ip);
  RETURN v_id;
END $$;


ALTER FUNCTION public.platform_record_payment(p_actor uuid, p_tenant uuid, p_amount_minor bigint, p_cycle text, p_method text, p_reference text, p_note text, p_key uuid, p_ip inet) OWNER TO app_definer;

--
-- Name: platform_restore_clinic(uuid, uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_restore_clinic(p_actor uuid, p_tenant uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_back text;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  SELECT status_before_cancellation INTO v_back FROM tenants
   WHERE id = p_tenant AND status = 'cancelled' AND delete_after IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the clinic is not waiting for deletion' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_status';
  END IF;
  UPDATE tenants SET status = coalesce(v_back, 'active'), status_before_cancellation = NULL, deleted_at = NULL, delete_after = NULL,
         deletion_requested_by = NULL, updated_at = now()
   WHERE id = p_tenant;
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (p_actor, 'tenant.restored', p_tenant, jsonb_build_object('to', coalesce(v_back, 'active')));
END $$;


ALTER FUNCTION public.platform_restore_clinic(p_actor uuid, p_tenant uuid) OWNER TO app_definer;

--
-- Name: platform_set_billing_instructions(uuid, text, inet); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_set_billing_instructions(p_actor uuid, p_text text, p_ip inet) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  IF btrim(coalesce(p_text, '')) = '' THEN
    DELETE FROM platform_settings WHERE key = 'billing_instructions';
  ELSE
    INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('billing_instructions', btrim(p_text), now(), p_actor)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now(), updated_by = p_actor;
  END IF;
  INSERT INTO platform_audit_log (actor_user_id, action, details, ip) VALUES (p_actor, 'billing.instructions_updated', '{}', p_ip);
END $$;


ALTER FUNCTION public.platform_set_billing_instructions(p_actor uuid, p_text text, p_ip inet) OWNER TO app_definer;

--
-- Name: platform_set_lead_status(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_set_lead_status(p_actor uuid, p_lead uuid, p_status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_old text;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  SELECT status INTO v_old FROM leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead not found' USING ERRCODE = 'no_data_found', CONSTRAINT = 'lead_not_found';
  END IF;
  IF v_old = p_status THEN RETURN; END IF;
  UPDATE leads SET status = p_status, updated_at = now(), updated_by = p_actor WHERE id = p_lead;
  INSERT INTO platform_audit_log (actor_user_id, action, details)
  VALUES (p_actor, 'lead.status', jsonb_build_object('lead_id', p_lead, 'from', v_old, 'to', p_status));
END $$;


ALTER FUNCTION public.platform_set_lead_status(p_actor uuid, p_lead uuid, p_status text) OWNER TO app_definer;

--
-- Name: platform_suspend(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_suspend(p_actor uuid, p_tenant uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_status text;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  SELECT status INTO v_status FROM tenants WHERE id = p_tenant AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinic not found' USING ERRCODE = 'no_data_found', CONSTRAINT = 'platform_clinic_missing'; END IF;
  IF v_status IN ('suspended', 'cancelled') THEN
    RAISE EXCEPTION 'the clinic is already %', v_status USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_status';
  END IF;
  UPDATE tenants SET status = 'suspended', suspended_at = now(), suspension_reason = btrim(p_reason), suspension_kind = 'manual',
         status_before_suspension = v_status, updated_at = now()
   WHERE id = p_tenant;
  UPDATE tenant_members SET access_version = access_version + 1 WHERE tenant_id = p_tenant;
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (p_actor, 'tenant.suspended', p_tenant, jsonb_build_object('reason', btrim(p_reason), 'from', v_status));
END $$;


ALTER FUNCTION public.platform_suspend(p_actor uuid, p_tenant uuid, p_reason text) OWNER TO app_definer;

--
-- Name: platform_update_plan(uuid, uuid, jsonb, inet); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.platform_update_plan(p_actor uuid, p_plan uuid, p_changes jsonb, p_ip inet) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_code text;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  SELECT code INTO v_code FROM plans WHERE id = p_plan FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan not found' USING ERRCODE = 'no_data_found', CONSTRAINT = 'platform_plan_missing'; END IF;
  UPDATE plans SET
    name_ar             = coalesce(p_changes->>'name_ar', name_ar),
    price_monthly_minor = coalesce((p_changes->>'price_monthly_minor')::bigint, price_monthly_minor),
    price_yearly_minor  = coalesce((p_changes->>'price_yearly_minor')::bigint, price_yearly_minor),
    trial_days          = coalesce((p_changes->>'trial_days')::int, trial_days),
    limits              = limits || coalesce(p_changes->'limits', '{}'),
    features            = features || coalesce(p_changes->'features', '{}'),
    is_public           = coalesce((p_changes->>'is_public')::boolean, is_public),
    updated_at          = now()
  WHERE id = p_plan;
  INSERT INTO platform_audit_log (actor_user_id, action, details, ip) VALUES (p_actor, 'plan.updated', jsonb_build_object('plan', v_code, 'changes', p_changes), p_ip);
END $$;


ALTER FUNCTION public.platform_update_plan(p_actor uuid, p_plan uuid, p_changes jsonb, p_ip inet) OWNER TO app_definer;

--
-- Name: prescription_items_validate(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.prescription_items_validate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM prescriptions WHERE id = NEW.prescription_id AND issued_at = now()) THEN
    RAISE EXCEPTION 'prescription % is already issued', NEW.prescription_id USING ERRCODE = 'check_violation', CONSTRAINT = 'prescriptions_issued';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.prescription_items_validate() OWNER TO postgres;

--
-- Name: prescriptions_validate(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.prescriptions_validate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM visits WHERE id = NEW.visit_id AND patient_id = NEW.patient_id AND doctor_id = NEW.doctor_id) THEN
    RAISE EXCEPTION 'prescription patient/doctor must match its visit' USING ERRCODE = 'check_violation', CONSTRAINT = 'prescriptions_visit_match';
  END IF;
  IF NEW.replaces_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prescriptions WHERE id = NEW.replaces_id AND patient_id = NEW.patient_id) THEN
    RAISE EXCEPTION 'a correction replaces a prescription of the same patient' USING ERRCODE = 'check_violation', CONSTRAINT = 'prescriptions_visit_match';
  END IF;
  NEW.issued_at := now();
  RETURN NEW;
END $$;


ALTER FUNCTION public.prescriptions_validate() OWNER TO postgres;

--
-- Name: provision_tenant(text, text, text, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.provision_tenant(p_slug text, p_name_ar text, p_name_en text, p_owner_user uuid, p_root_domain text, p_plan_code text DEFAULT 'pro'::text, p_locale text DEFAULT 'ar'::text) RETURNS TABLE(tenant_id uuid, owner_member_id uuid, branch_id uuid, hostname text)
    LANGUAGE plpgsql
    AS $_$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_plan   record;
  v_member uuid;
  v_branch uuid;
  v_host   text;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'set app.tenant_id to the new clinic id before provisioning' USING ERRCODE = 'check_violation';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$' THEN
    RAISE EXCEPTION 'invalid subdomain "%": 3-63 lowercase letters, digits or dashes', p_slug USING ERRCODE = 'check_violation';
  END IF;
  IF is_reserved_slug(p_slug) THEN
    RAISE EXCEPTION 'subdomain "%" is reserved', p_slug USING ERRCODE = 'check_violation';
  END IF;
  SELECT id, trial_days INTO v_plan FROM plans WHERE code = p_plan_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown plan %', p_plan_code USING ERRCODE = 'foreign_key_violation';
  END IF;

  INSERT INTO tenants (id, slug, name_ar, name_en, status, onboarding_step, default_locale)
  VALUES (v_tenant, p_slug, nullif(trim(p_name_ar), ''), nullif(trim(p_name_en), ''), 'trialing', 1, p_locale);

  INSERT INTO tenant_settings (tenant_id) VALUES (v_tenant);

  INSERT INTO subscriptions (tenant_id, plan_id, status, trial_ends_at)
  VALUES (v_tenant, v_plan.id, 'trialing', now() + make_interval(days => v_plan.trial_days));

  -- the owner holds every permission; the owner creates the clinic's other roles (H4)
  INSERT INTO roles (tenant_id, key, name_en, name_ar, is_system, permissions)
  VALUES (v_tenant, 'owner', 'Owner', 'المالك', true, ARRAY['*']);

  INSERT INTO tenant_members (tenant_id, user_id, role_id)
  SELECT v_tenant, p_owner_user, r.id FROM roles r WHERE r.tenant_id = v_tenant AND r.key = 'owner'
  RETURNING id INTO v_member;

  INSERT INTO branches (tenant_id, name_ar, name_en, slug, is_main)
  VALUES (v_tenant, 'الفرع الرئيسي', 'Main branch', 'main', true)
  RETURNING id INTO v_branch;

  INSERT INTO sites (tenant_id, template_id, status, draft_theme, show_powered_by)
  SELECT v_tenant, t.id, 'draft', t.default_theme, true FROM templates t WHERE t.is_active ORDER BY t.code LIMIT 1;

  v_host := p_slug || '.' || lower(p_root_domain);
  INSERT INTO domains (tenant_id, hostname, type, status, is_primary, verified_at)
  VALUES (v_tenant, v_host, 'subdomain', 'active', true, now());

  INSERT INTO tenant_counters (tenant_id, key, value) VALUES (v_tenant, 'patient_file', 0);

  -- H9: starter consent drafts, reviewed by the owner before use
  PERFORM seed_consent_drafts(v_tenant);

  INSERT INTO audit_log (tenant_id, actor_type, actor_user_id, action, entity_type, entity_id)
  VALUES (v_tenant, 'member', p_owner_user, 'tenant.signup', 'tenant', v_tenant);

  RETURN QUERY SELECT v_tenant, v_member, v_branch, v_host;
END $_$;


ALTER FUNCTION public.provision_tenant(p_slug text, p_name_ar text, p_name_en text, p_owner_user uuid, p_root_domain text, p_plan_code text, p_locale text) OWNER TO postgres;

--
-- Name: public_image_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.public_image_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_col text; v_file uuid;
BEGIN
  FOREACH v_col IN ARRAY TG_ARGV LOOP
    v_file := (to_jsonb(NEW) ->> v_col)::uuid;
    IF v_file IS NOT NULL AND EXISTS (SELECT 1 FROM files
         WHERE id = v_file AND kind IN ('xray', 'clinical_photo', 'consent', 'document', 'invoice_pdf')) THEN
      RAISE EXCEPTION 'a patient''s file cannot be shown on the website (%.%)', TG_TABLE_NAME, v_col
        USING ERRCODE = 'check_violation', CONSTRAINT = 'public_image_kind';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;


ALTER FUNCTION public.public_image_guard() OWNER TO postgres;

--
-- Name: purge_auth_data(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.purge_auth_data() RETURNS TABLE(otp_deleted integer, tokens_deleted integer, events_deleted integer)
    LANGUAGE plpgsql
    AS $$
DECLARE a int; b int; c int;
BEGIN
  DELETE FROM otp_codes WHERE created_at < now() - interval '1 day'; GET DIAGNOSTICS a = ROW_COUNT;
  DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'
                                OR revoked_at < now() - interval '7 days'; GET DIAGNOSTICS b = ROW_COUNT;
  DELETE FROM auth_events WHERE created_at < now() - interval '180 days'; GET DIAGNOSTICS c = ROW_COUNT;
  RETURN QUERY SELECT a, b, c;
END $$;


ALTER FUNCTION public.purge_auth_data() OWNER TO postgres;

--
-- Name: purge_clinic(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.purge_clinic(p_tenant uuid) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
DECLARE v_t record; v_users uuid[]; v_user uuid; v_table text;
BEGIN
  SELECT id, slug, name_ar, name_en, deleted_at FROM tenants INTO v_t
   WHERE id = p_tenant AND status = 'cancelled' AND delete_after IS NOT NULL AND delete_after <= now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM platform_invoices WHERE tenant_id = p_tenant) THEN
    INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
    SELECT NULL, 'tenant.purge_blocked', p_tenant, jsonb_build_object('reason', 'platform_invoices')
     WHERE NOT EXISTS (SELECT 1 FROM platform_audit_log WHERE tenant_id = p_tenant AND action = 'tenant.purge_blocked');
    RETURN false;
  END IF;
  SELECT array_agg(DISTINCT user_id) INTO v_users FROM tenant_members WHERE tenant_id = p_tenant;
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (NULL, 'tenant.purged', p_tenant, jsonb_build_object('clinic_id', v_t.id, 'slug', v_t.slug, 'name_ar', v_t.name_ar,
          'name_en', v_t.name_en, 'requested_at', v_t.deleted_at));
  PERFORM set_config('app.allow_hard_delete', 'on', true);
  SET CONSTRAINTS ALL DEFERRED;
  DELETE FROM tenants WHERE id = p_tenant;
  -- not every table cascades from tenants (refunds hang off payments, for one): sweep every table with a tenant_id,
  -- tables added later included; the platform's own records keep their history (their link was set to NULL)
  -- (by oid, never by name: the catalogue is read in no particular order)
  FOR v_table IN SELECT c.oid::regclass::text FROM pg_class c
                 JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
                 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
                   AND c.relname NOT IN ('platform_audit_log', 'webhook_events')
                   AND has_table_privilege(c.oid, 'DELETE') -- the rest cascade (legal acceptances, platform notes)
  LOOP
    EXECUTE format('DELETE FROM %s WHERE tenant_id = $1', v_table) USING p_tenant;
  END LOOP;
  SET CONSTRAINTS ALL IMMEDIATE; -- every link checked now: nothing of the clinic is left half-deleted
  FOREACH v_user IN ARRAY coalesce(v_users, '{}') LOOP
    BEGIN
      DELETE FROM users u WHERE u.id = v_user AND u.platform_role IS NULL
         AND NOT EXISTS (SELECT 1 FROM tenant_members m WHERE m.user_id = u.id);
    EXCEPTION WHEN foreign_key_violation THEN
      NULL; -- referenced by a platform record (e.g. a note they wrote as an admin earlier): the account stays
    END;
  END LOOP;
  PERFORM set_config('app.allow_hard_delete', '', true);
  RETURN true;
END $_$;


ALTER FUNCTION public.purge_clinic(p_tenant uuid) OWNER TO postgres;

--
-- Name: purge_orphan_images(interval); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.purge_orphan_images(p_age interval DEFAULT '1 day'::interval) RETURNS TABLE(tenant_id uuid, id uuid, variant_widths integer[])
    LANGUAGE sql
    AS $$
  DELETE FROM files f
  WHERE f.kind IN ('gallery', 'logo', 'image', 'case') AND f.created_at < now() - p_age AND NOT file_in_use(f.id)
  RETURNING f.tenant_id, f.id, f.variant_widths
$$;


ALTER FUNCTION public.purge_orphan_images(p_age interval) OWNER TO postgres;

--
-- Name: recalc_invoice(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.recalc_invoice(p_invoice uuid) RETURNS void
    LANGUAGE sql
    AS $$
  UPDATE invoices SET updated_at = now() WHERE id = p_invoice
$$;


ALTER FUNCTION public.recalc_invoice(p_invoice uuid) OWNER TO postgres;

--
-- Name: refunds_changed(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.refunds_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_pay uuid := coalesce(NEW.payment_id, OLD.payment_id);
BEGIN
  UPDATE payments p SET refunded_minor = (SELECT coalesce(sum(amount_minor), 0) FROM refunds WHERE payment_id = v_pay)
  WHERE p.id = v_pay;
  UPDATE payments p SET status = CASE WHEN p.refunded_minor = 0 THEN 'succeeded'
                                      WHEN p.refunded_minor >= p.amount_minor THEN 'refunded'
                                      ELSE 'partially_refunded' END
  WHERE p.id = v_pay AND p.status IN ('succeeded','partially_refunded','refunded');
  RETURN NULL;
END $$;


ALTER FUNCTION public.refunds_changed() OWNER TO postgres;

--
-- Name: refunds_validate(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.refunds_validate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE p record; v_inv uuid; v_other bigint;
BEGIN
  SELECT invoice_id INTO v_inv FROM payments WHERE id = NEW.payment_id;
  IF v_inv IS NOT NULL THEN PERFORM 1 FROM invoices WHERE id = v_inv FOR UPDATE; END IF;
  SELECT status, amount_minor, branch_id, method INTO p FROM payments WHERE id = NEW.payment_id FOR UPDATE;
  IF p.status NOT IN ('succeeded','partially_refunded') THEN
    RAISE EXCEPTION 'only a succeeded payment can be refunded (status %)', p.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'refunds_payment_not_refundable';
  END IF;
  SELECT coalesce(sum(amount_minor), 0) INTO v_other FROM refunds WHERE payment_id = NEW.payment_id AND id <> NEW.id;
  IF v_other + NEW.amount_minor > p.amount_minor THEN
    RAISE EXCEPTION 'refunds (% + %) exceed the payment %', v_other, NEW.amount_minor, p.amount_minor
      USING ERRCODE = 'check_violation', CONSTRAINT = 'refunds_exceed_payment';
  END IF;
  NEW.branch_id := p.branch_id; -- the money goes back where it was taken (cash days are per branch, CASH-*)
  NEW.method := coalesce(NEW.method, p.method); -- the API always names it (CLR-05: it may differ); older callers did not
  RETURN NEW;
END $$;


ALTER FUNCTION public.refunds_validate() OWNER TO postgres;

--
-- Name: release_all_expired_holds(); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.release_all_expired_holds() RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH x AS (
    UPDATE appointments SET status = 'expired'
    WHERE status = 'held' AND hold_expires_at < now()
    RETURNING 1)
  SELECT count(*)::int FROM x
$$;


ALTER FUNCTION public.release_all_expired_holds() OWNER TO app_definer;

--
-- Name: release_expired_holds(uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.release_expired_holds(p_doctor uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH x AS (
    UPDATE appointments SET status = 'expired'
    WHERE tenant_id = current_tenant_id() AND status = 'held' AND hold_expires_at < now()
      AND (p_doctor IS NULL OR doctor_id = p_doctor)
    RETURNING 1)
  SELECT count(*)::int FROM x
$$;


ALTER FUNCTION public.release_expired_holds(p_doctor uuid) OWNER TO app_definer;

--
-- Name: report_attendance(date, date, uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.report_attendance(p_from date, p_to date, p_branch uuid DEFAULT NULL::uuid, p_doctor uuid DEFAULT NULL::uuid) RETURNS TABLE(branch_id uuid, doctor_id uuid, status text, n bigint)
    LANGUAGE sql STABLE
    AS $$
  SELECT a.branch_id, a.doctor_id, a.status, count(*)
  FROM appointments a JOIN branches b ON b.id = a.branch_id
  WHERE a.status NOT IN ('held', 'expired')
    AND a.starts_at >= ((p_from - 1)::timestamp AT TIME ZONE 'UTC') AND a.starts_at < ((p_to + 2)::timestamp AT TIME ZONE 'UTC')
    AND (a.starts_at AT TIME ZONE coalesce(b.timezone, clinic_timezone()))::date BETWEEN p_from AND p_to
    AND (p_branch IS NULL OR a.branch_id = p_branch) AND (p_doctor IS NULL OR a.doctor_id = p_doctor)
  GROUP BY a.branch_id, a.doctor_id, a.status
$$;


ALTER FUNCTION public.report_attendance(p_from date, p_to date, p_branch uuid, p_doctor uuid) OWNER TO postgres;

--
-- Name: report_expenses(date, date, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.report_expenses(p_from date, p_to date, p_branch uuid DEFAULT NULL::uuid) RETURNS TABLE(branch_id uuid, day date, category_id uuid, method text, status text, amount bigint, n bigint)
    LANGUAGE sql STABLE
    AS $$
  SELECT e.branch_id, e.spent_on, e.category_id, e.payment_method, e.status, sum(e.amount_minor)::bigint, count(*)
  FROM expenses e
  WHERE e.spent_on BETWEEN p_from AND p_to AND e.status <> 'void' AND (p_branch IS NULL OR e.branch_id = p_branch)
  GROUP BY e.branch_id, e.spent_on, e.category_id, e.payment_method, e.status
$$;


ALTER FUNCTION public.report_expenses(p_from date, p_to date, p_branch uuid) OWNER TO postgres;

--
-- Name: report_money(date, date, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.report_money(p_from date, p_to date, p_branch uuid DEFAULT NULL::uuid) RETURNS TABLE(branch_id uuid, day date, kind text, method text, amount bigint, n bigint)
    LANGUAGE sql STABLE
    AS $$
  WITH w AS (SELECT tz, (p_from::timestamp AT TIME ZONE tz) AS t0, ((p_to + 1)::timestamp AT TIME ZONE tz) AS t1
             FROM (SELECT clinic_timezone() AS tz) z)
  SELECT i.branch_id, i.issue_date, 'invoiced', NULL::text, sum(i.total_minor)::bigint, count(*)
  FROM invoices i
  WHERE i.status IN ('issued', 'partially_paid', 'paid') AND i.issue_date BETWEEN p_from AND p_to
    AND (p_branch IS NULL OR i.branch_id = p_branch)
  GROUP BY i.branch_id, i.issue_date
  UNION ALL
  SELECT p.branch_id, (p.paid_at AT TIME ZONE w.tz)::date, 'payment', p.method, sum(p.amount_minor)::bigint, count(*)
  FROM payments p, w
  WHERE p.status IN ('succeeded', 'partially_refunded', 'refunded') AND p.paid_at >= w.t0 AND p.paid_at < w.t1
    AND (p_branch IS NULL OR p.branch_id = p_branch)
  GROUP BY p.branch_id, 2, p.method
  UNION ALL
  SELECT r.branch_id, (r.refunded_at AT TIME ZONE w.tz)::date, 'refund', r.method, sum(r.amount_minor)::bigint, count(*)
  FROM refunds r, w
  WHERE r.refunded_at >= w.t0 AND r.refunded_at < w.t1 AND (p_branch IS NULL OR r.branch_id = p_branch)
  GROUP BY r.branch_id, 2, r.method
  UNION ALL
  SELECT i.branch_id, (a.created_at AT TIME ZONE w.tz)::date, 'adjustment', a.kind, sum(a.amount_minor)::bigint, count(*)
  FROM balance_adjustments a JOIN invoices i ON i.id = a.invoice_id, w
  WHERE a.created_at >= w.t0 AND a.created_at < w.t1 AND (p_branch IS NULL OR i.branch_id = p_branch)
  GROUP BY i.branch_id, 2, a.kind
$$;


ALTER FUNCTION public.report_money(p_from date, p_to date, p_branch uuid) OWNER TO postgres;

--
-- Name: report_new_patients(date, date, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.report_new_patients(p_from date, p_to date, p_branch uuid DEFAULT NULL::uuid) RETURNS TABLE(branch_id uuid, day date, n bigint)
    LANGUAGE sql STABLE
    AS $$
  WITH first_in_window AS (
    SELECT DISTINCT ON (v.patient_id) v.id, v.patient_id, v.branch_id, v.visit_at,
      (v.visit_at AT TIME ZONE coalesce(b.timezone, clinic_timezone()))::date AS day
    FROM visits v JOIN branches b ON b.id = v.branch_id
    WHERE v.visit_at >= (p_from - 2)::timestamptz AND v.visit_at < (p_to + 3)::timestamptz
    ORDER BY v.patient_id, v.visit_at, v.id
  )
  SELECT f.branch_id, f.day, count(*)
  FROM first_in_window f
  WHERE f.day BETWEEN p_from AND p_to AND (p_branch IS NULL OR f.branch_id = p_branch)
    AND NOT EXISTS (SELECT 1 FROM visits e WHERE e.patient_id = f.patient_id
                      AND (e.visit_at < f.visit_at OR (e.visit_at = f.visit_at AND e.id < f.id)))
  GROUP BY f.branch_id, f.day
$$;


ALTER FUNCTION public.report_new_patients(p_from date, p_to date, p_branch uuid) OWNER TO postgres;

--
-- Name: report_outstanding(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.report_outstanding(p_branch uuid DEFAULT NULL::uuid) RETURNS TABLE(patient_id uuid, branch_id uuid, balance bigint, invoices bigint, oldest date)
    LANGUAGE sql STABLE
    AS $$
  SELECT i.patient_id, i.branch_id, sum(i.balance_minor)::bigint, count(*), min(i.issue_date)
  FROM invoices i
  WHERE i.status IN ('issued', 'partially_paid') AND i.balance_minor > 0 AND (p_branch IS NULL OR i.branch_id = p_branch)
  GROUP BY i.patient_id, i.branch_id
$$;


ALTER FUNCTION public.report_outstanding(p_branch uuid) OWNER TO postgres;

--
-- Name: report_overdue_installments(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.report_overdue_installments(p_branch uuid DEFAULT NULL::uuid) RETURNS TABLE(installment_id uuid, invoice_id uuid, branch_id uuid, patient_id uuid, seq integer, due_date date, remaining bigint, days_overdue integer)
    LANGUAGE sql STABLE
    AS $$
  SELECT s.id, i.id, i.branch_id, i.patient_id, s.seq, s.due_date, (s.amount_minor - s.paid_minor)::bigint,
         business_date(now(), current_tenant_id()) - s.due_date
  FROM installments s JOIN payment_plans pp ON pp.id = s.plan_id JOIN invoices i ON i.id = pp.invoice_id
  WHERE s.status IN ('due', 'partially_paid') AND pp.status = 'active' AND s.due_date < business_date(now(), current_tenant_id())
    AND (p_branch IS NULL OR i.branch_id = p_branch)
$$;


ALTER FUNCTION public.report_overdue_installments(p_branch uuid) OWNER TO postgres;

--
-- Name: report_procedures(date, date, uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.report_procedures(p_from date, p_to date, p_branch uuid DEFAULT NULL::uuid, p_doctor uuid DEFAULT NULL::uuid) RETURNS TABLE(branch_id uuid, doctor_id uuid, amount bigint, n bigint)
    LANGUAGE sql STABLE
    AS $$
  SELECT v.branch_id, vp.doctor_id, sum(vp.price_minor)::bigint, count(*)
  FROM visit_procedures vp JOIN visits v ON v.id = vp.visit_id JOIN branches b ON b.id = v.branch_id
  WHERE v.visit_at >= ((p_from - 1)::timestamp AT TIME ZONE 'UTC') AND v.visit_at < ((p_to + 2)::timestamp AT TIME ZONE 'UTC')
    AND (v.visit_at AT TIME ZONE coalesce(b.timezone, clinic_timezone()))::date BETWEEN p_from AND p_to
    AND (p_branch IS NULL OR v.branch_id = p_branch) AND (p_doctor IS NULL OR vp.doctor_id = p_doctor)
  GROUP BY v.branch_id, vp.doctor_id
$$;


ALTER FUNCTION public.report_procedures(p_from date, p_to date, p_branch uuid, p_doctor uuid) OWNER TO postgres;

--
-- Name: request_clinic_deletion(uuid, uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.request_clinic_deletion(p_user uuid, p_tenant uuid) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_status text; v_after timestamptz := now() + interval '90 days';
BEGIN
  IF p_tenant IS DISTINCT FROM current_tenant_id()
     OR p_user IS DISTINCT FROM nullif(current_setting('app.user_id', true), '')::uuid
     OR NOT EXISTS (SELECT 1 FROM tenant_members m JOIN roles r ON r.id = m.role_id
                     WHERE m.user_id = p_user AND m.tenant_id = p_tenant AND m.status = 'active' AND r.key = 'owner') THEN
    RAISE EXCEPTION 'only the clinic owner deletes the clinic' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'clinic_owner_only';
  END IF;
  SELECT status INTO v_status FROM tenants WHERE id = p_tenant FOR UPDATE;
  IF v_status IN ('suspended', 'cancelled') THEN
    RAISE EXCEPTION 'the clinic is %', v_status USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_status';
  END IF;
  UPDATE tenants SET status = 'cancelled', status_before_cancellation = v_status, deleted_at = now(), delete_after = v_after,
         deletion_requested_by = p_user, updated_at = now()
   WHERE id = p_tenant;
  UPDATE tenant_members SET access_version = access_version + 1 WHERE tenant_id = p_tenant;
  -- no actor: the owner's account may itself be erased with the clinic; the request is named in the details
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (NULL, 'tenant.deletion_requested', p_tenant, jsonb_build_object('requested_by', p_user, 'delete_after', v_after));
  RETURN v_after;
END $$;


ALTER FUNCTION public.request_clinic_deletion(p_user uuid, p_tenant uuid) OWNER TO app_definer;

--
-- Name: resolve_tenant_by_host(text); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.resolve_tenant_by_host(p_host text) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT d.tenant_id FROM domains d
  JOIN tenants t ON t.id = d.tenant_id
  WHERE d.hostname = p_host::citext
    AND d.status IN ('verified','active')
    AND t.status IN ('trialing','active','past_due')
    AND t.deleted_at IS NULL
  LIMIT 1
$$;


ALTER FUNCTION public.resolve_tenant_by_host(p_host text) OWNER TO app_definer;

--
-- Name: role_assignable(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.role_assignable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id)
     AND EXISTS (SELECT 1 FROM roles WHERE id = NEW.role_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'an archived role is not given to anyone' USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_archived';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.role_assignable() OWNER TO postgres;

--
-- Name: roles_bump_access(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.roles_bump_access() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.permissions IS DISTINCT FROM OLD.permissions THEN
    UPDATE tenant_members SET access_version = access_version + 1 WHERE role_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;


ALTER FUNCTION public.roles_bump_access() OWNER TO postgres;

--
-- Name: roles_default_discount(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.roles_default_discount() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.is_system AND NEW.max_discount_bp = 0 THEN NEW.max_discount_bp := default_role_discount_bp(NEW.key); END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.roles_default_discount() OWNER TO postgres;

--
-- Name: roles_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.roles_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE r roles; bad text;
BEGIN
  IF current_user <> 'app_user' THEN RETURN coalesce(NEW, OLD); END IF;   -- migrations and seeds
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'the owner role is not deleted' USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_owner_fixed';
    END IF;
    RETURN OLD;
  END IF;
  r := NEW;
  IF TG_OP = 'INSERT' AND r.is_system THEN
    -- sign-up creates the owner role, with every permission; no other built-in role exists
    IF r.key <> 'owner' OR r.permissions <> ARRAY['*'] THEN
      RAISE EXCEPTION 'only the owner role is built in' USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_owner_fixed';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.is_system OR r.is_system) THEN
    -- the owner role is fixed (only its discount limit columns may change)
    IF (r.key, r.is_system, r.permissions, r.name_ar, r.name_en, r.archived_at) IS DISTINCT FROM
       (OLD.key, OLD.is_system, OLD.permissions, OLD.name_ar, OLD.name_en, OLD.archived_at) THEN
      RAISE EXCEPTION 'the owner role is fixed' USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_owner_fixed';
    END IF;
    RETURN NEW;
  END IF;
  -- any other role: a key the API generates (kept for life), catalogue permissions only
  IF (TG_OP = 'INSERT' AND r.key NOT LIKE 'custom-%') OR (TG_OP = 'UPDATE' AND r.key <> OLD.key) THEN
    RAISE EXCEPTION 'a role keeps the key it was given' USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_custom_key';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'an archived role is not changed' USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_archived';
  END IF;
  SELECT p INTO bad FROM unnest(r.permissions) p WHERE NOT p = ANY (grantable_permissions()) LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'permission % cannot be given to a role', bad USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_permission_unknown';
  END IF;
  NEW.permissions := ARRAY(SELECT DISTINCT p FROM unnest(r.permissions) p ORDER BY p);
  NEW.updated_at := now();
  RETURN NEW;
END $$;


ALTER FUNCTION public.roles_guard() OWNER TO postgres;

--
-- Name: roles_own_role_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.roles_own_role_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF current_user <> 'app_user' OR NEW.permissions IS NOT DISTINCT FROM OLD.permissions THEN RETURN NEW; END IF;
  IF current_member_id() IS NULL THEN
    RAISE EXCEPTION 'role permissions change only on a member''s request' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'own_role';
  END IF;
  IF NOT acting_member_is_owner()
     AND EXISTS (SELECT 1 FROM tenant_members WHERE id = current_member_id() AND role_id = OLD.id) THEN
    RAISE EXCEPTION 'a member does not change their own role' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'own_role';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.roles_own_role_guard() OWNER TO postgres;

--
-- Name: seed_consent_drafts(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.seed_consent_drafts(p_tenant uuid) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE v_n int;
BEGIN
  IF EXISTS (SELECT 1 FROM consent_templates WHERE tenant_id = p_tenant) THEN RETURN 0; END IF;
  INSERT INTO consent_templates (tenant_id, key, version, title_ar, body_ar)
  SELECT p_tenant, d.key, 1, d.title, d.body FROM (VALUES
    ('general', 'موافقة على الكشف والعلاج',
     E'أوافق على أن يقوم طبيب العيادة بفحص أسناني وفمي، وعلى إجراء الأشعة اللازمة للتشخيص، وعلى العلاج الذي يشرحه لي الطبيب.\n\n'
     || E'شرح لي الطبيب حالتي والعلاج المقترح والبدائل المتاحة، وأُتيحت لي فرصة السؤال وأُجيب عن أسئلتي.\n\n'
     || E'أقررت للطبيب بحالتي الصحية والأدوية التي أتناولها والحساسية التي أعرفها، وأتعهد بإبلاغه بأي تغيير.\n\n'
     || 'أعلم أن لي الحق في التوقف عن العلاج في أي وقت.'),
    ('extraction', 'موافقة على خلع سن',
     E'أوافق على خلع السن/الأسنان التي حددها الطبيب، بعد أن شرح لي سبب الخلع والبدائل المتاحة.\n\n'
     || E'أعلم أن من الآثار المحتملة بعد الخلع: ألمًا أو تورمًا أو نزيفًا بسيطًا، وقد يحدث التهاب في مكان الخلع، وفي حالات قليلة تنميل مؤقت أو دائم في الشفة أو اللسان.\n\n'
     || 'أتعهد باتباع تعليمات الطبيب بعد الخلع وبالعودة إلى العيادة عند حدوث أي مضاعفات.'),
    ('anesthesia', 'موافقة على التخدير الموضعي',
     E'أوافق على استخدام التخدير الموضعي أثناء العلاج.\n\n'
     || E'أعلم أن التخدير قد يسبب تنميلًا مؤقتًا، ونادرًا: ألمًا أو كدمة في مكان الحقن، أو خفقانًا، أو حساسية من المخدر.\n\n'
     || 'أقررت للطبيب بأي حساسية أو أمراض أعرفها (مثل أمراض القلب أو الضغط أو السكر) أو حمل.'),
    ('implant', 'موافقة على زراعة الأسنان',
     E'أوافق على إجراء زراعة الأسنان التي شرحها لي الطبيب، بمراحلها ومدتها وتكلفتها التقريبية.\n\n'
     || E'أعلم أن نجاح الزراعة يعتمد على حالة العظم والصحة العامة والعناية بالفم، وأنها قد لا تلتحم بالعظم في بعض الحالات فتحتاج إلى إعادة.\n\n'
     || E'أعلم أن من الآثار المحتملة: ألمًا أو تورمًا أو كدمة، وقد يحدث التهاب، ونادرًا تنميل في الشفة أو الذقن.\n\n'
     || 'أتعهد باتباع التعليمات وحضور مواعيد المتابعة، وأعلم أن التدخين يقلل فرص النجاح.')
  ) AS d(key, title, body);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;


ALTER FUNCTION public.seed_consent_drafts(p_tenant uuid) OWNER TO postgres;

--
-- Name: seed_expense_categories(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.seed_expense_categories(p_tenant uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES ('rent', 'إيجار'), ('salaries', 'رواتب'), ('supplies', 'مستلزمات'), ('equipment', 'أجهزة ومعدات'),
    ('laboratory', 'معامل'), ('utilities', 'كهرباء ومياه وإنترنت'), ('maintenance', 'صيانة'), ('other', 'أخرى')) v(k, n) LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM expense_categories WHERE tenant_id = p_tenant AND key = c.k);
    UPDATE expense_categories SET key = c.k WHERE tenant_id = p_tenant AND name = c.n AND key IS NULL;
    IF NOT FOUND THEN
      INSERT INTO expense_categories (tenant_id, key, name) VALUES (p_tenant, c.k, c.n) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;


ALTER FUNCTION public.seed_expense_categories(p_tenant uuid) OWNER TO postgres;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;


ALTER FUNCTION public.set_updated_at() OWNER TO postgres;

--
-- Name: slug_available(text); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.slug_available(p_slug text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
  SELECT p_slug ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$'
     AND NOT is_reserved_slug(p_slug)
     AND NOT EXISTS (SELECT 1 FROM tenants WHERE slug = p_slug::citext)
$_$;


ALTER FUNCTION public.slug_available(p_slug text) OWNER TO app_definer;

--
-- Name: subscriptions_insert_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.subscriptions_insert_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF current_user <> 'app_user' THEN RETURN NEW; END IF;
  IF NEW.status <> 'trialing' OR EXISTS (SELECT 1 FROM subscriptions WHERE tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'the clinic API adds only the sign-up trial' USING ERRCODE = 'insufficient_privilege',
      CONSTRAINT = 'subscriptions_signup_only';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.subscriptions_insert_guard() OWNER TO postgres;

--
-- Name: tenant_members_bump_access(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.tenant_members_bump_access() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (NEW.role_id, NEW.status, NEW.all_branches) IS DISTINCT FROM (OLD.role_id, OLD.status, OLD.all_branches) THEN
    NEW.access_version := OLD.access_version + 1;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.tenant_members_bump_access() OWNER TO postgres;

--
-- Name: tenant_members_keep_owner(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.tenant_members_keep_owner() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_owner_role uuid;
BEGIN
  IF public.hard_delete_allowed() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT id INTO v_owner_role FROM roles WHERE tenant_id = OLD.tenant_id AND key = 'owner';
  IF OLD.role_id = v_owner_role AND OLD.status = 'active'
     AND (TG_OP = 'DELETE' OR NEW.status <> 'active' OR NEW.role_id <> OLD.role_id) THEN
    PERFORM pg_advisory_xact_lock(hashtext('owners'), hashtext(OLD.tenant_id::text));
    IF NOT EXISTS (SELECT 1 FROM tenant_members WHERE tenant_id = OLD.tenant_id AND id <> OLD.id
                   AND role_id = v_owner_role AND status = 'active') THEN
      RAISE EXCEPTION 'the clinic must keep at least one active owner' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;


ALTER FUNCTION public.tenant_members_keep_owner() OWNER TO postgres;

--
-- Name: tenant_members_owner_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.tenant_members_owner_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF current_user <> 'app_user' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF is_owner_role(NEW.role_id) AND NOT acting_member_is_owner()
       AND EXISTS (SELECT 1 FROM tenant_members WHERE tenant_id = NEW.tenant_id)                 -- not sign-up
       AND NOT EXISTS (SELECT 1 FROM invitations i JOIN users u ON u.id = NEW.user_id           -- not this invitation
                        WHERE i.tenant_id = NEW.tenant_id AND i.role_id = NEW.role_id
                          AND i.accepted_at = now() AND lower(i.email::text) = lower(u.email::text)) THEN
      RAISE EXCEPTION 'only an owner gives the owner role' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'owner_role_only';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.role_id, NEW.status, NEW.all_branches) IS NOT DISTINCT FROM (OLD.role_id, OLD.status, OLD.all_branches) THEN
    RETURN NEW;
  END IF;
  IF acting_member_is_owner() THEN RETURN NEW; END IF;
  IF is_owner_role(OLD.role_id) OR is_owner_role(NEW.role_id) THEN
    RAISE EXCEPTION 'only an owner gives or takes the owner role' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'owner_role_only';
  END IF;
  IF NEW.id = current_member_id() THEN
    RAISE EXCEPTION 'a member does not change their own role, status or branches' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'own_access';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.tenant_members_owner_guard() OWNER TO postgres;

--
-- Name: tenant_settings_seed_categories(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.tenant_settings_seed_categories() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM seed_expense_categories(NEW.tenant_id);
  RETURN NULL;
END $$;


ALTER FUNCTION public.tenant_settings_seed_categories() OWNER TO postgres;

--
-- Name: tenants_currency_lock(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.tenants_currency_lock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency AND EXISTS (SELECT 1 FROM invoices WHERE tenant_id = OLD.id AND status <> 'draft') THEN
    RAISE EXCEPTION 'the currency is fixed once an invoice is issued' USING ERRCODE = 'check_violation', CONSTRAINT = 'tenants_currency_locked';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.tenants_currency_lock() OWNER TO postgres;

--
-- Name: text_array_union(text[], text[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.text_array_union(a text[], b text[]) RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT coalesce(array_agg(x ORDER BY o), '{}') FROM (
    SELECT DISTINCT ON (lower(btrim(x))) x, o FROM unnest(coalesce(a, '{}') || coalesce(b, '{}')) WITH ORDINALITY u(x, o)
    ORDER BY lower(btrim(x)), o) d
$$;


ALTER FUNCTION public.text_array_union(a text[], b text[]) OWNER TO postgres;

--
-- Name: tooth_records_validate(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.tooth_records_validate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.visit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM visits WHERE id = NEW.visit_id AND patient_id = NEW.patient_id) THEN
    RAISE EXCEPTION 'the visit belongs to another patient' USING ERRCODE = 'check_violation', CONSTRAINT = 'tooth_records_visit_patient';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.tooth_records_validate() OWNER TO postgres;

--
-- Name: treatment_plan_items_changed(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.treatment_plan_items_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE treatment_plans SET updated_at = now()
  WHERE id IN (CASE WHEN TG_OP <> 'DELETE' THEN NEW.plan_id END, CASE WHEN TG_OP <> 'INSERT' THEN OLD.plan_id END);
  RETURN NULL;
END $$;


ALTER FUNCTION public.treatment_plan_items_changed() OWNER TO postgres;

--
-- Name: treatment_plan_items_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.treatment_plan_items_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_plan text; r treatment_plan_items;
BEGIN
  IF public.hard_delete_allowed() THEN RETURN coalesce(NEW, OLD); END IF;
  r := coalesce(NEW, OLD);
  SELECT status INTO v_plan FROM treatment_plans WHERE id = r.plan_id;
  IF TG_OP IN ('INSERT', 'DELETE') THEN
    IF v_plan NOT IN ('draft', 'proposed') THEN
      RAISE EXCEPTION 'items of a % plan are not added or removed; cancel the item instead', v_plan
        USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plan_items_locked';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status NOT IN ('planned', 'scheduled') THEN
      RAISE EXCEPTION 'a new item is planned' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plan_items_status';
    END IF;
    RETURN r;
  END IF;
  IF v_plan NOT IN ('draft', 'proposed') AND (NEW.plan_id, NEW.service_id, NEW.tooth_code, NEW.surfaces, NEW.price_minor, NEW.discount_minor)
       IS DISTINCT FROM (OLD.plan_id, OLD.service_id, OLD.tooth_code, OLD.surfaces, OLD.price_minor, OLD.discount_minor) THEN
    RAISE EXCEPTION 'the items of a % plan are fixed', v_plan USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plan_items_locked';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF OLD.status = 'cancelled' THEN
      RAISE EXCEPTION 'a cancelled item stays cancelled' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plan_items_status';
    END IF;
    IF NEW.status = 'done' AND NOT EXISTS (SELECT 1 FROM visit_procedures WHERE plan_item_id = NEW.id) THEN
      RAISE EXCEPTION 'an item is done when a procedure records it' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plan_items_status';
    END IF;
    IF OLD.status = 'done' AND EXISTS (SELECT 1 FROM visit_procedures WHERE plan_item_id = NEW.id) THEN
      RAISE EXCEPTION 'a performed item stays done' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plan_items_status';
    END IF;
    IF NEW.status = 'scheduled' AND NEW.appointment_id IS NULL THEN
      RAISE EXCEPTION 'a scheduled item has its appointment' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plan_items_status';
    END IF;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.treatment_plan_items_guard() OWNER TO postgres;

--
-- Name: treatment_plan_progress(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.treatment_plan_progress(p_plan uuid) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL
              WHEN bool_and(status IN ('done', 'cancelled')) THEN 'completed'
              WHEN bool_or(status = 'done') THEN 'in_progress'
              ELSE 'accepted' END
  FROM treatment_plan_items WHERE plan_id = p_plan
$$;


ALTER FUNCTION public.treatment_plan_progress(p_plan uuid) OWNER TO postgres;

--
-- Name: treatment_plans_derive(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.treatment_plans_derive() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.total_estimate_minor := (SELECT coalesce(sum(price_minor - discount_minor), 0) FROM treatment_plan_items
                               WHERE plan_id = NEW.id AND status <> 'cancelled');
  IF NEW.status IN ('accepted', 'in_progress', 'completed') THEN
    NEW.status := coalesce(treatment_plan_progress(NEW.id), NEW.status);
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.treatment_plans_derive() OWNER TO postgres;

--
-- Name: treatment_plans_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.treatment_plans_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF public.hard_delete_allowed() THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND patient_merge_only(TG_RELID, to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF; -- PATIENT-003 merge moves the patient only
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'a plan starts as a draft' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plans_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('proposed', 'cancelled'))
    OR (OLD.status = 'proposed' AND NEW.status IN ('accepted', 'cancelled'))
    OR (OLD.status IN ('accepted', 'in_progress') AND NEW.status = 'cancelled')
    OR (OLD.status IN ('accepted', 'in_progress', 'completed') AND NEW.status IN ('accepted', 'in_progress', 'completed'))) THEN
    RAISE EXCEPTION 'a % plan cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plans_transition';
  END IF;
  IF OLD.status IN ('completed', 'cancelled') AND OLD.status = NEW.status
     AND (NEW.title, NEW.notes, NEW.doctor_id, NEW.accepted_at, NEW.accepted_by) IS DISTINCT FROM (OLD.title, OLD.notes, OLD.doctor_id, OLD.accepted_at, OLD.accepted_by) THEN
    RAISE EXCEPTION 'a % plan is closed', OLD.status USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plans_closed';
  END IF;
  IF OLD.status NOT IN ('draft', 'proposed') AND (NEW.accepted_at, NEW.accepted_by, NEW.patient_id) IS DISTINCT FROM (OLD.accepted_at, OLD.accepted_by, OLD.patient_id) THEN
    RAISE EXCEPTION 'the acceptance of a plan is not changed' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plans_locked';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.treatment_plans_guard() OWNER TO postgres;

--
-- Name: visit_amendments_validate(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.visit_amendments_validate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM visits WHERE id = NEW.visit_id AND status = 'final') THEN
    RAISE EXCEPTION 'only a final visit is amended; edit the draft instead' USING ERRCODE = 'check_violation', CONSTRAINT = 'visit_amendments_visit_final';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.visit_amendments_validate() OWNER TO postgres;

--
-- Name: visit_procedure_billed_elsewhere(uuid, uuid); Type: FUNCTION; Schema: public; Owner: app_definer
--

CREATE FUNCTION public.visit_procedure_billed_elsewhere(p_procedure uuid, p_item uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON i.id = ii.invoice_id
     WHERE ii.tenant_id = public.current_tenant_id() AND i.tenant_id = public.current_tenant_id()
       AND ii.visit_procedure_id = p_procedure AND ii.id IS DISTINCT FROM p_item AND i.status <> 'void')
$$;


ALTER FUNCTION public.visit_procedure_billed_elsewhere(p_procedure uuid, p_item uuid) OWNER TO app_definer;

--
-- Name: visit_procedures_payout_changed(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.visit_procedures_payout_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE doctor_payouts SET status = status
  WHERE id IN (CASE WHEN TG_OP <> 'DELETE' THEN NEW.payout_id END, CASE WHEN TG_OP <> 'INSERT' THEN OLD.payout_id END);
  RETURN NULL;
END $$;


ALTER FUNCTION public.visit_procedures_payout_changed() OWNER TO postgres;

--
-- Name: visit_procedures_payout_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.visit_procedures_payout_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE po record;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.payout_id IS NOT NULL THEN
    SELECT status INTO po FROM doctor_payouts WHERE id = OLD.payout_id FOR UPDATE;
    IF po.status <> 'draft' AND (NEW.payout_id IS DISTINCT FROM OLD.payout_id OR NEW.price_minor <> OLD.price_minor
        OR NEW.commission_bp <> OLD.commission_bp OR NEW.doctor_id <> OLD.doctor_id) THEN
      RAISE EXCEPTION 'procedure % belongs to a % payout and is frozen', OLD.id, po.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.payout_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.payout_id IS DISTINCT FROM OLD.payout_id) THEN
    SELECT doctor_id, status INTO po FROM doctor_payouts WHERE id = NEW.payout_id FOR UPDATE;
    IF po.doctor_id <> NEW.doctor_id OR po.status <> 'draft' THEN
      RAISE EXCEPTION 'procedure can join only a draft payout of the same doctor' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.visit_procedures_payout_guard() OWNER TO postgres;

--
-- Name: visit_procedures_plan_item(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.visit_procedures_plan_item() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF public.hard_delete_allowed() THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' AND NEW.plan_item_id IS NOT NULL THEN
    UPDATE treatment_plan_items SET status = 'done' WHERE id = NEW.plan_item_id;
  ELSIF TG_OP = 'DELETE' AND OLD.plan_item_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM visit_procedures WHERE plan_item_id = OLD.plan_item_id) THEN
    UPDATE treatment_plan_items SET status = CASE WHEN appointment_id IS NULL THEN 'planned' ELSE 'scheduled' END
     WHERE id = OLD.plan_item_id AND status = 'done';
  END IF;
  RETURN NULL;
END $$;


ALTER FUNCTION public.visit_procedures_plan_item() OWNER TO postgres;

--
-- Name: visit_procedures_validate(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.visit_procedures_validate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.plan_item_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM treatment_plan_items i
       JOIN treatment_plans tp ON tp.id = i.plan_id
       JOIN visits v ON v.id = NEW.visit_id
       WHERE i.id = NEW.plan_item_id AND tp.patient_id = v.patient_id) THEN
    RAISE EXCEPTION 'the treatment plan item belongs to another patient' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.visit_procedures_validate() OWNER TO postgres;

--
-- Name: visit_procedures_workflow(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.visit_procedures_workflow() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE s record; v_visit text; v_plan text; v_item text;
BEGIN
  IF public.hard_delete_allowed() THEN RETURN coalesce(NEW, OLD); END IF;
  IF TG_OP <> 'INSERT' THEN
    -- doctor payouts (deferred feature) only set payout_id; commission_minor is generated (still NULL in NEW here)
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'payout_id' - 'commission_minor') = (to_jsonb(OLD) - 'payout_id' - 'commission_minor') THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
               WHERE ii.visit_procedure_id = OLD.id AND i.status <> 'void') THEN
      RAISE EXCEPTION 'procedure % is billed', OLD.id USING ERRCODE = 'check_violation', CONSTRAINT = 'visit_procedures_billed';
    END IF;
    IF (SELECT status FROM visits WHERE id = OLD.visit_id) = 'final' THEN
      RAISE EXCEPTION 'the visit is final' USING ERRCODE = 'check_violation', CONSTRAINT = 'visits_finalized';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.plan_item_id, NEW.visit_id) IS DISTINCT FROM (OLD.plan_item_id, OLD.visit_id) THEN
      RAISE EXCEPTION 'record another procedure instead' USING ERRCODE = 'check_violation', CONSTRAINT = 'visit_procedures_fixed';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  -- CLR-16: the service price, or within its range; a service "priced on consultation" (0) takes the doctor's price
  SELECT price_minor, price_max_minor INTO s FROM services WHERE id = NEW.service_id;
  IF s.price_minor > 0 AND NOT (NEW.price_minor BETWEEN s.price_minor AND coalesce(s.price_max_minor, s.price_minor)) THEN
    RAISE EXCEPTION 'price % is outside the service price range', NEW.price_minor USING ERRCODE = 'check_violation', CONSTRAINT = 'visit_procedures_price_range';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.plan_item_id IS NOT NULL THEN
    SELECT i.status, p.status INTO v_item, v_plan FROM treatment_plan_items i JOIN treatment_plans p ON p.id = i.plan_id
     WHERE i.id = NEW.plan_item_id FOR UPDATE OF i;
    IF v_plan NOT IN ('accepted', 'in_progress', 'completed') THEN
      RAISE EXCEPTION 'the plan is not accepted' USING ERRCODE = 'check_violation', CONSTRAINT = 'visit_procedures_plan_not_accepted';
    END IF;
    IF v_item IN ('done', 'cancelled') THEN
      RAISE EXCEPTION 'the plan item is %', v_item USING ERRCODE = 'check_violation', CONSTRAINT = 'visit_procedures_plan_item_closed';
    END IF;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.visit_procedures_workflow() OWNER TO postgres;

--
-- Name: visits_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.visits_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF public.hard_delete_allowed() THEN RETURN coalesce(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE' AND patient_merge_only(TG_RELID, to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF; -- PATIENT-003 merge moves the patient only
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinical visits are never deleted' USING ERRCODE = 'check_violation', CONSTRAINT = 'visits_never_deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'draft'; NEW.finalized_at := NULL; NEW.finalized_by := NULL;
    RETURN NEW;
  END IF;
  IF OLD.status = 'final' AND (
       NEW.status <> 'final'
    OR (NEW.chief_complaint, NEW.diagnosis, NEW.clinical_notes, NEW.next_visit_note, NEW.finalized_at, NEW.finalized_by,
        NEW.patient_id, NEW.doctor_id, NEW.branch_id, NEW.appointment_id, NEW.visit_at)
       IS DISTINCT FROM
       (OLD.chief_complaint, OLD.diagnosis, OLD.clinical_notes, OLD.next_visit_note, OLD.finalized_at, OLD.finalized_by,
        OLD.patient_id, OLD.doctor_id, OLD.branch_id, OLD.appointment_id, OLD.visit_at)) THEN
    RAISE EXCEPTION 'visit % is final; add an amendment instead', OLD.id USING ERRCODE = 'check_violation', CONSTRAINT = 'visits_finalized';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'final' THEN
    NEW.finalized_at := now();
    NEW.finalized_by := coalesce(NEW.finalized_by, current_member_id());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;


ALTER FUNCTION public.visits_guard() OWNER TO postgres;

--
-- Name: visits_start_appointment(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.visits_start_appointment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.appointment_id IS NOT NULL THEN
    UPDATE appointments SET status = 'in_progress', updated_at = now() WHERE id = NEW.appointment_id AND status = 'checked_in';
  END IF;
  RETURN NULL;
END $$;


ALTER FUNCTION public.visits_start_appointment() OWNER TO postgres;

--
-- Name: visits_validate(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.visits_validate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE a record;
BEGIN
  IF NEW.appointment_id IS NOT NULL THEN
    SELECT patient_id, doctor_id, branch_id INTO a FROM appointments WHERE id = NEW.appointment_id;
    IF (a.patient_id, a.doctor_id, a.branch_id) IS DISTINCT FROM (NEW.patient_id, NEW.doctor_id, NEW.branch_id) THEN
      RAISE EXCEPTION 'visit patient/doctor/branch must match its appointment' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.visits_validate() OWNER TO postgres;

SET default_table_access_method = heap;

--
-- Name: appointments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    patient_id uuid,
    doctor_id uuid NOT NULL,
    room_id uuid,
    service_id uuid,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    hold_expires_at timestamp with time zone,
    check_in_code_hash text,
    check_in_code_expires_at timestamp with time zone,
    check_in_code_used_at timestamp with time zone,
    check_in_method text,
    check_in_note text,
    checked_in_by uuid,
    source text NOT NULL,
    payment_mode text DEFAULT 'at_clinic'::text NOT NULL,
    quoted_price_minor bigint,
    patient_notes text,
    internal_notes text,
    cancel_reason text,
    cancelled_by text,
    manage_token_hash text,
    booked_by uuid,
    override_reason text,
    confirmed_at timestamp with time zone,
    checked_in_at timestamp with time zone,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    patient_reschedules smallint DEFAULT 0 NOT NULL,
    CONSTRAINT appointments_cancelled_by_check CHECK ((cancelled_by = ANY (ARRAY['patient'::text, 'clinic'::text, 'system'::text]))),
    CONSTRAINT appointments_check CHECK ((ends_at > starts_at)),
    CONSTRAINT appointments_check1 CHECK (((ends_at - starts_at) <= '08:00:00'::interval)),
    CONSTRAINT appointments_check10 CHECK (((override_reason IS NULL) OR (source <> 'website'::text))),
    CONSTRAINT appointments_check2 CHECK (((status = 'cancelled'::text) = (cancelled_at IS NOT NULL))),
    CONSTRAINT appointments_check3 CHECK (((status <> ALL (ARRAY['held'::text, 'expired'::text])) OR (hold_expires_at IS NOT NULL))),
    CONSTRAINT appointments_check4 CHECK (((patient_id IS NOT NULL) OR (status = ANY (ARRAY['held'::text, 'expired'::text])))),
    CONSTRAINT appointments_check5 CHECK (((check_in_code_hash IS NULL) = (check_in_code_expires_at IS NULL))),
    CONSTRAINT appointments_check6 CHECK (((check_in_code_used_at IS NULL) OR (check_in_method = ANY (ARRAY['code'::text, 'qr'::text])))),
    CONSTRAINT appointments_check7 CHECK (((status <> ALL (ARRAY['checked_in'::text, 'in_progress'::text, 'completed'::text])) OR ((check_in_method IS NOT NULL) AND (checked_in_at IS NOT NULL)))),
    CONSTRAINT appointments_check8 CHECK (((check_in_method IS DISTINCT FROM 'manual'::text) OR (check_in_note IS NOT NULL))),
    CONSTRAINT appointments_check9 CHECK (((source = 'website'::text) = (booked_by IS NULL))),
    CONSTRAINT appointments_check_in_method_check CHECK ((check_in_method = ANY (ARRAY['code'::text, 'qr'::text, 'manual'::text, 'walk_in'::text]))),
    CONSTRAINT appointments_payment_mode_check CHECK ((payment_mode = ANY (ARRAY['at_clinic'::text, 'deposit'::text, 'full_online'::text]))),
    CONSTRAINT appointments_quoted_price_minor_check CHECK ((quoted_price_minor >= 0)),
    CONSTRAINT appointments_source_check CHECK ((source = ANY (ARRAY['website'::text, 'dashboard'::text, 'phone'::text, 'walk_in'::text, 'whatsapp'::text]))),
    CONSTRAINT appointments_status_check CHECK ((status = ANY (ARRAY['held'::text, 'expired'::text, 'pending'::text, 'confirmed'::text, 'checked_in'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text])))
);

ALTER TABLE ONLY public.appointments FORCE ROW LEVEL SECURITY;


ALTER TABLE public.appointments OWNER TO postgres;

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    tenant_id uuid NOT NULL,
    actor_type text NOT NULL,
    actor_user_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    changes jsonb,
    ip inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['member'::text, 'patient'::text, 'system'::text, 'platform_admin'::text])))
);

ALTER TABLE ONLY public.audit_log FORCE ROW LEVEL SECURITY;


ALTER TABLE public.audit_log OWNER TO postgres;

--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: auth_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.auth_events (
    id bigint NOT NULL,
    user_id uuid,
    identifier text,
    type text NOT NULL,
    ip inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auth_events_type_check CHECK ((type = ANY (ARRAY['login_ok'::text, 'login_failed'::text, 'logout'::text, 'password_reset'::text, 'otp_sent'::text, 'otp_failed'::text, 'locked'::text, 'token_reuse'::text])))
);


ALTER TABLE public.auth_events OWNER TO postgres;

--
-- Name: auth_events_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.auth_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.auth_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: balance_adjustments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.balance_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    installment_id uuid,
    kind text NOT NULL,
    amount_minor bigint NOT NULL,
    reason text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT balance_adjustments_amount CHECK ((amount_minor > 0)),
    CONSTRAINT balance_adjustments_kind CHECK ((kind = ANY (ARRAY['waiver'::text, 'write_off'::text]))),
    CONSTRAINT balance_adjustments_reason CHECK (((char_length(btrim(reason)) >= 3) AND (char_length(btrim(reason)) <= 500))),
    CONSTRAINT balance_adjustments_waiver_installment CHECK (((kind = 'waiver'::text) = (installment_id IS NOT NULL)))
);

ALTER TABLE ONLY public.balance_adjustments FORCE ROW LEVEL SECURITY;


ALTER TABLE public.balance_adjustments OWNER TO postgres;

--
-- Name: branch_hours; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.branch_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    weekday smallint NOT NULL,
    opens_at time without time zone NOT NULL,
    closes_at time without time zone NOT NULL,
    CONSTRAINT branch_hours_check CHECK ((closes_at > opens_at)),
    CONSTRAINT branch_hours_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);

ALTER TABLE ONLY public.branch_hours FORCE ROW LEVEL SECURITY;


ALTER TABLE public.branch_hours OWNER TO postgres;

--
-- Name: branches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name_en text,
    name_ar text,
    slug text NOT NULL,
    address_en text,
    address_ar text,
    city text,
    area text,
    latitude numeric(9,6),
    longitude numeric(9,6),
    phone text,
    whatsapp text,
    email public.citext,
    timezone text,
    is_main boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    photo_file_id uuid,
    CONSTRAINT branches_check CHECK (((name_en IS NOT NULL) OR (name_ar IS NOT NULL))),
    CONSTRAINT branches_latitude_check CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric))),
    CONSTRAINT branches_longitude_check CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric))),
    CONSTRAINT branches_main_is_active CHECK (((NOT is_main) OR is_active))
);

ALTER TABLE ONLY public.branches FORCE ROW LEVEL SECURITY;


ALTER TABLE public.branches OWNER TO postgres;

--
-- Name: cash_session_reopenings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cash_session_reopenings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    session_id uuid NOT NULL,
    reason text NOT NULL,
    previous_counted bigint NOT NULL,
    previous_expected bigint NOT NULL,
    previous_note text,
    previous_closed_by uuid,
    previous_closed_at timestamp with time zone NOT NULL,
    reopened_by uuid NOT NULL,
    reopened_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cash_session_reopenings_reason CHECK (((char_length(btrim(reason)) >= 3) AND (char_length(btrim(reason)) <= 500)))
);

ALTER TABLE ONLY public.cash_session_reopenings FORCE ROW LEVEL SECURITY;


ALTER TABLE public.cash_session_reopenings OWNER TO postgres;

--
-- Name: cash_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cash_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    business_date date NOT NULL,
    currency character(3) NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    opening_minor bigint NOT NULL,
    opened_by uuid NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    counted_minor bigint,
    expected_minor bigint,
    difference_minor bigint GENERATED ALWAYS AS ((counted_minor - expected_minor)) STORED,
    closing_totals jsonb,
    note text,
    closed_by uuid,
    closed_at timestamp with time zone,
    CONSTRAINT cash_sessions_closed_complete CHECK (((status = 'closed'::text) = ((closed_at IS NOT NULL) AND (counted_minor IS NOT NULL) AND (expected_minor IS NOT NULL)))),
    CONSTRAINT cash_sessions_counted CHECK ((counted_minor >= 0)),
    CONSTRAINT cash_sessions_difference_note CHECK (((status <> 'closed'::text) OR (counted_minor = expected_minor) OR (COALESCE(char_length(btrim(note)), 0) >= 3))),
    CONSTRAINT cash_sessions_note_length CHECK ((char_length(note) <= 500)),
    CONSTRAINT cash_sessions_opening CHECK ((opening_minor >= 0)),
    CONSTRAINT cash_sessions_status CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))
);

ALTER TABLE ONLY public.cash_sessions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.cash_sessions OWNER TO postgres;

--
-- Name: consent_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.consent_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    key text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    title_ar text,
    title_en text,
    body_ar text,
    body_en text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    created_by uuid,
    CONSTRAINT consent_templates_body CHECK (((body_ar IS NOT NULL) AND ((char_length(btrim(body_ar)) >= 20) AND (char_length(btrim(body_ar)) <= 20000)))),
    CONSTRAINT consent_templates_check CHECK (((body_ar IS NOT NULL) OR (body_en IS NOT NULL))),
    CONSTRAINT consent_templates_key_format CHECK ((key ~ '^[a-z0-9][a-z0-9_-]{1,39}$'::text)),
    CONSTRAINT consent_templates_review CHECK (((reviewed_at IS NULL) = (reviewed_by IS NULL))),
    CONSTRAINT consent_templates_title CHECK (((title_ar IS NOT NULL) AND ((char_length(btrim(title_ar)) >= 2) AND (char_length(btrim(title_ar)) <= 150)))),
    CONSTRAINT consent_templates_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.consent_templates FORCE ROW LEVEL SECURITY;


ALTER TABLE public.consent_templates OWNER TO postgres;

--
-- Name: data_exports; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.data_exports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    object_key text,
    size_bytes bigint,
    files_count integer,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    expires_at timestamp with time zone,
    CONSTRAINT data_exports_error_check CHECK ((char_length(error) <= 500)),
    CONSTRAINT data_exports_ready CHECK (((status <> 'ready'::text) OR ((object_key IS NOT NULL) AND (expires_at IS NOT NULL)))),
    CONSTRAINT data_exports_status CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'ready'::text, 'failed'::text, 'expired'::text])))
);

ALTER TABLE ONLY public.data_exports FORCE ROW LEVEL SECURITY;


ALTER TABLE public.data_exports OWNER TO postgres;

--
-- Name: doctor_branches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.doctor_branches (
    tenant_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    branch_id uuid NOT NULL
);

ALTER TABLE ONLY public.doctor_branches FORCE ROW LEVEL SECURITY;


ALTER TABLE public.doctor_branches OWNER TO postgres;

--
-- Name: doctor_payouts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.doctor_payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    currency character(3) NOT NULL,
    amount_minor bigint NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    approved_by uuid,
    paid_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT doctor_payouts_amount_minor_check CHECK ((amount_minor >= 0)),
    CONSTRAINT doctor_payouts_check CHECK ((period_end >= period_start)),
    CONSTRAINT doctor_payouts_check1 CHECK (((status <> 'paid'::text) OR (paid_at IS NOT NULL))),
    CONSTRAINT doctor_payouts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'paid'::text, 'void'::text])))
);

ALTER TABLE ONLY public.doctor_payouts FORCE ROW LEVEL SECURITY;


ALTER TABLE public.doctor_payouts OWNER TO postgres;

--
-- Name: doctor_schedules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.doctor_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    weekday smallint NOT NULL,
    starts_at time without time zone NOT NULL,
    ends_at time without time zone NOT NULL,
    CONSTRAINT doctor_schedules_check CHECK ((ends_at > starts_at)),
    CONSTRAINT doctor_schedules_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);

ALTER TABLE ONLY public.doctor_schedules FORCE ROW LEVEL SECURITY;


ALTER TABLE public.doctor_schedules OWNER TO postgres;

--
-- Name: doctor_services; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.doctor_services (
    tenant_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    service_id uuid NOT NULL
);

ALTER TABLE ONLY public.doctor_services FORCE ROW LEVEL SECURITY;


ALTER TABLE public.doctor_services OWNER TO postgres;

--
-- Name: doctor_time_off; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.doctor_time_off (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    reason text,
    created_by uuid,
    CONSTRAINT doctor_time_off_check CHECK ((ends_at > starts_at)),
    CONSTRAINT doctor_time_off_max_length CHECK (((ends_at - starts_at) <= '366 days'::interval))
);

ALTER TABLE ONLY public.doctor_time_off FORCE ROW LEVEL SECURITY;


ALTER TABLE public.doctor_time_off OWNER TO postgres;

--
-- Name: doctors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.doctors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    member_id uuid,
    name_en text,
    name_ar text,
    title_en text,
    title_ar text,
    bio_en text,
    bio_ar text,
    photo_file_id uuid,
    specialties text[] DEFAULT '{}'::text[] NOT NULL,
    consultation_fee_minor bigint,
    commission_bp integer,
    calendar_color text,
    show_on_website boolean DEFAULT true NOT NULL,
    accepts_online_booking boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT doctors_check CHECK (((name_en IS NOT NULL) OR (name_ar IS NOT NULL))),
    CONSTRAINT doctors_commission_bp_check CHECK (((commission_bp >= 0) AND (commission_bp <= 10000))),
    CONSTRAINT doctors_consultation_fee_minor_check CHECK ((consultation_fee_minor >= 0))
);

ALTER TABLE ONLY public.doctors FORCE ROW LEVEL SECURITY;


ALTER TABLE public.doctors OWNER TO postgres;

--
-- Name: domains; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.domains (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    hostname public.citext NOT NULL,
    type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    verification_token text,
    verified_at timestamp with time zone,
    last_checked_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT domains_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'verified'::text, 'active'::text, 'failed'::text, 'removed'::text]))),
    CONSTRAINT domains_type_check CHECK ((type = ANY (ARRAY['subdomain'::text, 'custom'::text])))
);

ALTER TABLE ONLY public.domains FORCE ROW LEVEL SECURITY;


ALTER TABLE public.domains OWNER TO postgres;

--
-- Name: expense_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.expense_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    key text,
    is_active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.expense_categories FORCE ROW LEVEL SECURITY;


ALTER TABLE public.expense_categories OWNER TO postgres;

--
-- Name: expenses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    category_id uuid NOT NULL,
    supplier_id uuid,
    amount_minor bigint NOT NULL,
    currency character(3) NOT NULL,
    spent_on date NOT NULL,
    description text,
    file_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_method text,
    reference text,
    supplier_name text,
    status text DEFAULT 'approved'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    decision_note text,
    void_reason text,
    voided_by uuid,
    voided_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expenses_amount_minor_check CHECK ((amount_minor > 0)),
    CONSTRAINT expenses_description_length CHECK ((char_length(description) <= 500)),
    CONSTRAINT expenses_payment_method CHECK ((payment_method = ANY (ARRAY['cash'::text, 'card'::text, 'bank_transfer'::text, 'wallet'::text, 'instapay'::text]))),
    CONSTRAINT expenses_reference_length CHECK (((char_length(reference) >= 1) AND (char_length(reference) <= 100))),
    CONSTRAINT expenses_reference_required CHECK (((payment_method <> ALL (ARRAY['bank_transfer'::text, 'wallet'::text, 'instapay'::text])) OR (reference IS NOT NULL))),
    CONSTRAINT expenses_self_approval CHECK (((approved_by IS NULL) OR (approved_by IS DISTINCT FROM created_by))),
    CONSTRAINT expenses_status CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'void'::text]))),
    CONSTRAINT expenses_supplier_length CHECK (((char_length(supplier_name) >= 1) AND (char_length(supplier_name) <= 120))),
    CONSTRAINT expenses_void_complete CHECK (((status = 'void'::text) = ((voided_at IS NOT NULL) AND (COALESCE(char_length(btrim(void_reason)), 0) >= 3))))
);

ALTER TABLE ONLY public.expenses FORCE ROW LEVEL SECURITY;


ALTER TABLE public.expenses OWNER TO postgres;

--
-- Name: faqs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.faqs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    service_id uuid,
    question_en text,
    answer_en text,
    question_ar text,
    answer_ar text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT faqs_answer_ar CHECK (((answer_ar IS NOT NULL) AND ((char_length(btrim(answer_ar)) >= 2) AND (char_length(btrim(answer_ar)) <= 3000)))),
    CONSTRAINT faqs_answer_en CHECK (((answer_en IS NULL) OR (char_length(answer_en) <= 3000))),
    CONSTRAINT faqs_question_ar CHECK (((question_ar IS NOT NULL) AND ((char_length(btrim(question_ar)) >= 5) AND (char_length(btrim(question_ar)) <= 300)))),
    CONSTRAINT faqs_question_en CHECK (((question_en IS NULL) OR (char_length(question_en) <= 300)))
);

ALTER TABLE ONLY public.faqs FORCE ROW LEVEL SECURITY;


ALTER TABLE public.faqs OWNER TO postgres;

--
-- Name: files; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    bucket text NOT NULL,
    object_key text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    kind text NOT NULL,
    is_private boolean DEFAULT true NOT NULL,
    sha256 text,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    width integer,
    height integer,
    variant_widths integer[] DEFAULT '{}'::integer[] NOT NULL,
    CONSTRAINT files_clinical_private CHECK ((NOT ((kind = ANY (ARRAY['xray'::text, 'clinical_photo'::text, 'consent'::text, 'document'::text])) AND (is_private = false)))),
    CONSTRAINT files_height_check CHECK ((height > 0)),
    CONSTRAINT files_kind_check CHECK ((kind = ANY (ARRAY['logo'::text, 'image'::text, 'gallery'::text, 'case'::text, 'xray'::text, 'clinical_photo'::text, 'consent'::text, 'document'::text, 'invoice_pdf'::text, 'other'::text]))),
    CONSTRAINT files_size_bytes_check CHECK ((size_bytes > 0)),
    CONSTRAINT files_width_check CHECK ((width > 0))
);

ALTER TABLE ONLY public.files FORCE ROW LEVEL SECURITY;


ALTER TABLE public.files OWNER TO postgres;

--
-- Name: gallery_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.gallery_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    type text NOT NULL,
    service_id uuid,
    image_file_id uuid NOT NULL,
    before_file_id uuid,
    caption_en text,
    caption_ar text,
    consent_confirmed boolean DEFAULT false NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    branch_id uuid,
    alt_ar text,
    alt_en text,
    is_featured boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    consent_confirmed_at timestamp with time zone,
    consent_confirmed_by uuid,
    CONSTRAINT gallery_items_alt_ar_check CHECK ((char_length(alt_ar) <= 200)),
    CONSTRAINT gallery_items_alt_en_check CHECK ((char_length(alt_en) <= 200)),
    CONSTRAINT gallery_items_case_clinic_wide CHECK (((type = 'photo'::text) OR (branch_id IS NULL))),
    CONSTRAINT gallery_items_case_images CHECK (((type <> 'before_after'::text) OR (before_file_id IS DISTINCT FROM image_file_id))),
    CONSTRAINT gallery_items_case_not_featured CHECK (((type = 'photo'::text) OR (NOT is_featured))),
    CONSTRAINT gallery_items_check CHECK (((type <> 'before_after'::text) OR (before_file_id IS NOT NULL))),
    CONSTRAINT gallery_items_check1 CHECK (((NOT is_published) OR (type = 'photo'::text) OR consent_confirmed)),
    CONSTRAINT gallery_items_consent_recorded CHECK (((NOT consent_confirmed) OR ((consent_confirmed_at IS NOT NULL) AND (consent_confirmed_by IS NOT NULL)))),
    CONSTRAINT gallery_items_featured_published CHECK (((NOT is_featured) OR is_published)),
    CONSTRAINT gallery_items_published_described CHECK (((NOT is_published) OR (COALESCE(alt_ar, alt_en, caption_ar, caption_en) IS NOT NULL))),
    CONSTRAINT gallery_items_type_check CHECK ((type = ANY (ARRAY['photo'::text, 'before_after'::text])))
);

ALTER TABLE ONLY public.gallery_items FORCE ROW LEVEL SECURITY;


ALTER TABLE public.gallery_items OWNER TO postgres;

--
-- Name: holidays; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.holidays (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid,
    date date NOT NULL,
    name text NOT NULL,
    created_by uuid,
    CONSTRAINT holidays_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100)))
);

ALTER TABLE ONLY public.holidays FORCE ROW LEVEL SECURITY;


ALTER TABLE public.holidays OWNER TO postgres;

--
-- Name: in_app_notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.in_app_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.in_app_notifications FORCE ROW LEVEL SECURITY;


ALTER TABLE public.in_app_notifications OWNER TO postgres;

--
-- Name: installments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.installments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    seq smallint NOT NULL,
    due_date date NOT NULL,
    amount_minor bigint NOT NULL,
    paid_minor bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'due'::text NOT NULL,
    paid_at timestamp with time zone,
    waived_at timestamp with time zone,
    waived_by uuid,
    waived_reason text,
    CONSTRAINT installments_amount_minor_check CHECK ((amount_minor > 0)),
    CONSTRAINT installments_check CHECK ((paid_minor <= amount_minor)),
    CONSTRAINT installments_check1 CHECK (((status <> 'paid'::text) OR (paid_minor = amount_minor))),
    CONSTRAINT installments_paid_minor_check CHECK ((paid_minor >= 0)),
    CONSTRAINT installments_seq_check CHECK ((seq > 0)),
    CONSTRAINT installments_status_check CHECK ((status = ANY (ARRAY['due'::text, 'partially_paid'::text, 'paid'::text, 'waived'::text]))),
    CONSTRAINT installments_waiver_complete CHECK (((status = 'waived'::text) = ((waived_at IS NOT NULL) AND (waived_reason IS NOT NULL))))
);

ALTER TABLE ONLY public.installments FORCE ROW LEVEL SECURITY;


ALTER TABLE public.installments OWNER TO postgres;

--
-- Name: inventory_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    category text,
    unit text DEFAULT 'pcs'::text NOT NULL,
    min_stock numeric(12,3) DEFAULT 0 NOT NULL,
    last_cost_minor bigint,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_items_last_cost_minor_check CHECK ((last_cost_minor >= 0)),
    CONSTRAINT inventory_items_min_stock_check CHECK ((min_stock >= (0)::numeric))
);

ALTER TABLE ONLY public.inventory_items FORCE ROW LEVEL SECURITY;


ALTER TABLE public.inventory_items OWNER TO postgres;

--
-- Name: inventory_movements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    type text NOT NULL,
    quantity numeric(12,3) NOT NULL,
    unit_cost_minor bigint,
    supplier_id uuid,
    visit_id uuid,
    transfer_id uuid,
    reference text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_movements_check CHECK ((((type = ANY (ARRAY['purchase'::text, 'transfer_in'::text, 'return'::text])) AND (quantity > (0)::numeric)) OR ((type = ANY (ARRAY['usage'::text, 'transfer_out'::text, 'expired'::text])) AND (quantity < (0)::numeric)) OR (type = 'adjustment'::text))),
    CONSTRAINT inventory_movements_quantity_check CHECK ((quantity <> (0)::numeric)),
    CONSTRAINT inventory_movements_type_check CHECK ((type = ANY (ARRAY['purchase'::text, 'usage'::text, 'adjustment'::text, 'transfer_in'::text, 'transfer_out'::text, 'return'::text, 'expired'::text]))),
    CONSTRAINT inventory_movements_unit_cost_minor_check CHECK ((unit_cost_minor >= 0))
);

ALTER TABLE ONLY public.inventory_movements FORCE ROW LEVEL SECURITY;


ALTER TABLE public.inventory_movements OWNER TO postgres;

--
-- Name: inventory_stock; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_stock (
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    quantity numeric(12,3) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_stock_quantity_check CHECK ((quantity >= (0)::numeric))
);

ALTER TABLE ONLY public.inventory_stock FORCE ROW LEVEL SECURITY;


ALTER TABLE public.inventory_stock OWNER TO postgres;

--
-- Name: invitations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    email public.citext,
    phone text,
    role_id uuid NOT NULL,
    branch_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    token_hash text NOT NULL,
    invited_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    job_title text,
    doctor_id uuid,
    CONSTRAINT invitations_check CHECK (((email IS NOT NULL) OR (phone IS NOT NULL))),
    CONSTRAINT invitations_job_title_check CHECK (((char_length(job_title) >= 1) AND (char_length(job_title) <= 80)))
);

ALTER TABLE ONLY public.invitations FORCE ROW LEVEL SECURITY;


ALTER TABLE public.invitations OWNER TO postgres;

--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    service_id uuid,
    visit_procedure_id uuid,
    doctor_id uuid,
    description text NOT NULL,
    tooth_code smallint,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price_minor bigint NOT NULL,
    discount_minor bigint DEFAULT 0 NOT NULL,
    line_total_minor bigint NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    discount_type text,
    discount_bp integer,
    discount_reason text,
    CONSTRAINT invoice_items_check CHECK ((line_total_minor = ((quantity * unit_price_minor) - discount_minor))),
    CONSTRAINT invoice_items_description_length CHECK (((char_length(btrim(description)) >= 1) AND (char_length(btrim(description)) <= 300))),
    CONSTRAINT invoice_items_discount_bp CHECK (((discount_bp >= 0) AND (discount_bp <= 10000))),
    CONSTRAINT invoice_items_discount_minor_check CHECK ((discount_minor >= 0)),
    CONSTRAINT invoice_items_discount_percent CHECK (((discount_type = 'percent'::text) = (discount_bp IS NOT NULL))),
    CONSTRAINT invoice_items_discount_reason CHECK (((discount_minor = 0) OR ((COALESCE(char_length(btrim(discount_reason)), 0) >= 3) AND (COALESCE(char_length(btrim(discount_reason)), 0) <= 300)))),
    CONSTRAINT invoice_items_discount_type CHECK ((discount_type = ANY (ARRAY['amount'::text, 'percent'::text]))),
    CONSTRAINT invoice_items_line_total_minor_check CHECK ((line_total_minor >= 0)),
    CONSTRAINT invoice_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT invoice_items_unit_price_minor_check CHECK ((unit_price_minor >= 0))
);

ALTER TABLE ONLY public.invoice_items FORCE ROW LEVEL SECURITY;


ALTER TABLE public.invoice_items OWNER TO postgres;

--
-- Name: invoices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    number text,
    status text DEFAULT 'draft'::text NOT NULL,
    currency character(3) NOT NULL,
    subtotal_minor bigint DEFAULT 0 NOT NULL,
    discount_minor bigint DEFAULT 0 NOT NULL,
    tax_minor bigint DEFAULT 0 NOT NULL,
    total_minor bigint DEFAULT 0 NOT NULL,
    paid_minor bigint DEFAULT 0 NOT NULL,
    issue_date date,
    due_date date,
    notes text,
    void_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    voided_at timestamp with time zone,
    voided_by uuid,
    discount_type text,
    discount_bp integer,
    discount_reason text,
    discount_status text DEFAULT 'none'::text NOT NULL,
    discount_requested_by uuid,
    discount_decided_by uuid,
    discount_decided_at timestamp with time zone,
    discount_note text,
    adjusted_minor bigint DEFAULT 0 NOT NULL,
    balance_minor bigint GENERATED ALWAYS AS (((total_minor - paid_minor) - adjusted_minor)) STORED,
    CONSTRAINT invoices_adjusted_minor CHECK ((adjusted_minor >= 0)),
    CONSTRAINT invoices_check CHECK ((total_minor = ((subtotal_minor - discount_minor) + tax_minor))),
    CONSTRAINT invoices_check1 CHECK (((status = 'draft'::text) OR (total_minor >= 0))),
    CONSTRAINT invoices_check2 CHECK (((status = 'draft'::text) OR ((paid_minor + adjusted_minor) <= total_minor))),
    CONSTRAINT invoices_check3 CHECK (((status = ANY (ARRAY['draft'::text, 'void'::text])) OR (number IS NOT NULL))),
    CONSTRAINT invoices_check4 CHECK (((status <> 'void'::text) OR (void_reason IS NOT NULL))),
    CONSTRAINT invoices_discount_bp CHECK (((discount_bp >= 0) AND (discount_bp <= 10000))),
    CONSTRAINT invoices_discount_le_subtotal CHECK (((status = 'draft'::text) OR (discount_minor <= subtotal_minor))),
    CONSTRAINT invoices_discount_minor_check CHECK ((discount_minor >= 0)),
    CONSTRAINT invoices_discount_percent CHECK (((discount_type = 'percent'::text) = (discount_bp IS NOT NULL))),
    CONSTRAINT invoices_discount_reason CHECK (((discount_minor = 0) OR ((COALESCE(char_length(btrim(discount_reason)), 0) >= 3) AND (COALESCE(char_length(btrim(discount_reason)), 0) <= 300)))),
    CONSTRAINT invoices_discount_self_approval CHECK (((discount_decided_by IS NULL) OR (discount_decided_by IS DISTINCT FROM discount_requested_by))),
    CONSTRAINT invoices_discount_status CHECK ((discount_status = ANY (ARRAY['none'::text, 'within_limit'::text, 'pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT invoices_discount_type CHECK ((discount_type = ANY (ARRAY['amount'::text, 'percent'::text]))),
    CONSTRAINT invoices_notes_length CHECK ((char_length(notes) <= 1000)),
    CONSTRAINT invoices_paid_minor_check CHECK ((paid_minor >= 0)),
    CONSTRAINT invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'issued'::text, 'partially_paid'::text, 'paid'::text, 'void'::text]))),
    CONSTRAINT invoices_subtotal_minor_check CHECK ((subtotal_minor >= 0)),
    CONSTRAINT invoices_tax_minor_check CHECK ((tax_minor >= 0)),
    CONSTRAINT invoices_void_reason_length CHECK (((void_reason IS NULL) OR ((char_length(btrim(void_reason)) >= 3) AND (char_length(btrim(void_reason)) <= 500))))
);

ALTER TABLE ONLY public.invoices FORCE ROW LEVEL SECURITY;


ALTER TABLE public.invoices OWNER TO postgres;

--
-- Name: lab_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lab_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    lab_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    visit_id uuid,
    plan_item_id uuid,
    work_type text NOT NULL,
    teeth smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    shade text,
    material text,
    instructions text,
    status text DEFAULT 'draft'::text NOT NULL,
    sent_at timestamp with time zone,
    due_date date,
    received_at timestamp with time zone,
    fitted_at timestamp with time zone,
    cost_minor bigint,
    currency character(3),
    remake_of_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_orders_check CHECK (((status = 'draft'::text) OR (sent_at IS NOT NULL))),
    CONSTRAINT lab_orders_check1 CHECK (((status <> ALL (ARRAY['received'::text, 'fitted'::text])) OR (received_at IS NOT NULL))),
    CONSTRAINT lab_orders_check2 CHECK (((cost_minor IS NULL) OR (currency IS NOT NULL))),
    CONSTRAINT lab_orders_cost_minor_check CHECK ((cost_minor >= 0)),
    CONSTRAINT lab_orders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'in_progress'::text, 'received'::text, 'fitted'::text, 'remake'::text, 'cancelled'::text]))),
    CONSTRAINT lab_orders_work_type_check CHECK ((work_type = ANY (ARRAY['crown'::text, 'bridge'::text, 'veneer'::text, 'inlay_onlay'::text, 'denture_full'::text, 'denture_partial'::text, 'implant_crown'::text, 'aligner'::text, 'retainer'::text, 'night_guard'::text, 'other'::text])))
);

ALTER TABLE ONLY public.lab_orders FORCE ROW LEVEL SECURITY;


ALTER TABLE public.lab_orders OWNER TO postgres;

--
-- Name: labs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.labs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    phone text,
    whatsapp text,
    email public.citext,
    address text,
    notes text,
    is_active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.labs FORCE ROW LEVEL SECURITY;


ALTER TABLE public.labs OWNER TO postgres;

--
-- Name: leads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    phone text NOT NULL,
    email public.citext,
    clinic_name text,
    city text,
    message text,
    source text,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'call'::text NOT NULL,
    plan_id uuid,
    billing_cycle text,
    clinic_id uuid,
    ip inet,
    user_agent text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT leads_billing_cycle CHECK ((billing_cycle = ANY (ARRAY['monthly'::text, 'yearly'::text]))),
    CONSTRAINT leads_city CHECK (((city IS NULL) OR (char_length(city) <= 80))),
    CONSTRAINT leads_clinic_name CHECK (((clinic_name IS NULL) OR (char_length(clinic_name) <= 150))),
    CONSTRAINT leads_email CHECK (((email IS NULL) OR (char_length((email)::text) <= 254))),
    CONSTRAINT leads_full_name CHECK (((char_length(btrim(full_name)) >= 2) AND (char_length(btrim(full_name)) <= 120))),
    CONSTRAINT leads_kind CHECK ((kind = ANY (ARRAY['call'::text, 'subscribe'::text]))),
    CONSTRAINT leads_message CHECK (((message IS NULL) OR (char_length(message) <= 2000))),
    CONSTRAINT leads_phone CHECK ((phone ~ '^\+[1-9][0-9]{7,14}$'::text)),
    CONSTRAINT leads_source CHECK (((source IS NULL) OR (char_length(source) <= 100))),
    CONSTRAINT leads_status_check CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'converted'::text, 'lost'::text]))),
    CONSTRAINT leads_subscribe CHECK (
CASE kind
    WHEN 'subscribe'::text THEN (billing_cycle IS NOT NULL)
    ELSE ((billing_cycle IS NULL) AND (clinic_id IS NULL))
END),
    CONSTRAINT leads_user_agent CHECK (((user_agent IS NULL) OR (char_length(user_agent) <= 300)))
);


ALTER TABLE public.leads OWNER TO postgres;

--
-- Name: legal_acceptances; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.legal_acceptances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    document_id uuid NOT NULL,
    tenant_id uuid,
    accepted_at timestamp with time zone DEFAULT now() NOT NULL,
    ip inet,
    user_agent text,
    CONSTRAINT legal_acceptances_user_agent_check CHECK ((char_length(user_agent) <= 300))
);


ALTER TABLE public.legal_acceptances OWNER TO postgres;

--
-- Name: legal_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.legal_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    version integer NOT NULL,
    title_ar text NOT NULL,
    body_ar text NOT NULL,
    requires_reacceptance boolean DEFAULT false NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    published_by uuid,
    CONSTRAINT legal_documents_body CHECK (((char_length(btrim(body_ar)) >= 20) AND (char_length(btrim(body_ar)) <= 200000))),
    CONSTRAINT legal_documents_kind CHECK ((kind = ANY (ARRAY['terms'::text, 'privacy'::text, 'dpa'::text]))),
    CONSTRAINT legal_documents_title CHECK (((char_length(btrim(title_ar)) >= 2) AND (char_length(btrim(title_ar)) <= 200))),
    CONSTRAINT legal_documents_version_check CHECK ((version > 0))
);


ALTER TABLE public.legal_documents OWNER TO postgres;

--
-- Name: member_branches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.member_branches (
    tenant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    branch_id uuid NOT NULL
);

ALTER TABLE ONLY public.member_branches FORCE ROW LEVEL SECURITY;


ALTER TABLE public.member_branches OWNER TO postgres;

--
-- Name: notification_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notification_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    event text NOT NULL,
    channel text NOT NULL,
    locale text NOT NULL,
    subject text,
    body text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_templates_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'sms'::text, 'whatsapp'::text]))),
    CONSTRAINT notification_templates_locale_check CHECK ((locale = ANY (ARRAY['ar'::text, 'en'::text])))
);

ALTER TABLE ONLY public.notification_templates FORCE ROW LEVEL SECURITY;


ALTER TABLE public.notification_templates OWNER TO postgres;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    event text NOT NULL,
    channel text NOT NULL,
    recipient text NOT NULL,
    patient_id uuid,
    member_id uuid,
    subject text,
    body text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    provider text,
    provider_message_id text,
    attempts smallint DEFAULT 0 NOT NULL,
    last_error text,
    dedupe_key text,
    related_type text,
    related_id uuid,
    scheduled_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'sms'::text, 'whatsapp'::text]))),
    CONSTRAINT notifications_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.notifications FORCE ROW LEVEL SECURITY;


ALTER TABLE public.notifications OWNER TO postgres;

--
-- Name: otp_codes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.otp_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target text NOT NULL,
    purpose text NOT NULL,
    code_hash text NOT NULL,
    attempts smallint DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT otp_codes_attempts_check CHECK ((attempts <= 5)),
    CONSTRAINT otp_codes_purpose_check CHECK ((purpose = ANY (ARRAY['verify_phone'::text, 'verify_email'::text, 'login'::text, 'reset_password'::text, 'booking'::text])))
);


ALTER TABLE public.otp_codes OWNER TO postgres;

--
-- Name: outbox_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.outbox_events (
    id bigint NOT NULL,
    tenant_id uuid,
    type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.outbox_events FORCE ROW LEVEL SECURITY;


ALTER TABLE public.outbox_events OWNER TO postgres;

--
-- Name: outbox_events_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.outbox_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.outbox_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: patient_consents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.patient_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    template_id uuid NOT NULL,
    visit_id uuid,
    treatment_plan_id uuid,
    locale text NOT NULL,
    body_snapshot text NOT NULL,
    signer_name text NOT NULL,
    signer_relation text DEFAULT 'self'::text NOT NULL,
    signature_file_id uuid,
    witness_member_id uuid,
    signed_at timestamp with time zone DEFAULT now() NOT NULL,
    signed_ip inet,
    revoked_at timestamp with time zone,
    method text DEFAULT 'screen'::text NOT NULL,
    paper_file_id uuid,
    title_snapshot text,
    recorded_by uuid,
    revoked_by uuid,
    revoke_reason text,
    CONSTRAINT patient_consents_locale_check CHECK ((locale = ANY (ARRAY['ar'::text, 'en'::text]))),
    CONSTRAINT patient_consents_method CHECK ((((method = 'screen'::text) AND (signature_file_id IS NOT NULL) AND (paper_file_id IS NULL)) OR ((method = 'paper'::text) AND (paper_file_id IS NOT NULL) AND (signature_file_id IS NULL)))),
    CONSTRAINT patient_consents_method_kind CHECK ((method = ANY (ARRAY['screen'::text, 'paper'::text]))),
    CONSTRAINT patient_consents_revoke_reason CHECK (((revoke_reason IS NULL) OR ((char_length(btrim(revoke_reason)) >= 3) AND (char_length(btrim(revoke_reason)) <= 300)))),
    CONSTRAINT patient_consents_revoked CHECK ((((revoked_at IS NULL) = (revoked_by IS NULL)) AND ((revoked_at IS NULL) = (revoke_reason IS NULL)))),
    CONSTRAINT patient_consents_signer CHECK (((char_length(btrim(signer_name)) >= 2) AND (char_length(btrim(signer_name)) <= 120))),
    CONSTRAINT patient_consents_signer_relation_check CHECK ((signer_relation = ANY (ARRAY['self'::text, 'father'::text, 'mother'::text, 'sibling'::text, 'spouse'::text, 'legal_guardian'::text, 'other'::text])))
);

ALTER TABLE ONLY public.patient_consents FORCE ROW LEVEL SECURITY;


ALTER TABLE public.patient_consents OWNER TO postgres;

--
-- Name: patient_files; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.patient_files (
    tenant_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    file_id uuid NOT NULL,
    visit_id uuid,
    caption text,
    taken_at date,
    archived_at timestamp with time zone,
    archived_by uuid,
    archive_reason text,
    CONSTRAINT patient_files_archive_complete CHECK (((archived_at IS NULL) = (archive_reason IS NULL))),
    CONSTRAINT patient_files_archive_reason_check CHECK (((char_length(archive_reason) >= 3) AND (char_length(archive_reason) <= 200))),
    CONSTRAINT patient_files_caption_length CHECK ((char_length(caption) <= 200))
);

ALTER TABLE ONLY public.patient_files FORCE ROW LEVEL SECURITY;


ALTER TABLE public.patient_files OWNER TO postgres;

--
-- Name: patient_medical_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.patient_medical_history (
    patient_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    allergies text[] DEFAULT '{}'::text[] NOT NULL,
    conditions text[] DEFAULT '{}'::text[] NOT NULL,
    medications text[] DEFAULT '{}'::text[] NOT NULL,
    is_pregnant boolean,
    is_smoker boolean,
    notes text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.patient_medical_history FORCE ROW LEVEL SECURITY;


ALTER TABLE public.patient_medical_history OWNER TO postgres;

--
-- Name: patient_medical_history_versions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.patient_medical_history_versions (
    id bigint NOT NULL,
    tenant_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    allergies text[] NOT NULL,
    conditions text[] NOT NULL,
    medications text[] NOT NULL,
    is_pregnant boolean,
    is_smoker boolean,
    notes text,
    saved_by uuid,
    saved_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.patient_medical_history_versions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.patient_medical_history_versions OWNER TO postgres;

--
-- Name: patient_medical_history_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.patient_medical_history_versions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.patient_medical_history_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: patients; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.patients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    file_no bigint NOT NULL,
    full_name text NOT NULL,
    gender text,
    date_of_birth date,
    phone text NOT NULL,
    phone_alt text,
    email public.citext,
    address text,
    city text,
    occupation text,
    referral_source text,
    preferred_branch_id uuid,
    preferred_locale text DEFAULT 'ar'::text NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    notes text,
    is_blocked boolean DEFAULT false NOT NULL,
    guardian_name text,
    guardian_phone text,
    guardian_relation text,
    guardian_patient_id uuid,
    marketing_opt_in boolean DEFAULT false NOT NULL,
    marketing_opt_in_at timestamp with time zone,
    merged_into_id uuid,
    merged_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    full_name_norm text GENERATED ALWAYS AS (public.ar_normalize(full_name)) STORED,
    CONSTRAINT patients_check CHECK ((guardian_patient_id IS DISTINCT FROM id)),
    CONSTRAINT patients_check1 CHECK ((merged_into_id IS DISTINCT FROM id)),
    CONSTRAINT patients_check2 CHECK (((merged_into_id IS NULL) = (merged_at IS NULL))),
    CONSTRAINT patients_check3 CHECK (((NOT marketing_opt_in) OR (marketing_opt_in_at IS NOT NULL))),
    CONSTRAINT patients_date_of_birth_check CHECK (((date_of_birth IS NULL) OR (date_of_birth <= CURRENT_DATE))),
    CONSTRAINT patients_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text]))),
    CONSTRAINT patients_guardian_relation_check CHECK ((guardian_relation = ANY (ARRAY['father'::text, 'mother'::text, 'sibling'::text, 'spouse'::text, 'legal_guardian'::text, 'other'::text]))),
    CONSTRAINT patients_preferred_locale_check CHECK ((preferred_locale = ANY (ARRAY['ar'::text, 'en'::text])))
);

ALTER TABLE ONLY public.patients FORCE ROW LEVEL SECURITY;


ALTER TABLE public.patients OWNER TO postgres;

--
-- Name: payment_gateways; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payment_gateways (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    provider text NOT NULL,
    mode text DEFAULT 'test'::text NOT NULL,
    credentials_enc bytea NOT NULL,
    public_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_gateways_mode_check CHECK ((mode = ANY (ARRAY['test'::text, 'live'::text]))),
    CONSTRAINT payment_gateways_provider_check CHECK ((provider = ANY (ARRAY['paymob'::text, 'fawry'::text, 'stripe'::text])))
);

ALTER TABLE ONLY public.payment_gateways FORCE ROW LEVEL SECURITY;


ALTER TABLE public.payment_gateways OWNER TO postgres;

--
-- Name: payment_plans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payment_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    invoice_id uuid,
    treatment_plan_id uuid,
    currency character(3) NOT NULL,
    total_minor bigint NOT NULL,
    down_payment_minor bigint DEFAULT 0 NOT NULL,
    installments_count smallint NOT NULL,
    start_date date NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_plans_check CHECK ((down_payment_minor < total_minor)),
    CONSTRAINT payment_plans_down_payment_minor_check CHECK ((down_payment_minor >= 0)),
    CONSTRAINT payment_plans_installments_count_check CHECK (((installments_count >= 1) AND (installments_count <= 60))),
    CONSTRAINT payment_plans_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'defaulted'::text, 'cancelled'::text]))),
    CONSTRAINT payment_plans_total_minor_check CHECK ((total_minor > 0))
);

ALTER TABLE ONLY public.payment_plans FORCE ROW LEVEL SECURITY;


ALTER TABLE public.payment_plans OWNER TO postgres;

--
-- Name: payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    invoice_id uuid,
    appointment_id uuid,
    installment_id uuid,
    amount_minor bigint NOT NULL,
    currency character(3) NOT NULL,
    method text NOT NULL,
    status text DEFAULT 'succeeded'::text NOT NULL,
    refunded_minor bigint DEFAULT 0 NOT NULL,
    provider text,
    provider_ref text,
    idempotency_key text,
    received_by uuid,
    paid_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reference text,
    reversed_at timestamp with time zone,
    reversed_by uuid,
    reversal_reason text,
    CONSTRAINT payments_amount_minor_check CHECK ((amount_minor > 0)),
    CONSTRAINT payments_check CHECK ((refunded_minor <= amount_minor)),
    CONSTRAINT payments_check1 CHECK (((status <> 'succeeded'::text) OR (paid_at IS NOT NULL))),
    CONSTRAINT payments_check2 CHECK (((method <> 'online'::text) OR (provider IS NOT NULL))),
    CONSTRAINT payments_method_check CHECK ((method = ANY (ARRAY['cash'::text, 'card'::text, 'wallet'::text, 'bank_transfer'::text, 'instapay'::text, 'online'::text, 'insurance'::text]))),
    CONSTRAINT payments_notes_length CHECK ((char_length(notes) <= 500)),
    CONSTRAINT payments_reference_length CHECK (((char_length(reference) >= 1) AND (char_length(reference) <= 100))),
    CONSTRAINT payments_reference_required CHECK (((method <> ALL (ARRAY['bank_transfer'::text, 'wallet'::text, 'instapay'::text])) OR (reference IS NOT NULL))),
    CONSTRAINT payments_refunded_minor_check CHECK ((refunded_minor >= 0)),
    CONSTRAINT payments_reversal_complete CHECK (((status = 'reversed'::text) = ((reversed_at IS NOT NULL) AND (reversal_reason IS NOT NULL) AND (char_length(btrim(reversal_reason)) >= 3)))),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'refunded'::text, 'partially_refunded'::text, 'reversed'::text])))
);

ALTER TABLE ONLY public.payments FORCE ROW LEVEL SECURITY;


ALTER TABLE public.payments OWNER TO postgres;

--
-- Name: plans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name_en text NOT NULL,
    name_ar text NOT NULL,
    price_monthly_minor bigint NOT NULL,
    price_yearly_minor bigint NOT NULL,
    currency character(3) DEFAULT 'EGP'::bpchar NOT NULL,
    trial_days integer DEFAULT 14 NOT NULL,
    limits jsonb DEFAULT '{}'::jsonb NOT NULL,
    features jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_public boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plans_price_monthly_minor_check CHECK ((price_monthly_minor >= 0)),
    CONSTRAINT plans_price_yearly_minor_check CHECK ((price_yearly_minor >= 0)),
    CONSTRAINT plans_trial_days_check CHECK ((trial_days >= 0))
);


ALTER TABLE public.plans OWNER TO postgres;

--
-- Name: platform_audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.platform_audit_log (
    id bigint NOT NULL,
    actor_user_id uuid,
    action text NOT NULL,
    tenant_id uuid,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.platform_audit_log OWNER TO postgres;

--
-- Name: platform_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.platform_audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.platform_audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: platform_invoice_number_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.platform_invoice_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.platform_invoice_number_seq OWNER TO postgres;

--
-- Name: platform_invoices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.platform_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    number text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    amount_minor bigint NOT NULL,
    tax_minor bigint DEFAULT 0 NOT NULL,
    currency character(3) NOT NULL,
    status text NOT NULL,
    provider text,
    provider_ref text,
    pdf_file_key text,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    billing_cycle text,
    note text,
    recorded_by uuid,
    idempotency_key uuid,
    CONSTRAINT platform_invoices_amount_minor_check CHECK ((amount_minor >= 0)),
    CONSTRAINT platform_invoices_check CHECK ((period_end >= period_start)),
    CONSTRAINT platform_invoices_cycle CHECK ((billing_cycle = ANY (ARRAY['monthly'::text, 'yearly'::text]))),
    CONSTRAINT platform_invoices_method CHECK (((provider IS NULL) OR (provider = ANY (ARRAY['instapay'::text, 'vodafone_cash'::text, 'bank_transfer'::text, 'cash'::text, 'other'::text])))),
    CONSTRAINT platform_invoices_note CHECK ((char_length(note) <= 500)),
    CONSTRAINT platform_invoices_period CHECK ((period_end > period_start)),
    CONSTRAINT platform_invoices_status_check CHECK ((status = ANY (ARRAY['open'::text, 'paid'::text, 'failed'::text, 'void'::text, 'refunded'::text]))),
    CONSTRAINT platform_invoices_tax_minor_check CHECK ((tax_minor >= 0))
);

ALTER TABLE ONLY public.platform_invoices FORCE ROW LEVEL SECURITY;


ALTER TABLE public.platform_invoices OWNER TO postgres;

--
-- Name: platform_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.platform_settings (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT platform_settings_key_check CHECK ((key = 'billing_instructions'::text)),
    CONSTRAINT platform_settings_value_check CHECK ((char_length(value) <= 2000))
);


ALTER TABLE public.platform_settings OWNER TO postgres;

--
-- Name: platform_tenant_notes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.platform_tenant_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    author_user_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_tenant_notes_body_check CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 2000)))
);


ALTER TABLE public.platform_tenant_notes OWNER TO postgres;

--
-- Name: posts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    locale text NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    excerpt text,
    body text NOT NULL,
    cover_file_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    seo jsonb DEFAULT '{}'::jsonb NOT NULL,
    published_at timestamp with time zone,
    author_member_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT posts_check CHECK (((slug ~ '^[a-z0-9-]{1,120}$'::text) OR (locale = 'ar'::text))),
    CONSTRAINT posts_check1 CHECK (((status <> 'published'::text) OR (published_at IS NOT NULL))),
    CONSTRAINT posts_locale_check CHECK ((locale = ANY (ARRAY['ar'::text, 'en'::text]))),
    CONSTRAINT posts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))
);

ALTER TABLE ONLY public.posts FORCE ROW LEVEL SECURITY;


ALTER TABLE public.posts OWNER TO postgres;

--
-- Name: prescription_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.prescription_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    prescription_id uuid NOT NULL,
    drug_name text NOT NULL,
    dose text,
    frequency text,
    duration text,
    instructions text,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT prescription_items_lengths CHECK ((((char_length(btrim(drug_name)) >= 1) AND (char_length(btrim(drug_name)) <= 200)) AND (COALESCE(char_length(dose), 0) <= 100) AND (COALESCE(char_length(frequency), 0) <= 100) AND (COALESCE(char_length(duration), 0) <= 100) AND (COALESCE(char_length(instructions), 0) <= 500)))
);

ALTER TABLE ONLY public.prescription_items FORCE ROW LEVEL SECURITY;


ALTER TABLE public.prescription_items OWNER TO postgres;

--
-- Name: prescriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.prescriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    visit_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    notes text,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    replaces_id uuid,
    issued_by uuid,
    CONSTRAINT prescriptions_notes_length CHECK ((COALESCE(char_length(notes), 0) <= 1000))
);

ALTER TABLE ONLY public.prescriptions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.prescriptions OWNER TO postgres;

--
-- Name: recalls; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.recalls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    doctor_id uuid,
    reason text NOT NULL,
    due_date date NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    appointment_id uuid,
    source_visit_id uuid,
    last_contacted_at timestamp with time zone,
    contact_attempts smallint DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    CONSTRAINT recalls_check CHECK (((status <> 'booked'::text) OR (appointment_id IS NOT NULL))),
    CONSTRAINT recalls_notes_length CHECK ((COALESCE(char_length(notes), 0) <= 4000)),
    CONSTRAINT recalls_reason_check CHECK ((reason = ANY (ARRAY['checkup'::text, 'cleaning'::text, 'ortho_adjustment'::text, 'post_op'::text, 'implant_followup'::text, 'other'::text]))),
    CONSTRAINT recalls_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'contacted'::text, 'booked'::text, 'done'::text, 'dismissed'::text])))
);

ALTER TABLE ONLY public.recalls FORCE ROW LEVEL SECURITY;


ALTER TABLE public.recalls OWNER TO postgres;

--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tenant_id uuid,
    token_hash text NOT NULL,
    family_id uuid NOT NULL,
    user_agent text,
    ip inet,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    family_started_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.refresh_tokens OWNER TO postgres;

--
-- Name: refunds; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    payment_id uuid NOT NULL,
    amount_minor bigint NOT NULL,
    reason text NOT NULL,
    provider_ref text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    method text NOT NULL,
    branch_id uuid NOT NULL,
    reference text,
    refunded_at timestamp with time zone DEFAULT now() NOT NULL,
    idempotency_key text,
    CONSTRAINT refunds_amount_minor_check CHECK ((amount_minor > 0)),
    CONSTRAINT refunds_method_check CHECK ((method = ANY (ARRAY['cash'::text, 'card'::text, 'wallet'::text, 'bank_transfer'::text, 'instapay'::text, 'online'::text, 'insurance'::text]))),
    CONSTRAINT refunds_reason_length CHECK (((char_length(btrim(reason)) >= 1) AND (char_length(btrim(reason)) <= 500))),
    CONSTRAINT refunds_reference_length CHECK (((char_length(reference) >= 1) AND (char_length(reference) <= 100)))
);

ALTER TABLE ONLY public.refunds FORCE ROW LEVEL SECURITY;


ALTER TABLE public.refunds OWNER TO postgres;

--
-- Name: reviews; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    patient_id uuid,
    appointment_id uuid,
    doctor_id uuid,
    author_name text NOT NULL,
    rating smallint NOT NULL,
    comment text,
    status text DEFAULT 'pending'::text NOT NULL,
    source text DEFAULT 'link'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT reviews_source_check CHECK ((source = ANY (ARRAY['link'::text, 'manual'::text, 'google_import'::text]))),
    CONSTRAINT reviews_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'hidden'::text])))
);

ALTER TABLE ONLY public.reviews FORCE ROW LEVEL SECURITY;


ALTER TABLE public.reviews OWNER TO postgres;

--
-- Name: roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    key text NOT NULL,
    name_en text NOT NULL,
    name_ar text NOT NULL,
    permissions text[] DEFAULT '{}'::text[] NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    max_discount_bp integer DEFAULT 0 NOT NULL,
    max_discount_minor bigint,
    archived_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT roles_max_discount_bp CHECK (((max_discount_bp >= 0) AND (max_discount_bp <= 10000))),
    CONSTRAINT roles_max_discount_minor CHECK (((max_discount_minor IS NULL) OR (max_discount_minor >= 0))),
    CONSTRAINT roles_name_ar_length CHECK (((char_length(btrim(name_ar)) >= 2) AND (char_length(btrim(name_ar)) <= 60)))
);

ALTER TABLE ONLY public.roles FORCE ROW LEVEL SECURITY;


ALTER TABLE public.roles OWNER TO postgres;

--
-- Name: rooms; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.rooms FORCE ROW LEVEL SECURITY;


ALTER TABLE public.rooms OWNER TO postgres;

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO postgres;

--
-- Name: service_catalog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.service_catalog (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    category text NOT NULL,
    name_en text NOT NULL,
    name_ar text NOT NULL,
    default_duration_minutes integer NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT service_catalog_default_duration_minutes_check CHECK ((default_duration_minutes > 0))
);


ALTER TABLE public.service_catalog OWNER TO postgres;

--
-- Name: service_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.service_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name_en text,
    name_ar text,
    sort_order integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.service_categories FORCE ROW LEVEL SECURITY;


ALTER TABLE public.service_categories OWNER TO postgres;

--
-- Name: services; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    category_id uuid,
    catalog_code text,
    name_en text,
    name_ar text,
    description_en text,
    description_ar text,
    price_minor bigint DEFAULT 0 NOT NULL,
    price_max_minor bigint,
    duration_minutes integer NOT NULL,
    image_file_id uuid,
    bookable_online boolean DEFAULT true NOT NULL,
    show_on_website boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    consent_key text,
    deleted_at timestamp with time zone,
    CONSTRAINT services_check CHECK (((price_max_minor IS NULL) OR (price_max_minor >= price_minor))),
    CONSTRAINT services_check1 CHECK (((name_en IS NOT NULL) OR (name_ar IS NOT NULL))),
    CONSTRAINT services_consent_key CHECK ((consent_key ~ '^[a-z0-9][a-z0-9_-]{1,39}$'::text)),
    CONSTRAINT services_deleted_is_off CHECK (((deleted_at IS NULL) OR ((NOT is_active) AND (NOT show_on_website) AND (NOT bookable_online)))),
    CONSTRAINT services_duration_minutes_check CHECK (((duration_minutes >= 5) AND (duration_minutes <= 480))),
    CONSTRAINT services_price_minor_check CHECK ((price_minor >= 0))
);

ALTER TABLE ONLY public.services FORCE ROW LEVEL SECURITY;


ALTER TABLE public.services OWNER TO postgres;

--
-- Name: site_pages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.site_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    site_id uuid NOT NULL,
    slug text NOT NULL,
    title_en text,
    title_ar text,
    draft_sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    published_sections jsonb,
    seo jsonb DEFAULT '{}'::jsonb NOT NULL,
    show_in_nav boolean DEFAULT true NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT site_pages_slug_check CHECK ((slug ~ '^([a-z0-9-]{1,64})?$'::text))
);

ALTER TABLE ONLY public.site_pages FORCE ROW LEVEL SECURITY;


ALTER TABLE public.site_pages OWNER TO postgres;

--
-- Name: sites; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    template_id uuid NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    draft_theme jsonb DEFAULT '{}'::jsonb NOT NULL,
    published_theme jsonb,
    published_version integer DEFAULT 0 NOT NULL,
    published_at timestamp with time zone,
    locales text[] DEFAULT '{ar}'::text[] NOT NULL,
    favicon_file_id uuid,
    show_powered_by boolean DEFAULT true NOT NULL,
    ga_measurement_id text,
    meta_pixel_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    seo_title text,
    seo_description text,
    share_file_id uuid,
    CONSTRAINT sites_locales_check CHECK (((locales <@ ARRAY['ar'::text, 'en'::text]) AND (cardinality(locales) > 0))),
    CONSTRAINT sites_published_primary_hex CHECK (((published_theme IS NULL) OR (NOT (published_theme ? 'primary'::text)) OR ((published_theme ->> 'primary'::text) ~ '^#[0-9a-fA-F]{6}$'::text))),
    CONSTRAINT sites_sections_array CHECK (((jsonb_typeof(sections) = 'array'::text) AND (jsonb_array_length(sections) <= 20))),
    CONSTRAINT sites_seo_description CHECK (((seo_description IS NULL) OR ((char_length(btrim(seo_description)) >= 20) AND (char_length(btrim(seo_description)) <= 200)))),
    CONSTRAINT sites_seo_title CHECK (((seo_title IS NULL) OR ((char_length(btrim(seo_title)) >= 5) AND (char_length(btrim(seo_title)) <= 70)))),
    CONSTRAINT sites_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'maintenance'::text]))),
    CONSTRAINT sites_theme_primary_hex CHECK (((NOT (draft_theme ? 'primary'::text)) OR ((draft_theme ->> 'primary'::text) ~ '^#[0-9a-fA-F]{6}$'::text)))
);

ALTER TABLE ONLY public.sites FORCE ROW LEVEL SECURITY;


ALTER TABLE public.sites OWNER TO postgres;

--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    status text NOT NULL,
    billing_cycle text DEFAULT 'monthly'::text NOT NULL,
    trial_ends_at timestamp with time zone,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    grace_ends_at timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    provider text,
    provider_customer_id text,
    provider_subscription_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscriptions_billing_cycle_check CHECK ((billing_cycle = ANY (ARRAY['monthly'::text, 'yearly'::text]))),
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'suspended'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.subscriptions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.subscriptions OWNER TO postgres;

--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    phone text,
    email public.citext,
    notes text,
    is_active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.suppliers FORCE ROW LEVEL SECURITY;


ALTER TABLE public.suppliers OWNER TO postgres;

--
-- Name: templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    preview_url text,
    sections_schema jsonb DEFAULT '{}'::jsonb NOT NULL,
    default_theme jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    min_plan_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.templates OWNER TO postgres;

--
-- Name: tenant_counters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tenant_counters (
    tenant_id uuid NOT NULL,
    key text NOT NULL,
    value bigint DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.tenant_counters FORCE ROW LEVEL SECURITY;


ALTER TABLE public.tenant_counters OWNER TO postgres;

--
-- Name: tenant_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tenant_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    all_branches boolean DEFAULT true NOT NULL,
    job_title text,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    access_version integer DEFAULT 0 NOT NULL,
    CONSTRAINT tenant_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);

ALTER TABLE ONLY public.tenant_members FORCE ROW LEVEL SECURITY;


ALTER TABLE public.tenant_members OWNER TO postgres;

--
-- Name: tenant_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tenant_settings (
    tenant_id uuid NOT NULL,
    booking_auto_confirm boolean DEFAULT false NOT NULL,
    booking_otp_required boolean DEFAULT true NOT NULL,
    booking_min_notice_minutes integer DEFAULT 120 NOT NULL,
    booking_max_days_ahead integer DEFAULT 60 NOT NULL,
    booking_slot_step_minutes integer DEFAULT 15 NOT NULL,
    booking_cancel_window_hours integer DEFAULT 12 NOT NULL,
    booking_payment_mode text DEFAULT 'at_clinic'::text NOT NULL,
    booking_deposit_minor bigint,
    reminder_offsets_minutes integer[] DEFAULT '{1440,120}'::integer[] NOT NULL,
    invoice_prefix text DEFAULT 'INV'::text NOT NULL,
    tax_rate_bp integer DEFAULT 0 NOT NULL,
    tax_registration_no text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reception_expense_limit_minor bigint DEFAULT 50000 NOT NULL,
    CONSTRAINT tenant_settings_booking_cancel_window_hours_check CHECK ((booking_cancel_window_hours >= 0)),
    CONSTRAINT tenant_settings_booking_deposit_minor_check CHECK ((booking_deposit_minor >= 0)),
    CONSTRAINT tenant_settings_booking_max_days_ahead_check CHECK (((booking_max_days_ahead >= 1) AND (booking_max_days_ahead <= 365))),
    CONSTRAINT tenant_settings_booking_min_notice_minutes_check CHECK ((booking_min_notice_minutes >= 0)),
    CONSTRAINT tenant_settings_booking_payment_mode_check CHECK ((booking_payment_mode = ANY (ARRAY['at_clinic'::text, 'deposit'::text, 'full_online'::text, 'patient_choice'::text]))),
    CONSTRAINT tenant_settings_booking_slot_step_minutes_check CHECK ((booking_slot_step_minutes = ANY (ARRAY[5, 10, 15, 20, 30, 60]))),
    CONSTRAINT tenant_settings_reception_expense_limit CHECK (((reception_expense_limit_minor >= 0) AND (reception_expense_limit_minor <= 100000000))),
    CONSTRAINT tenant_settings_reminder_offsets CHECK (((cardinality(reminder_offsets_minutes) <= 4) AND (15 <= ALL (reminder_offsets_minutes)) AND (10080 >= ALL (reminder_offsets_minutes)))),
    CONSTRAINT tenant_settings_tax_rate_bp_check CHECK (((tax_rate_bp >= 0) AND (tax_rate_bp <= 10000)))
);

ALTER TABLE ONLY public.tenant_settings FORCE ROW LEVEL SECURITY;


ALTER TABLE public.tenant_settings OWNER TO postgres;

--
-- Name: tenants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug public.citext NOT NULL,
    name_en text,
    name_ar text,
    status text DEFAULT 'onboarding'::text NOT NULL,
    onboarding_step smallint DEFAULT 1 NOT NULL,
    country character(2) DEFAULT 'EG'::bpchar NOT NULL,
    timezone text DEFAULT 'Africa/Cairo'::text NOT NULL,
    currency character(3) DEFAULT 'EGP'::bpchar NOT NULL,
    default_locale text DEFAULT 'ar'::text NOT NULL,
    logo_file_id uuid,
    primary_phone text,
    whatsapp text,
    email public.citext,
    social_links jsonb DEFAULT '{}'::jsonb NOT NULL,
    specialties text[] DEFAULT '{}'::text[] NOT NULL,
    about_en text,
    about_ar text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    suspended_at timestamp with time zone,
    suspension_reason text,
    suspension_kind text,
    status_before_suspension text,
    delete_after timestamp with time zone,
    deletion_requested_by uuid,
    status_before_cancellation text,
    CONSTRAINT tenants_check CHECK (((name_en IS NOT NULL) OR (name_ar IS NOT NULL))),
    CONSTRAINT tenants_currency_code CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT tenants_default_locale_check CHECK ((default_locale = ANY (ARRAY['ar'::text, 'en'::text]))),
    CONSTRAINT tenants_deletion CHECK (((deleted_at IS NULL) = (delete_after IS NULL))),
    CONSTRAINT tenants_onboarding_step_check CHECK (((onboarding_step >= 1) AND (onboarding_step <= 7))),
    CONSTRAINT tenants_slug_check CHECK ((slug OPERATOR(public.~) '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$'::public.citext)),
    CONSTRAINT tenants_status_check CHECK ((status = ANY (ARRAY['onboarding'::text, 'trialing'::text, 'active'::text, 'past_due'::text, 'suspended'::text, 'cancelled'::text]))),
    CONSTRAINT tenants_suspension_kind CHECK ((suspension_kind = ANY (ARRAY['manual'::text, 'trial_ended'::text, 'unpaid'::text]))),
    CONSTRAINT tenants_suspension_reason CHECK (((char_length(suspension_reason) >= 3) AND (char_length(suspension_reason) <= 300)))
);

ALTER TABLE ONLY public.tenants FORCE ROW LEVEL SECURITY;


ALTER TABLE public.tenants OWNER TO postgres;

--
-- Name: tooth_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tooth_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    visit_id uuid,
    tooth_code smallint NOT NULL,
    surfaces text[] DEFAULT '{}'::text[] NOT NULL,
    condition text NOT NULL,
    notes text,
    recorded_by uuid,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tooth_records_condition_check CHECK ((condition = ANY (ARRAY['healthy'::text, 'caries'::text, 'filled'::text, 'crown'::text, 'bridge'::text, 'missing'::text, 'implant'::text, 'root_canal'::text, 'fractured'::text, 'extraction_needed'::text, 'veneer'::text, 'sealant'::text, 'other'::text]))),
    CONSTRAINT tooth_records_notes_length CHECK ((COALESCE(char_length(notes), 0) <= 1000)),
    CONSTRAINT tooth_records_surfaces_check CHECK ((surfaces <@ ARRAY['M'::text, 'O'::text, 'D'::text, 'B'::text, 'L'::text, 'I'::text, 'F'::text, 'P'::text])),
    CONSTRAINT tooth_records_tooth_code_check CHECK ((((((tooth_code / 10) >= 1) AND ((tooth_code / 10) <= 4)) AND ((((tooth_code)::integer % 10) >= 1) AND (((tooth_code)::integer % 10) <= 8))) OR ((((tooth_code / 10) >= 5) AND ((tooth_code / 10) <= 8)) AND ((((tooth_code)::integer % 10) >= 1) AND (((tooth_code)::integer % 10) <= 5)))))
);

ALTER TABLE ONLY public.tooth_records FORCE ROW LEVEL SECURITY;


ALTER TABLE public.tooth_records OWNER TO postgres;

--
-- Name: treatment_plan_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.treatment_plan_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    service_id uuid NOT NULL,
    tooth_code smallint,
    surfaces text[] DEFAULT '{}'::text[] NOT NULL,
    price_minor bigint NOT NULL,
    discount_minor bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'planned'::text NOT NULL,
    appointment_id uuid,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT treatment_plan_items_check CHECK ((discount_minor <= price_minor)),
    CONSTRAINT treatment_plan_items_discount_minor_check CHECK ((discount_minor >= 0)),
    CONSTRAINT treatment_plan_items_price_minor_check CHECK ((price_minor >= 0)),
    CONSTRAINT treatment_plan_items_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'scheduled'::text, 'done'::text, 'cancelled'::text]))),
    CONSTRAINT treatment_plan_items_surfaces CHECK ((surfaces <@ ARRAY['M'::text, 'O'::text, 'D'::text, 'B'::text, 'L'::text, 'I'::text, 'F'::text, 'P'::text])),
    CONSTRAINT treatment_plan_items_tooth CHECK (((tooth_code IS NULL) OR ((((tooth_code / 10) >= 1) AND ((tooth_code / 10) <= 4)) AND ((((tooth_code)::integer % 10) >= 1) AND (((tooth_code)::integer % 10) <= 8))) OR ((((tooth_code / 10) >= 5) AND ((tooth_code / 10) <= 8)) AND ((((tooth_code)::integer % 10) >= 1) AND (((tooth_code)::integer % 10) <= 5)))))
);

ALTER TABLE ONLY public.treatment_plan_items FORCE ROW LEVEL SECURITY;


ALTER TABLE public.treatment_plan_items OWNER TO postgres;

--
-- Name: treatment_plans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.treatment_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    title text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    total_estimate_minor bigint DEFAULT 0 NOT NULL,
    notes text,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_by uuid,
    CONSTRAINT treatment_plans_accepted_recorded CHECK (((status <> ALL (ARRAY['accepted'::text, 'in_progress'::text, 'completed'::text])) OR (accepted_at IS NOT NULL))),
    CONSTRAINT treatment_plans_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'proposed'::text, 'accepted'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text]))),
    CONSTRAINT treatment_plans_title_length CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 200))),
    CONSTRAINT treatment_plans_total_estimate_minor_check CHECK ((total_estimate_minor >= 0))
);

ALTER TABLE ONLY public.treatment_plans FORCE ROW LEVEL SECURITY;


ALTER TABLE public.treatment_plans OWNER TO postgres;

--
-- Name: usage_counters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.usage_counters (
    tenant_id uuid NOT NULL,
    metric text NOT NULL,
    period_start date NOT NULL,
    value bigint DEFAULT 0 NOT NULL,
    CONSTRAINT usage_counters_value_check CHECK ((value >= 0))
);

ALTER TABLE ONLY public.usage_counters FORCE ROW LEVEL SECURITY;


ALTER TABLE public.usage_counters OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email public.citext,
    phone text,
    password_hash text,
    google_sub text,
    full_name text NOT NULL,
    avatar_url text,
    locale text DEFAULT 'ar'::text NOT NULL,
    email_verified_at timestamp with time zone,
    phone_verified_at timestamp with time zone,
    totp_secret_enc bytea,
    platform_role text,
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sessions_revoked_at timestamp with time zone,
    CONSTRAINT users_check CHECK (((email IS NOT NULL) OR (phone IS NOT NULL))),
    CONSTRAINT users_locale_check CHECK ((locale = ANY (ARRAY['ar'::text, 'en'::text]))),
    CONSTRAINT users_phone_check CHECK (((phone IS NULL) OR (phone ~ '^\+[1-9][0-9]{7,14}$'::text))),
    CONSTRAINT users_platform_role_check CHECK ((platform_role = ANY (ARRAY['super_admin'::text, 'support'::text])))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: visit_amendments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.visit_amendments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    visit_id uuid NOT NULL,
    field text NOT NULL,
    new_text text NOT NULL,
    reason text NOT NULL,
    author_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT visit_amendments_field CHECK ((field = ANY (ARRAY['chief_complaint'::text, 'diagnosis'::text, 'clinical_notes'::text, 'next_visit_note'::text]))),
    CONSTRAINT visit_amendments_reason CHECK (((char_length(btrim(reason)) >= 3) AND (char_length(btrim(reason)) <= 500))),
    CONSTRAINT visit_amendments_text_length CHECK ((char_length(new_text) <= 10000))
);

ALTER TABLE ONLY public.visit_amendments FORCE ROW LEVEL SECURITY;


ALTER TABLE public.visit_amendments OWNER TO postgres;

--
-- Name: visit_procedures; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.visit_procedures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    visit_id uuid NOT NULL,
    service_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    plan_item_id uuid,
    tooth_code smallint,
    surfaces text[] DEFAULT '{}'::text[] NOT NULL,
    price_minor bigint NOT NULL,
    commission_bp integer DEFAULT 0 NOT NULL,
    commission_minor bigint GENERATED ALWAYS AS (((price_minor * commission_bp) / 10000)) STORED,
    payout_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    CONSTRAINT visit_procedures_commission_bp_check CHECK (((commission_bp >= 0) AND (commission_bp <= 10000))),
    CONSTRAINT visit_procedures_price_minor_check CHECK ((price_minor >= 0)),
    CONSTRAINT visit_procedures_surfaces CHECK ((surfaces <@ ARRAY['M'::text, 'O'::text, 'D'::text, 'B'::text, 'L'::text, 'I'::text, 'F'::text, 'P'::text])),
    CONSTRAINT visit_procedures_tooth CHECK (((tooth_code IS NULL) OR ((((tooth_code / 10) >= 1) AND ((tooth_code / 10) <= 4)) AND ((((tooth_code)::integer % 10) >= 1) AND (((tooth_code)::integer % 10) <= 8))) OR ((((tooth_code / 10) >= 5) AND ((tooth_code / 10) <= 8)) AND ((((tooth_code)::integer % 10) >= 1) AND (((tooth_code)::integer % 10) <= 5)))))
);

ALTER TABLE ONLY public.visit_procedures FORCE ROW LEVEL SECURITY;


ALTER TABLE public.visit_procedures OWNER TO postgres;

--
-- Name: visits; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    appointment_id uuid,
    patient_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    visit_at timestamp with time zone DEFAULT now() NOT NULL,
    chief_complaint text,
    diagnosis text,
    clinical_notes text,
    next_visit_note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    finalized_at timestamp with time zone,
    finalized_by uuid,
    CONSTRAINT visits_finalized_complete CHECK (((status = 'final'::text) = (finalized_at IS NOT NULL))),
    CONSTRAINT visits_status CHECK ((status = ANY (ARRAY['draft'::text, 'final'::text]))),
    CONSTRAINT visits_text_length CHECK (((COALESCE(char_length(chief_complaint), 0) <= 2000) AND (COALESCE(char_length(diagnosis), 0) <= 2000) AND (COALESCE(char_length(clinical_notes), 0) <= 10000) AND (COALESCE(char_length(next_visit_note), 0) <= 2000)))
);

ALTER TABLE ONLY public.visits FORCE ROW LEVEL SECURITY;


ALTER TABLE public.visits OWNER TO postgres;

--
-- Name: waitlist_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.waitlist_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    doctor_id uuid,
    service_id uuid,
    earliest_date date NOT NULL,
    latest_date date NOT NULL,
    preferred_period text,
    status text DEFAULT 'waiting'::text NOT NULL,
    offered_appointment_id uuid,
    offer_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT waitlist_entries_check CHECK ((latest_date >= earliest_date)),
    CONSTRAINT waitlist_entries_check1 CHECK (((status <> 'offered'::text) OR ((offered_appointment_id IS NOT NULL) AND (offer_expires_at IS NOT NULL)))),
    CONSTRAINT waitlist_entries_preferred_period_check CHECK ((preferred_period = ANY (ARRAY['morning'::text, 'afternoon'::text, 'evening'::text, 'any'::text]))),
    CONSTRAINT waitlist_entries_status_check CHECK ((status = ANY (ARRAY['waiting'::text, 'offered'::text, 'booked'::text, 'expired'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.waitlist_entries FORCE ROW LEVEL SECURITY;


ALTER TABLE public.waitlist_entries OWNER TO postgres;

--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    event_id text NOT NULL,
    tenant_id uuid,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    error text
);


ALTER TABLE public.webhook_events OWNER TO postgres;

--
-- Name: appointments appointments_manage_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_manage_token_hash_key UNIQUE (manage_token_hash);


--
-- Name: appointments appointments_no_doctor_overlap; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_no_doctor_overlap EXCLUDE USING gist (doctor_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE ((status <> ALL (ARRAY['cancelled'::text, 'no_show'::text, 'expired'::text])));


--
-- Name: appointments appointments_no_room_overlap; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_no_room_overlap EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (((room_id IS NOT NULL) AND (status <> ALL (ARRAY['cancelled'::text, 'no_show'::text, 'expired'::text]))));


--
-- Name: appointments appointments_patient_reschedules; Type: CHECK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE public.appointments
    ADD CONSTRAINT appointments_patient_reschedules CHECK ((patient_reschedules >= 0)) NOT VALID;


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: appointments appointments_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: auth_events auth_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_events
    ADD CONSTRAINT auth_events_pkey PRIMARY KEY (id);


--
-- Name: balance_adjustments balance_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.balance_adjustments
    ADD CONSTRAINT balance_adjustments_pkey PRIMARY KEY (id);


--
-- Name: branch_hours branch_hours_no_overlap; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branch_hours
    ADD CONSTRAINT branch_hours_no_overlap EXCLUDE USING gist (branch_id WITH =, weekday WITH =, tsrange(('2000-01-01'::date + opens_at), ('2000-01-01'::date + closes_at), '[)'::text) WITH &&);


--
-- Name: branch_hours branch_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branch_hours
    ADD CONSTRAINT branch_hours_pkey PRIMARY KEY (id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: branches branches_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: branches branches_tenant_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_tenant_id_slug_key UNIQUE (tenant_id, slug);


--
-- Name: cash_session_reopenings cash_session_reopenings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_session_reopenings
    ADD CONSTRAINT cash_session_reopenings_pkey PRIMARY KEY (id);


--
-- Name: cash_sessions cash_sessions_one_per_day; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT cash_sessions_one_per_day UNIQUE (tenant_id, branch_id, business_date);


--
-- Name: cash_sessions cash_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT cash_sessions_pkey PRIMARY KEY (id);


--
-- Name: cash_sessions cash_sessions_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT cash_sessions_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: consent_templates consent_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.consent_templates
    ADD CONSTRAINT consent_templates_pkey PRIMARY KEY (id);


--
-- Name: consent_templates consent_templates_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.consent_templates
    ADD CONSTRAINT consent_templates_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: consent_templates consent_templates_tenant_id_key_version_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.consent_templates
    ADD CONSTRAINT consent_templates_tenant_id_key_version_key UNIQUE (tenant_id, key, version);


--
-- Name: data_exports data_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.data_exports
    ADD CONSTRAINT data_exports_pkey PRIMARY KEY (id);


--
-- Name: doctor_branches doctor_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_branches
    ADD CONSTRAINT doctor_branches_pkey PRIMARY KEY (doctor_id, branch_id);


--
-- Name: doctor_payouts doctor_payouts_no_overlap; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_payouts
    ADD CONSTRAINT doctor_payouts_no_overlap EXCLUDE USING gist (doctor_id WITH =, daterange(period_start, period_end, '[]'::text) WITH &&) WHERE ((status <> 'void'::text));


--
-- Name: doctor_payouts doctor_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_payouts
    ADD CONSTRAINT doctor_payouts_pkey PRIMARY KEY (id);


--
-- Name: doctor_payouts doctor_payouts_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_payouts
    ADD CONSTRAINT doctor_payouts_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: doctor_schedules doctor_schedules_no_overlap; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_schedules
    ADD CONSTRAINT doctor_schedules_no_overlap EXCLUDE USING gist (doctor_id WITH =, weekday WITH =, tsrange(('2000-01-01'::date + starts_at), ('2000-01-01'::date + ends_at)) WITH &&);


--
-- Name: doctor_schedules doctor_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_schedules
    ADD CONSTRAINT doctor_schedules_pkey PRIMARY KEY (id);


--
-- Name: doctor_services doctor_services_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_services
    ADD CONSTRAINT doctor_services_pkey PRIMARY KEY (doctor_id, service_id);


--
-- Name: doctor_time_off doctor_time_off_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_time_off
    ADD CONSTRAINT doctor_time_off_pkey PRIMARY KEY (id);


--
-- Name: doctors doctors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctors
    ADD CONSTRAINT doctors_pkey PRIMARY KEY (id);


--
-- Name: doctors doctors_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctors
    ADD CONSTRAINT doctors_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: domains domains_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.domains
    ADD CONSTRAINT domains_pkey PRIMARY KEY (id);


--
-- Name: expense_categories expense_categories_name_length; Type: CHECK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE public.expense_categories
    ADD CONSTRAINT expense_categories_name_length CHECK (((char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 80))) NOT VALID;


--
-- Name: expense_categories expense_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_pkey PRIMARY KEY (id);


--
-- Name: expense_categories expense_categories_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: expense_categories expense_categories_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: expenses expenses_method_required; Type: CHECK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE public.expenses
    ADD CONSTRAINT expenses_method_required CHECK ((payment_method IS NOT NULL)) NOT VALID;


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: faqs faqs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.faqs
    ADD CONSTRAINT faqs_pkey PRIMARY KEY (id);


--
-- Name: files files_bucket_object_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_bucket_object_key_key UNIQUE (bucket, object_key);


--
-- Name: files files_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);


--
-- Name: files files_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: gallery_items gallery_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.gallery_items
    ADD CONSTRAINT gallery_items_pkey PRIMARY KEY (id);


--
-- Name: gallery_items gallery_items_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.gallery_items
    ADD CONSTRAINT gallery_items_tenant_id_key UNIQUE (tenant_id, id);


--
-- Name: holidays holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_pkey PRIMARY KEY (id);


--
-- Name: in_app_notifications in_app_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.in_app_notifications
    ADD CONSTRAINT in_app_notifications_pkey PRIMARY KEY (id);


--
-- Name: installments installments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.installments
    ADD CONSTRAINT installments_pkey PRIMARY KEY (id);


--
-- Name: installments installments_plan_id_seq_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.installments
    ADD CONSTRAINT installments_plan_id_seq_key UNIQUE (plan_id, seq);


--
-- Name: installments installments_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.installments
    ADD CONSTRAINT installments_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: inventory_items inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);


--
-- Name: inventory_items inventory_items_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: inventory_items inventory_items_tenant_id_sku_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_tenant_id_sku_key UNIQUE (tenant_id, sku);


--
-- Name: inventory_movements inventory_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (id);


--
-- Name: inventory_stock inventory_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_stock
    ADD CONSTRAINT inventory_stock_pkey PRIMARY KEY (item_id, branch_id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_hash_key UNIQUE (token_hash);


--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: invoices invoices_tenant_id_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tenant_id_number_key UNIQUE (tenant_id, number);


--
-- Name: lab_orders lab_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lab_orders
    ADD CONSTRAINT lab_orders_pkey PRIMARY KEY (id);


--
-- Name: lab_orders lab_orders_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lab_orders
    ADD CONSTRAINT lab_orders_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: labs labs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.labs
    ADD CONSTRAINT labs_pkey PRIMARY KEY (id);


--
-- Name: labs labs_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.labs
    ADD CONSTRAINT labs_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: labs labs_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.labs
    ADD CONSTRAINT labs_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: legal_acceptances legal_acceptances_once; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.legal_acceptances
    ADD CONSTRAINT legal_acceptances_once UNIQUE NULLS NOT DISTINCT (user_id, document_id, tenant_id);


--
-- Name: legal_acceptances legal_acceptances_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.legal_acceptances
    ADD CONSTRAINT legal_acceptances_pkey PRIMARY KEY (id);


--
-- Name: legal_documents legal_documents_kind_version_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.legal_documents
    ADD CONSTRAINT legal_documents_kind_version_key UNIQUE (kind, version);


--
-- Name: legal_documents legal_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.legal_documents
    ADD CONSTRAINT legal_documents_pkey PRIMARY KEY (id);


--
-- Name: member_branches member_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.member_branches
    ADD CONSTRAINT member_branches_pkey PRIMARY KEY (member_id, branch_id);


--
-- Name: notification_templates notification_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_pkey PRIMARY KEY (id);


--
-- Name: notification_templates notification_templates_tenant_id_event_channel_locale_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_tenant_id_event_channel_locale_key UNIQUE (tenant_id, event, channel, locale);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_tenant_id_dedupe_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_tenant_id_dedupe_key_key UNIQUE (tenant_id, dedupe_key);


--
-- Name: otp_codes otp_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.otp_codes
    ADD CONSTRAINT otp_codes_pkey PRIMARY KEY (id);


--
-- Name: outbox_events outbox_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);


--
-- Name: patient_consents patient_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_consents
    ADD CONSTRAINT patient_consents_pkey PRIMARY KEY (id);


--
-- Name: patient_files patient_files_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_files
    ADD CONSTRAINT patient_files_pkey PRIMARY KEY (patient_id, file_id);


--
-- Name: patient_medical_history patient_medical_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_medical_history
    ADD CONSTRAINT patient_medical_history_pkey PRIMARY KEY (patient_id);


--
-- Name: patient_medical_history_versions patient_medical_history_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_medical_history_versions
    ADD CONSTRAINT patient_medical_history_versions_pkey PRIMARY KEY (id);


--
-- Name: patients patients_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_pkey PRIMARY KEY (id);


--
-- Name: patients patients_tenant_id_file_no_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_tenant_id_file_no_key UNIQUE (tenant_id, file_no);


--
-- Name: patients patients_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: payment_gateways payment_gateways_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_gateways
    ADD CONSTRAINT payment_gateways_pkey PRIMARY KEY (id);


--
-- Name: payment_gateways payment_gateways_tenant_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_gateways
    ADD CONSTRAINT payment_gateways_tenant_id_provider_key UNIQUE (tenant_id, provider);


--
-- Name: payment_plans payment_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_plans
    ADD CONSTRAINT payment_plans_pkey PRIMARY KEY (id);


--
-- Name: payment_plans payment_plans_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_plans
    ADD CONSTRAINT payment_plans_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payments payments_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: payments payments_tenant_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_tenant_id_idempotency_key_key UNIQUE (tenant_id, idempotency_key);


--
-- Name: payments payments_tenant_id_provider_provider_ref_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_tenant_id_provider_provider_ref_key UNIQUE (tenant_id, provider, provider_ref);


--
-- Name: plans plans_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_code_key UNIQUE (code);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: platform_audit_log platform_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_audit_log
    ADD CONSTRAINT platform_audit_log_pkey PRIMARY KEY (id);


--
-- Name: platform_invoices platform_invoices_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_invoices
    ADD CONSTRAINT platform_invoices_number_key UNIQUE (number);


--
-- Name: platform_invoices platform_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_invoices
    ADD CONSTRAINT platform_invoices_pkey PRIMARY KEY (id);


--
-- Name: platform_settings platform_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (key);


--
-- Name: platform_tenant_notes platform_tenant_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_tenant_notes
    ADD CONSTRAINT platform_tenant_notes_pkey PRIMARY KEY (id);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: posts posts_tenant_id_locale_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_tenant_id_locale_slug_key UNIQUE (tenant_id, locale, slug);


--
-- Name: prescription_items prescription_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prescription_items
    ADD CONSTRAINT prescription_items_pkey PRIMARY KEY (id);


--
-- Name: prescriptions prescriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_pkey PRIMARY KEY (id);


--
-- Name: prescriptions prescriptions_replaced_once; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_replaced_once UNIQUE (replaces_id);


--
-- Name: prescriptions prescriptions_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: recalls recalls_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recalls
    ADD CONSTRAINT recalls_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_appointment_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_appointment_id_key UNIQUE (appointment_id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: roles roles_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: roles roles_tenant_id_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_key_key UNIQUE (tenant_id, key);


--
-- Name: rooms rooms_branch_id_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_branch_id_name_key UNIQUE (branch_id, name);


--
-- Name: rooms rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);


--
-- Name: rooms rooms_tenant_id_branch_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_tenant_id_branch_id_id_key UNIQUE (tenant_id, branch_id, id);


--
-- Name: rooms rooms_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: service_catalog service_catalog_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_catalog
    ADD CONSTRAINT service_catalog_code_key UNIQUE (code);


--
-- Name: service_catalog service_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_catalog
    ADD CONSTRAINT service_catalog_pkey PRIMARY KEY (id);


--
-- Name: service_categories service_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_pkey PRIMARY KEY (id);


--
-- Name: service_categories service_categories_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: services services_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: site_pages site_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.site_pages
    ADD CONSTRAINT site_pages_pkey PRIMARY KEY (id);


--
-- Name: site_pages site_pages_site_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.site_pages
    ADD CONSTRAINT site_pages_site_id_slug_key UNIQUE (site_id, slug);


--
-- Name: sites sites_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_pkey PRIMARY KEY (id);


--
-- Name: sites sites_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: sites sites_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_tenant_id_key UNIQUE (tenant_id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: templates templates_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_code_key UNIQUE (code);


--
-- Name: templates templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_pkey PRIMARY KEY (id);


--
-- Name: tenant_counters tenant_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenant_counters
    ADD CONSTRAINT tenant_counters_pkey PRIMARY KEY (tenant_id, key);


--
-- Name: tenant_members tenant_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_pkey PRIMARY KEY (id);


--
-- Name: tenant_members tenant_members_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: tenant_members tenant_members_tenant_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_tenant_id_user_id_key UNIQUE (tenant_id, user_id);


--
-- Name: tenant_settings tenant_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenant_settings
    ADD CONSTRAINT tenant_settings_pkey PRIMARY KEY (tenant_id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);


--
-- Name: tenants tenants_suspension_complete; Type: CHECK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE public.tenants
    ADD CONSTRAINT tenants_suspension_complete CHECK (((status = 'suspended'::text) = ((suspended_at IS NOT NULL) AND (suspension_reason IS NOT NULL) AND (suspension_kind IS NOT NULL) AND (status_before_suspension IS NOT NULL)))) NOT VALID;


--
-- Name: tooth_records tooth_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tooth_records
    ADD CONSTRAINT tooth_records_pkey PRIMARY KEY (id);


--
-- Name: treatment_plan_items treatment_plan_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.treatment_plan_items
    ADD CONSTRAINT treatment_plan_items_pkey PRIMARY KEY (id);


--
-- Name: treatment_plan_items treatment_plan_items_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.treatment_plan_items
    ADD CONSTRAINT treatment_plan_items_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: treatment_plans treatment_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.treatment_plans
    ADD CONSTRAINT treatment_plans_pkey PRIMARY KEY (id);


--
-- Name: treatment_plans treatment_plans_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.treatment_plans
    ADD CONSTRAINT treatment_plans_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: usage_counters usage_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usage_counters
    ADD CONSTRAINT usage_counters_pkey PRIMARY KEY (tenant_id, metric, period_start);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_google_sub_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_google_sub_key UNIQUE (google_sub);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: visit_amendments visit_amendments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visit_amendments
    ADD CONSTRAINT visit_amendments_pkey PRIMARY KEY (id);


--
-- Name: visit_procedures visit_procedures_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visit_procedures
    ADD CONSTRAINT visit_procedures_pkey PRIMARY KEY (id);


--
-- Name: visit_procedures visit_procedures_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visit_procedures
    ADD CONSTRAINT visit_procedures_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: visits visits_appointment_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_appointment_id_key UNIQUE (appointment_id);


--
-- Name: visits visits_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_pkey PRIMARY KEY (id);


--
-- Name: visits visits_tenant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_tenant_id_id_key UNIQUE (tenant_id, id);


--
-- Name: waitlist_entries waitlist_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.waitlist_entries
    ADD CONSTRAINT waitlist_entries_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_provider_event_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_provider_event_id_key UNIQUE (provider, event_id);


--
-- Name: appointments_holds; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX appointments_holds ON public.appointments USING btree (hold_expires_at) WHERE (status = 'held'::text);


--
-- Name: appointments_open_by_end; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX appointments_open_by_end ON public.appointments USING btree (ends_at) WHERE (status = ANY (ARRAY['pending'::text, 'confirmed'::text]));


--
-- Name: appointments_open_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX appointments_open_code ON public.appointments USING btree (tenant_id, check_in_code_hash) WHERE ((check_in_code_used_at IS NULL) AND (check_in_code_hash IS NOT NULL));


--
-- Name: appointments_pending; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX appointments_pending ON public.appointments USING btree (tenant_id, created_at) WHERE (status = 'pending'::text);


--
-- Name: appointments_room_id_starts_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX appointments_room_id_starts_at_idx ON public.appointments USING btree (room_id, starts_at) WHERE (room_id IS NOT NULL);


--
-- Name: appointments_service; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX appointments_service ON public.appointments USING btree (service_id) WHERE (service_id IS NOT NULL);


--
-- Name: appointments_tenant_id_branch_id_starts_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX appointments_tenant_id_branch_id_starts_at_idx ON public.appointments USING btree (tenant_id, branch_id, starts_at);


--
-- Name: appointments_tenant_id_doctor_id_starts_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX appointments_tenant_id_doctor_id_starts_at_idx ON public.appointments USING btree (tenant_id, doctor_id, starts_at);


--
-- Name: appointments_tenant_id_patient_id_starts_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX appointments_tenant_id_patient_id_starts_at_idx ON public.appointments USING btree (tenant_id, patient_id, starts_at DESC);


--
-- Name: appointments_tenant_starts; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX appointments_tenant_starts ON public.appointments USING btree (tenant_id, starts_at);


--
-- Name: audit_log_tenant_actor_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX audit_log_tenant_actor_created ON public.audit_log USING btree (tenant_id, actor_user_id, created_at DESC);


--
-- Name: audit_log_tenant_id_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX audit_log_tenant_id_created_at_idx ON public.audit_log USING btree (tenant_id, created_at DESC);


--
-- Name: audit_log_tenant_id_entity_type_entity_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX audit_log_tenant_id_entity_type_entity_id_idx ON public.audit_log USING btree (tenant_id, entity_type, entity_id);


--
-- Name: auth_events_identifier_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX auth_events_identifier_created_at_idx ON public.auth_events USING btree (identifier, created_at DESC);


--
-- Name: auth_events_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX auth_events_user_id_created_at_idx ON public.auth_events USING btree (user_id, created_at DESC);


--
-- Name: balance_adjustments_invoice; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX balance_adjustments_invoice ON public.balance_adjustments USING btree (tenant_id, invoice_id);


--
-- Name: branch_hours_branch_id_weekday_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX branch_hours_branch_id_weekday_idx ON public.branch_hours USING btree (branch_id, weekday);


--
-- Name: branch_hours_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX branch_hours_tenant_idx ON public.branch_hours USING btree (tenant_id, branch_id, weekday);


--
-- Name: branches_one_main; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX branches_one_main ON public.branches USING btree (tenant_id) WHERE is_main;


--
-- Name: branches_photo_file; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX branches_photo_file ON public.branches USING btree (photo_file_id) WHERE (photo_file_id IS NOT NULL);


--
-- Name: cash_sessions_one_open_per_branch; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX cash_sessions_one_open_per_branch ON public.cash_sessions USING btree (tenant_id, branch_id) WHERE (status = 'open'::text);


--
-- Name: data_exports_one_open; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX data_exports_one_open ON public.data_exports USING btree (tenant_id) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));


--
-- Name: data_exports_tenant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX data_exports_tenant ON public.data_exports USING btree (tenant_id, created_at DESC);


--
-- Name: doctor_branches_branch_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX doctor_branches_branch_id_idx ON public.doctor_branches USING btree (branch_id);


--
-- Name: doctor_branches_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX doctor_branches_tenant_idx ON public.doctor_branches USING btree (tenant_id, branch_id);


--
-- Name: doctor_schedules_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX doctor_schedules_tenant_idx ON public.doctor_schedules USING btree (tenant_id, doctor_id, weekday);


--
-- Name: doctor_services_service_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX doctor_services_service_id_idx ON public.doctor_services USING btree (service_id);


--
-- Name: doctor_services_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX doctor_services_tenant_idx ON public.doctor_services USING btree (tenant_id, service_id);


--
-- Name: doctor_time_off_doctor_id_starts_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX doctor_time_off_doctor_id_starts_at_idx ON public.doctor_time_off USING btree (doctor_id, starts_at);


--
-- Name: doctor_time_off_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX doctor_time_off_tenant_idx ON public.doctor_time_off USING btree (tenant_id, doctor_id, starts_at);


--
-- Name: doctors_member_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX doctors_member_unique ON public.doctors USING btree (member_id) WHERE (member_id IS NOT NULL);


--
-- Name: doctors_photo_file; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX doctors_photo_file ON public.doctors USING btree (photo_file_id) WHERE (photo_file_id IS NOT NULL);


--
-- Name: domains_live_hostname; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX domains_live_hostname ON public.domains USING btree (hostname) WHERE (status = ANY (ARRAY['verified'::text, 'active'::text]));


--
-- Name: domains_one_primary; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX domains_one_primary ON public.domains USING btree (tenant_id) WHERE is_primary;


--
-- Name: domains_tenant_hostname; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX domains_tenant_hostname ON public.domains USING btree (tenant_id, hostname) WHERE (status <> 'removed'::text);


--
-- Name: expense_categories_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX expense_categories_key ON public.expense_categories USING btree (tenant_id, key) WHERE (key IS NOT NULL);


--
-- Name: expenses_branch_day; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX expenses_branch_day ON public.expenses USING btree (tenant_id, branch_id, spent_on);


--
-- Name: expenses_file; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX expenses_file ON public.expenses USING btree (file_id) WHERE (file_id IS NOT NULL);


--
-- Name: expenses_pending; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX expenses_pending ON public.expenses USING btree (tenant_id, created_at) WHERE (status = 'pending'::text);


--
-- Name: expenses_tenant_id_spent_on_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX expenses_tenant_id_spent_on_idx ON public.expenses USING btree (tenant_id, spent_on DESC);


--
-- Name: faqs_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX faqs_tenant_idx ON public.faqs USING btree (tenant_id, sort_order);


--
-- Name: files_tenant_kind; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX files_tenant_kind ON public.files USING btree (tenant_id, kind);


--
-- Name: gallery_items_before_file; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX gallery_items_before_file ON public.gallery_items USING btree (before_file_id) WHERE (before_file_id IS NOT NULL);


--
-- Name: gallery_items_image_file; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX gallery_items_image_file ON public.gallery_items USING btree (image_file_id);


--
-- Name: gallery_items_one_featured; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX gallery_items_one_featured ON public.gallery_items USING btree (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE is_featured;


--
-- Name: gallery_items_scope_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX gallery_items_scope_order ON public.gallery_items USING btree (tenant_id, branch_id, sort_order, id);


--
-- Name: gallery_items_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX gallery_items_tenant_idx ON public.gallery_items USING btree (tenant_id, sort_order);


--
-- Name: gallery_items_type_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX gallery_items_type_order ON public.gallery_items USING btree (tenant_id, type, sort_order, id);


--
-- Name: holidays_one_per_scope_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX holidays_one_per_scope_date ON public.holidays USING btree (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), date);


--
-- Name: holidays_tenant_id_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX holidays_tenant_id_date_idx ON public.holidays USING btree (tenant_id, date);


--
-- Name: in_app_notifications_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX in_app_notifications_tenant_idx ON public.in_app_notifications USING btree (tenant_id, member_id, created_at DESC);


--
-- Name: in_app_unread; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX in_app_unread ON public.in_app_notifications USING btree (member_id, created_at DESC) WHERE (read_at IS NULL);


--
-- Name: installments_open; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX installments_open ON public.installments USING btree (tenant_id, due_date) WHERE (status = ANY (ARRAY['due'::text, 'partially_paid'::text]));


--
-- Name: inventory_movements_tenant_id_item_id_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inventory_movements_tenant_id_item_id_created_at_idx ON public.inventory_movements USING btree (tenant_id, item_id, created_at DESC);


--
-- Name: inventory_stock_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inventory_stock_tenant_idx ON public.inventory_stock USING btree (tenant_id, branch_id);


--
-- Name: invitations_one_open_per_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX invitations_one_open_per_email ON public.invitations USING btree (tenant_id, email) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: invitations_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invitations_tenant_idx ON public.invitations USING btree (tenant_id, created_at DESC);


--
-- Name: invoice_items_invoice_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoice_items_invoice_id_idx ON public.invoice_items USING btree (invoice_id);


--
-- Name: invoice_items_service; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoice_items_service ON public.invoice_items USING btree (service_id) WHERE (service_id IS NOT NULL);


--
-- Name: invoice_items_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoice_items_tenant_idx ON public.invoice_items USING btree (tenant_id, invoice_id);


--
-- Name: invoice_items_visit_procedure_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoice_items_visit_procedure_id_idx ON public.invoice_items USING btree (visit_procedure_id) WHERE (visit_procedure_id IS NOT NULL);


--
-- Name: invoices_discount_pending; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoices_discount_pending ON public.invoices USING btree (tenant_id, updated_at) WHERE (discount_status = 'pending'::text);


--
-- Name: invoices_open; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoices_open ON public.invoices USING btree (tenant_id, due_date) WHERE (status = ANY (ARRAY['issued'::text, 'partially_paid'::text]));


--
-- Name: invoices_tenant_branch_issue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoices_tenant_branch_issue ON public.invoices USING btree (tenant_id, branch_id, issue_date) WHERE (status <> 'draft'::text);


--
-- Name: invoices_tenant_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoices_tenant_created ON public.invoices USING btree (tenant_id, created_at DESC, id DESC);


--
-- Name: invoices_tenant_id_issue_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoices_tenant_id_issue_date_idx ON public.invoices USING btree (tenant_id, issue_date) WHERE (status <> 'void'::text);


--
-- Name: invoices_tenant_id_patient_id_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoices_tenant_id_patient_id_created_at_idx ON public.invoices USING btree (tenant_id, patient_id, created_at DESC);


--
-- Name: lab_orders_open; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX lab_orders_open ON public.lab_orders USING btree (tenant_id, due_date) WHERE (status = ANY (ARRAY['sent'::text, 'in_progress'::text]));


--
-- Name: lab_orders_tenant_id_patient_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX lab_orders_tenant_id_patient_id_idx ON public.lab_orders USING btree (tenant_id, patient_id);


--
-- Name: leads_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX leads_created ON public.leads USING btree (created_at DESC);


--
-- Name: member_branches_branch_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX member_branches_branch_id_idx ON public.member_branches USING btree (branch_id);


--
-- Name: member_branches_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX member_branches_tenant_idx ON public.member_branches USING btree (tenant_id, member_id);


--
-- Name: notifications_due; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX notifications_due ON public.notifications USING btree (scheduled_at) WHERE (status = 'queued'::text);


--
-- Name: notifications_patient; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX notifications_patient ON public.notifications USING btree (patient_id) WHERE (patient_id IS NOT NULL);


--
-- Name: notifications_tenant_id_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX notifications_tenant_id_created_at_idx ON public.notifications USING btree (tenant_id, created_at DESC);


--
-- Name: otp_codes_target_purpose_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX otp_codes_target_purpose_created_at_idx ON public.otp_codes USING btree (target, purpose, created_at DESC);


--
-- Name: outbox_events_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX outbox_events_tenant_idx ON public.outbox_events USING btree (tenant_id, id);


--
-- Name: outbox_pending; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX outbox_pending ON public.outbox_events USING btree (id) WHERE (processed_at IS NULL);


--
-- Name: patient_consents_tenant_id_patient_id_signed_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX patient_consents_tenant_id_patient_id_signed_at_idx ON public.patient_consents USING btree (tenant_id, patient_id, signed_at DESC);


--
-- Name: patient_files_file_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX patient_files_file_id_idx ON public.patient_files USING btree (file_id);


--
-- Name: patient_files_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX patient_files_tenant_idx ON public.patient_files USING btree (tenant_id, patient_id);


--
-- Name: patient_medical_history_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX patient_medical_history_tenant_idx ON public.patient_medical_history USING btree (tenant_id, patient_id);


--
-- Name: patient_medical_history_versions_patient; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX patient_medical_history_versions_patient ON public.patient_medical_history_versions USING btree (tenant_id, patient_id, saved_at DESC);


--
-- Name: patients_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX patients_active ON public.patients USING btree (tenant_id, created_at DESC) WHERE ((deleted_at IS NULL) AND (merged_into_id IS NULL));


--
-- Name: patients_guardian_phone; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX patients_guardian_phone ON public.patients USING btree (tenant_id, guardian_phone) WHERE (guardian_phone IS NOT NULL);


--
-- Name: patients_name_norm_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX patients_name_norm_trgm ON public.patients USING gin (tenant_id, full_name_norm public.gin_trgm_ops);


--
-- Name: patients_name_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX patients_name_trgm ON public.patients USING gin (tenant_id, full_name public.gin_trgm_ops);


--
-- Name: patients_phone_alt; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX patients_phone_alt ON public.patients USING btree (tenant_id, phone_alt) WHERE (phone_alt IS NOT NULL);


--
-- Name: patients_phone_prefix; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX patients_phone_prefix ON public.patients USING btree (tenant_id, phone text_pattern_ops) WHERE (deleted_at IS NULL);


--
-- Name: patients_tenant_id_phone_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX patients_tenant_id_phone_idx ON public.patients USING btree (tenant_id, phone);


--
-- Name: payment_plans_one_active_per_invoice; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX payment_plans_one_active_per_invoice ON public.payment_plans USING btree (invoice_id) WHERE ((invoice_id IS NOT NULL) AND (status = 'active'::text));


--
-- Name: payment_plans_tenant_id_patient_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX payment_plans_tenant_id_patient_id_idx ON public.payment_plans USING btree (tenant_id, patient_id);


--
-- Name: payments_appointment_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX payments_appointment_id_idx ON public.payments USING btree (appointment_id) WHERE (appointment_id IS NOT NULL);


--
-- Name: payments_installment_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX payments_installment_id_idx ON public.payments USING btree (installment_id) WHERE (installment_id IS NOT NULL);


--
-- Name: payments_tenant_branch_paid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX payments_tenant_branch_paid ON public.payments USING btree (tenant_id, branch_id, paid_at);


--
-- Name: payments_tenant_id_invoice_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX payments_tenant_id_invoice_id_idx ON public.payments USING btree (tenant_id, invoice_id);


--
-- Name: payments_tenant_id_paid_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX payments_tenant_id_paid_at_idx ON public.payments USING btree (tenant_id, paid_at DESC);


--
-- Name: payments_tenant_id_patient_id_paid_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX payments_tenant_id_patient_id_paid_at_idx ON public.payments USING btree (tenant_id, patient_id, paid_at DESC);


--
-- Name: platform_invoices_idempotency; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX platform_invoices_idempotency ON public.platform_invoices USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: platform_invoices_reference; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX platform_invoices_reference ON public.platform_invoices USING btree (tenant_id, provider, lower(provider_ref)) WHERE ((provider_ref IS NOT NULL) AND (status = 'paid'::text));


--
-- Name: platform_invoices_tenant_id_issued_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX platform_invoices_tenant_id_issued_at_idx ON public.platform_invoices USING btree (tenant_id, issued_at DESC);


--
-- Name: platform_tenant_notes_tenant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX platform_tenant_notes_tenant ON public.platform_tenant_notes USING btree (tenant_id, created_at DESC);


--
-- Name: prescription_items_prescription_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX prescription_items_prescription_id_idx ON public.prescription_items USING btree (prescription_id);


--
-- Name: prescription_items_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX prescription_items_tenant_idx ON public.prescription_items USING btree (tenant_id, prescription_id);


--
-- Name: prescriptions_patient; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX prescriptions_patient ON public.prescriptions USING btree (tenant_id, patient_id, issued_at DESC);


--
-- Name: prescriptions_visit_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX prescriptions_visit_id_idx ON public.prescriptions USING btree (visit_id);


--
-- Name: recalls_due; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX recalls_due ON public.recalls USING btree (tenant_id, due_date) WHERE (status = ANY (ARRAY['pending'::text, 'contacted'::text]));


--
-- Name: recalls_patient; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX recalls_patient ON public.recalls USING btree (tenant_id, patient_id, due_date);


--
-- Name: refresh_tokens_family_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX refresh_tokens_family_id_idx ON public.refresh_tokens USING btree (family_id);


--
-- Name: refresh_tokens_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX refresh_tokens_user_id_idx ON public.refresh_tokens USING btree (user_id);


--
-- Name: refunds_payment_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX refunds_payment_id_idx ON public.refunds USING btree (payment_id);


--
-- Name: refunds_tenant_branch_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX refunds_tenant_branch_at ON public.refunds USING btree (tenant_id, branch_id, refunded_at);


--
-- Name: refunds_tenant_idempotency; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX refunds_tenant_idempotency ON public.refunds USING btree (tenant_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: refunds_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX refunds_tenant_idx ON public.refunds USING btree (tenant_id, payment_id);


--
-- Name: reviews_approved; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX reviews_approved ON public.reviews USING btree (tenant_id, created_at DESC) WHERE (status = 'approved'::text);


--
-- Name: roles_tenant_name_ar; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX roles_tenant_name_ar ON public.roles USING btree (tenant_id, lower(btrim(name_ar))) WHERE (archived_at IS NULL);


--
-- Name: rooms_tenant_branch; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX rooms_tenant_branch ON public.rooms USING btree (tenant_id, branch_id, name);


--
-- Name: services_image_file; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX services_image_file ON public.services USING btree (image_file_id) WHERE (image_file_id IS NOT NULL);


--
-- Name: services_tenant_catalog_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX services_tenant_catalog_code ON public.services USING btree (tenant_id, catalog_code) WHERE (catalog_code IS NOT NULL);


--
-- Name: site_pages_tenant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX site_pages_tenant_idx ON public.site_pages USING btree (tenant_id, site_id, sort_order);


--
-- Name: subscriptions_one_live; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX subscriptions_one_live ON public.subscriptions USING btree (tenant_id) WHERE (status <> 'cancelled'::text);


--
-- Name: tenant_members_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX tenant_members_user_id_idx ON public.tenant_members USING btree (user_id);


--
-- Name: tenants_logo_file; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX tenants_logo_file ON public.tenants USING btree (logo_file_id) WHERE (logo_file_id IS NOT NULL);


--
-- Name: tooth_records_tenant_id_patient_id_tooth_code_recorded_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX tooth_records_tenant_id_patient_id_tooth_code_recorded_at_idx ON public.tooth_records USING btree (tenant_id, patient_id, tooth_code, recorded_at DESC);


--
-- Name: treatment_plan_items_appointment; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX treatment_plan_items_appointment ON public.treatment_plan_items USING btree (appointment_id) WHERE (appointment_id IS NOT NULL);


--
-- Name: treatment_plan_items_plan_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX treatment_plan_items_plan_id_idx ON public.treatment_plan_items USING btree (plan_id);


--
-- Name: treatment_plan_items_service; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX treatment_plan_items_service ON public.treatment_plan_items USING btree (service_id) WHERE (service_id IS NOT NULL);


--
-- Name: treatment_plans_tenant_id_patient_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX treatment_plans_tenant_id_patient_id_idx ON public.treatment_plans USING btree (tenant_id, patient_id);


--
-- Name: visit_amendments_visit; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX visit_amendments_visit ON public.visit_amendments USING btree (tenant_id, visit_id, created_at);


--
-- Name: visit_procedures_payout_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX visit_procedures_payout_id_idx ON public.visit_procedures USING btree (payout_id) WHERE (payout_id IS NOT NULL);


--
-- Name: visit_procedures_plan_item; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX visit_procedures_plan_item ON public.visit_procedures USING btree (plan_item_id) WHERE (plan_item_id IS NOT NULL);


--
-- Name: visit_procedures_service; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX visit_procedures_service ON public.visit_procedures USING btree (service_id);


--
-- Name: visit_procedures_tenant_id_doctor_id_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX visit_procedures_tenant_id_doctor_id_created_at_idx ON public.visit_procedures USING btree (tenant_id, doctor_id, created_at);


--
-- Name: visit_procedures_visit_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX visit_procedures_visit_id_idx ON public.visit_procedures USING btree (visit_id);


--
-- Name: visits_doctor_open; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX visits_doctor_open ON public.visits USING btree (tenant_id, doctor_id, visit_at DESC) WHERE (status = 'draft'::text);


--
-- Name: visits_tenant_drafts; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX visits_tenant_drafts ON public.visits USING btree (tenant_id, visit_at DESC, id DESC) WHERE (status = 'draft'::text);


--
-- Name: visits_tenant_id_patient_id_visit_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX visits_tenant_id_patient_id_visit_at_idx ON public.visits USING btree (tenant_id, patient_id, visit_at DESC);


--
-- Name: visits_tenant_visit_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX visits_tenant_visit_at ON public.visits USING btree (tenant_id, visit_at DESC, id DESC);


--
-- Name: waitlist_open; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX waitlist_open ON public.waitlist_entries USING btree (tenant_id, branch_id, earliest_date) WHERE (status = 'waiting'::text);


--
-- Name: appointments appointments_clear_code; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER appointments_clear_code BEFORE UPDATE OF status ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.appointments_clear_code();


--
-- Name: appointments appointments_clinical_follow; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER appointments_clinical_follow AFTER UPDATE OF status ON public.appointments FOR EACH ROW WHEN (((old.status IS DISTINCT FROM new.status) AND (new.status = ANY (ARRAY['completed'::text, 'cancelled'::text, 'no_show'::text])))) EXECUTE FUNCTION public.appointments_clinical_follow();


--
-- Name: appointments appointments_move_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER appointments_move_guard BEFORE UPDATE OF starts_at, ends_at, doctor_id, branch_id ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.appointments_move_guard();


--
-- Name: appointments appointments_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER appointments_set_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: appointments appointments_transition; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER appointments_transition BEFORE UPDATE OF status ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.appointments_transition();


--
-- Name: appointments appointments_validate_doctor; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER appointments_validate_doctor BEFORE INSERT OR UPDATE OF doctor_id, branch_id ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.appointments_validate_doctor();


--
-- Name: appointments audit_appointments_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_appointments_delete AFTER DELETE ON public.appointments FOR EACH ROW WHEN ((old.status <> 'held'::text)) EXECUTE FUNCTION public.audit_row_change('appointment', 'patient_notes', 'internal_notes', 'cancel_reason', 'check_in_note', 'override_reason', 'check_in_code_hash', 'manage_token_hash');


--
-- Name: appointments audit_appointments_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_appointments_insert AFTER INSERT ON public.appointments FOR EACH ROW WHEN ((new.status <> 'held'::text)) EXECUTE FUNCTION public.audit_row_change('appointment', 'patient_notes', 'internal_notes', 'cancel_reason', 'check_in_note', 'override_reason', 'check_in_code_hash', 'manage_token_hash');


--
-- Name: appointments audit_appointments_update; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_appointments_update AFTER UPDATE ON public.appointments FOR EACH ROW WHEN ((NOT ((old.status = 'held'::text) AND (new.status = ANY (ARRAY['held'::text, 'expired'::text]))))) EXECUTE FUNCTION public.audit_row_change('appointment', 'patient_notes', 'internal_notes', 'cancel_reason', 'check_in_note', 'override_reason', 'check_in_code_hash', 'manage_token_hash');


--
-- Name: balance_adjustments audit_balance_adjustments; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_balance_adjustments AFTER INSERT ON public.balance_adjustments FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('balance_adjustment', 'reason');


--
-- Name: branch_hours audit_branch_hours; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_branch_hours AFTER INSERT OR DELETE OR UPDATE ON public.branch_hours FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('branch_hours');


--
-- Name: branches audit_branches; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_branches AFTER INSERT OR DELETE OR UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('branch');


--
-- Name: cash_session_reopenings audit_cash_session_reopenings; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_cash_session_reopenings AFTER INSERT ON public.cash_session_reopenings FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('cash_session_reopening', 'reason', 'previous_note');


--
-- Name: cash_sessions audit_cash_sessions; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_cash_sessions AFTER INSERT OR UPDATE ON public.cash_sessions FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('cash_session', 'note');


--
-- Name: doctor_branches audit_doctor_branches; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_doctor_branches AFTER INSERT OR DELETE OR UPDATE ON public.doctor_branches FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('doctor_branch');


--
-- Name: doctor_schedules audit_doctor_schedules; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_doctor_schedules AFTER INSERT OR DELETE OR UPDATE ON public.doctor_schedules FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('doctor_schedule');


--
-- Name: doctor_services audit_doctor_services; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_doctor_services AFTER INSERT OR DELETE OR UPDATE ON public.doctor_services FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('doctor_service');


--
-- Name: doctor_time_off audit_doctor_time_off; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_doctor_time_off AFTER INSERT OR DELETE OR UPDATE ON public.doctor_time_off FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('doctor_time_off', 'reason');


--
-- Name: doctors audit_doctors; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_doctors AFTER INSERT OR DELETE OR UPDATE ON public.doctors FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('doctor');


--
-- Name: expense_categories audit_expense_categories; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_expense_categories AFTER INSERT OR UPDATE ON public.expense_categories FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('expense_category');


--
-- Name: expenses audit_expenses; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_expenses AFTER INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('expense', 'description', 'decision_note', 'void_reason');


--
-- Name: holidays audit_holidays; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_holidays AFTER INSERT OR DELETE OR UPDATE ON public.holidays FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('holiday');


--
-- Name: installments audit_installments; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_installments AFTER INSERT OR DELETE OR UPDATE ON public.installments FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('installment', 'waived_reason');


--
-- Name: invitations audit_invitations; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_invitations AFTER INSERT OR DELETE OR UPDATE ON public.invitations FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('invitation', 'token_hash');


--
-- Name: invoice_items audit_invoice_items; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_invoice_items AFTER INSERT OR DELETE OR UPDATE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('invoice_item', 'description', 'discount_reason');


--
-- Name: invoices audit_invoices; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_invoices AFTER INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('invoice', 'notes', 'void_reason', 'discount_reason', 'discount_note');


--
-- Name: member_branches audit_member_branches; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_member_branches AFTER INSERT OR DELETE OR UPDATE ON public.member_branches FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('member_branch');


--
-- Name: payment_plans audit_payment_plans; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_payment_plans AFTER INSERT OR DELETE OR UPDATE ON public.payment_plans FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('payment_plan', 'notes');


--
-- Name: payments audit_payments; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_payments AFTER INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('payment', 'notes', 'reversal_reason');


--
-- Name: prescription_items audit_prescription_items; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_prescription_items AFTER INSERT OR DELETE OR UPDATE ON public.prescription_items FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('prescription_item', 'drug_name', 'dose', 'frequency', 'duration', 'instructions');


--
-- Name: prescriptions audit_prescriptions; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_prescriptions AFTER INSERT OR DELETE OR UPDATE ON public.prescriptions FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('prescription', 'notes');


--
-- Name: recalls audit_recalls; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_recalls AFTER INSERT OR DELETE OR UPDATE ON public.recalls FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('recall', 'notes');


--
-- Name: refunds audit_refunds; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_refunds AFTER INSERT OR DELETE OR UPDATE ON public.refunds FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('refund', 'reason');


--
-- Name: roles audit_roles; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_roles AFTER INSERT OR DELETE OR UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('role');


--
-- Name: rooms audit_rooms; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_rooms AFTER INSERT OR DELETE OR UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('room');


--
-- Name: services audit_services; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_services AFTER INSERT OR DELETE OR UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('service');


--
-- Name: tenant_members audit_tenant_members; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_tenant_members AFTER INSERT OR DELETE OR UPDATE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('member');


--
-- Name: tenant_settings audit_tenant_settings; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_tenant_settings AFTER UPDATE ON public.tenant_settings FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('clinic_settings');


--
-- Name: tenants audit_tenants; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_tenants AFTER UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('clinic');


--
-- Name: tooth_records audit_tooth_records; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_tooth_records AFTER INSERT OR DELETE OR UPDATE ON public.tooth_records FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('tooth_record', 'notes');


--
-- Name: treatment_plan_items audit_treatment_plan_items; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_treatment_plan_items AFTER INSERT OR DELETE OR UPDATE ON public.treatment_plan_items FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('treatment_plan_item');


--
-- Name: treatment_plans audit_treatment_plans; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_treatment_plans AFTER INSERT OR DELETE OR UPDATE ON public.treatment_plans FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('treatment_plan', 'notes');


--
-- Name: visit_amendments audit_visit_amendments; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_visit_amendments AFTER INSERT OR DELETE OR UPDATE ON public.visit_amendments FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('visit_amendment', 'new_text', 'reason');


--
-- Name: visit_procedures audit_visit_procedures; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_visit_procedures AFTER INSERT OR DELETE OR UPDATE ON public.visit_procedures FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('visit_procedure', 'notes');


--
-- Name: visits audit_visits; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_visits AFTER INSERT OR DELETE OR UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('visit', 'chief_complaint', 'diagnosis', 'clinical_notes', 'next_visit_note');


--
-- Name: balance_adjustments balance_adjustments_apply; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER balance_adjustments_apply AFTER INSERT ON public.balance_adjustments FOR EACH ROW EXECUTE FUNCTION public.balance_adjustments_apply();


--
-- Name: balance_adjustments balance_adjustments_validate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER balance_adjustments_validate BEFORE INSERT ON public.balance_adjustments FOR EACH ROW EXECUTE FUNCTION public.balance_adjustments_validate();


--
-- Name: branches branches_public_image; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER branches_public_image BEFORE INSERT OR UPDATE OF photo_file_id ON public.branches FOR EACH ROW EXECUTE FUNCTION public.public_image_guard('photo_file_id');


--
-- Name: branches branches_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER branches_set_updated_at BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: cash_sessions cash_sessions_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER cash_sessions_guard BEFORE INSERT OR UPDATE ON public.cash_sessions FOR EACH ROW EXECUTE FUNCTION public.cash_sessions_guard();


--
-- Name: consent_templates consent_templates_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER consent_templates_guard BEFORE UPDATE ON public.consent_templates FOR EACH ROW EXECUTE FUNCTION public.consent_templates_guard();


--
-- Name: doctor_payouts doctor_payouts_derive; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER doctor_payouts_derive BEFORE INSERT OR UPDATE ON public.doctor_payouts FOR EACH ROW EXECUTE FUNCTION public.doctor_payouts_derive();


--
-- Name: doctors doctors_public_image; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER doctors_public_image BEFORE INSERT OR UPDATE OF photo_file_id ON public.doctors FOR EACH ROW EXECUTE FUNCTION public.public_image_guard('photo_file_id');


--
-- Name: doctors doctors_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER doctors_set_updated_at BEFORE UPDATE ON public.doctors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: domains domains_insert_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER domains_insert_guard BEFORE INSERT ON public.domains FOR EACH ROW EXECUTE FUNCTION public.domains_insert_guard();


--
-- Name: expenses expenses_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER expenses_guard BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.expenses_guard();


--
-- Name: expenses expenses_within_open_day; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER expenses_within_open_day BEFORE INSERT OR UPDATE OF status ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.cash_day_open_guard();


--
-- Name: faqs faqs_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER faqs_set_updated_at BEFORE UPDATE ON public.faqs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: gallery_items gallery_items_consent_stamp; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER gallery_items_consent_stamp BEFORE INSERT OR UPDATE OF consent_confirmed, consent_confirmed_at, consent_confirmed_by, image_file_id, before_file_id ON public.gallery_items FOR EACH ROW EXECUTE FUNCTION public.gallery_items_consent_stamp();


--
-- Name: gallery_items gallery_items_files_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER gallery_items_files_guard BEFORE INSERT OR UPDATE OF type, image_file_id, before_file_id ON public.gallery_items FOR EACH ROW EXECUTE FUNCTION public.gallery_items_files_guard();


--
-- Name: gallery_items gallery_items_public_image; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER gallery_items_public_image BEFORE INSERT OR UPDATE OF image_file_id, before_file_id ON public.gallery_items FOR EACH ROW EXECUTE FUNCTION public.public_image_guard('image_file_id', 'before_file_id');


--
-- Name: installments installments_plan_status; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER installments_plan_status AFTER UPDATE OF status ON public.installments FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION public.installments_plan_status();


--
-- Name: installments installments_totals; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER installments_totals AFTER INSERT OR DELETE OR UPDATE ON public.installments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.payment_plans_check_totals();


--
-- Name: inventory_stock inventory_stock_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER inventory_stock_set_updated_at BEFORE UPDATE ON public.inventory_stock FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: invitations invitations_owner_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER invitations_owner_guard BEFORE INSERT OR UPDATE OF role_id ON public.invitations FOR EACH ROW EXECUTE FUNCTION public.invitations_owner_guard();


--
-- Name: invitations invitations_role_assignable; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER invitations_role_assignable BEFORE INSERT OR UPDATE OF role_id ON public.invitations FOR EACH ROW EXECUTE FUNCTION public.role_assignable();


--
-- Name: invoice_items invoice_items_changed; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER invoice_items_changed AFTER INSERT OR DELETE OR UPDATE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION public.invoice_items_changed();


--
-- Name: invoice_items invoice_items_derive; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER invoice_items_derive BEFORE INSERT OR UPDATE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION public.invoice_items_derive();


--
-- Name: invoice_items invoice_items_validate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER invoice_items_validate BEFORE INSERT OR DELETE OR UPDATE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION public.invoice_items_validate();


--
-- Name: invoices invoices_derive; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER invoices_derive BEFORE INSERT OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.invoices_derive();


--
-- Name: invoices invoices_discount_settled; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER invoices_discount_settled BEFORE UPDATE OF status ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.invoices_discount_settled();


--
-- Name: invoices invoices_guard_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER invoices_guard_delete BEFORE DELETE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.invoices_guard_delete();


--
-- Name: invoices invoices_lock_number; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER invoices_lock_number BEFORE INSERT OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.invoices_lock_number();


--
-- Name: invoices invoices_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: lab_orders lab_orders_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER lab_orders_set_updated_at BEFORE UPDATE ON public.lab_orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: member_branches member_branches_bump_access; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER member_branches_bump_access AFTER INSERT OR DELETE ON public.member_branches FOR EACH ROW EXECUTE FUNCTION public.member_branches_bump_access();


--
-- Name: notification_templates notification_templates_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER notification_templates_set_updated_at BEFORE UPDATE ON public.notification_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: patient_consents patient_consents_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER patient_consents_guard BEFORE INSERT OR DELETE OR UPDATE ON public.patient_consents FOR EACH ROW EXECUTE FUNCTION public.patient_consents_guard();


--
-- Name: patient_medical_history patient_medical_history_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER patient_medical_history_set_updated_at BEFORE UPDATE ON public.patient_medical_history FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: patient_medical_history patient_medical_history_version; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER patient_medical_history_version AFTER INSERT OR UPDATE ON public.patient_medical_history FOR EACH ROW EXECUTE FUNCTION public.patient_medical_history_version();


--
-- Name: patients patients_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER patients_set_updated_at BEFORE UPDATE ON public.patients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payment_gateways payment_gateways_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER payment_gateways_set_updated_at BEFORE UPDATE ON public.payment_gateways FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payment_plans payment_plans_totals; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER payment_plans_totals AFTER INSERT OR UPDATE ON public.payment_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.payment_plans_check_totals();


--
-- Name: payment_plans payment_plans_validate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER payment_plans_validate BEFORE INSERT OR UPDATE ON public.payment_plans FOR EACH ROW EXECUTE FUNCTION public.payment_plans_validate();


--
-- Name: payments payments_changed; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER payments_changed AFTER INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payments_changed();


--
-- Name: payments payments_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER payments_guard BEFORE DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payments_guard();


--
-- Name: payments payments_validate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER payments_validate BEFORE INSERT OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payments_validate();


--
-- Name: payments payments_within_open_day; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER payments_within_open_day BEFORE INSERT OR UPDATE OF status ON public.payments FOR EACH ROW EXECUTE FUNCTION public.cash_day_open_guard();


--
-- Name: plans plans_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER plans_set_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: posts posts_public_image; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER posts_public_image BEFORE INSERT OR UPDATE OF cover_file_id ON public.posts FOR EACH ROW EXECUTE FUNCTION public.public_image_guard('cover_file_id');


--
-- Name: posts posts_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER posts_set_updated_at BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prescription_items prescription_items_validate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER prescription_items_validate BEFORE INSERT ON public.prescription_items FOR EACH ROW EXECUTE FUNCTION public.prescription_items_validate();


--
-- Name: prescriptions prescriptions_validate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER prescriptions_validate BEFORE INSERT ON public.prescriptions FOR EACH ROW EXECUTE FUNCTION public.prescriptions_validate();


--
-- Name: refunds refunds_changed; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER refunds_changed AFTER INSERT OR DELETE OR UPDATE ON public.refunds FOR EACH ROW EXECUTE FUNCTION public.refunds_changed();


--
-- Name: refunds refunds_validate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER refunds_validate BEFORE INSERT OR UPDATE ON public.refunds FOR EACH ROW EXECUTE FUNCTION public.refunds_validate();


--
-- Name: refunds refunds_within_open_day; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER refunds_within_open_day BEFORE INSERT ON public.refunds FOR EACH ROW EXECUTE FUNCTION public.cash_day_open_guard();


--
-- Name: roles roles_bump_access; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER roles_bump_access AFTER UPDATE OF permissions ON public.roles FOR EACH ROW EXECUTE FUNCTION public.roles_bump_access();


--
-- Name: roles roles_default_discount; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER roles_default_discount BEFORE INSERT ON public.roles FOR EACH ROW EXECUTE FUNCTION public.roles_default_discount();


--
-- Name: roles roles_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER roles_guard BEFORE INSERT OR DELETE OR UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.roles_guard();


--
-- Name: roles roles_own_role_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER roles_own_role_guard BEFORE UPDATE OF permissions ON public.roles FOR EACH ROW EXECUTE FUNCTION public.roles_own_role_guard();


--
-- Name: services services_public_image; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER services_public_image BEFORE INSERT OR UPDATE OF image_file_id ON public.services FOR EACH ROW EXECUTE FUNCTION public.public_image_guard('image_file_id');


--
-- Name: services services_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER services_set_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: gallery_items set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.gallery_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: site_pages site_pages_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER site_pages_set_updated_at BEFORE UPDATE ON public.site_pages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sites sites_public_image; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER sites_public_image BEFORE INSERT OR UPDATE OF favicon_file_id, share_file_id ON public.sites FOR EACH ROW EXECUTE FUNCTION public.public_image_guard('favicon_file_id', 'share_file_id');


--
-- Name: sites sites_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER sites_set_updated_at BEFORE UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscriptions subscriptions_insert_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER subscriptions_insert_guard BEFORE INSERT ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.subscriptions_insert_guard();


--
-- Name: subscriptions subscriptions_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER subscriptions_set_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tenant_members tenant_members_bump_access; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tenant_members_bump_access BEFORE UPDATE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public.tenant_members_bump_access();


--
-- Name: tenant_members tenant_members_keep_owner; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tenant_members_keep_owner BEFORE DELETE OR UPDATE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public.tenant_members_keep_owner();


--
-- Name: tenant_members tenant_members_owner_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tenant_members_owner_guard BEFORE INSERT OR UPDATE OF role_id, status, all_branches ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public.tenant_members_owner_guard();


--
-- Name: tenant_members tenant_members_role_assignable; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tenant_members_role_assignable BEFORE INSERT OR UPDATE OF role_id ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public.role_assignable();


--
-- Name: tenant_members tenant_members_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tenant_members_set_updated_at BEFORE UPDATE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tenant_settings tenant_settings_seed_categories; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tenant_settings_seed_categories AFTER INSERT ON public.tenant_settings FOR EACH ROW EXECUTE FUNCTION public.tenant_settings_seed_categories();


--
-- Name: tenant_settings tenant_settings_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tenant_settings_set_updated_at BEFORE UPDATE ON public.tenant_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tenants tenants_currency_lock; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tenants_currency_lock BEFORE UPDATE OF currency ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.tenants_currency_lock();


--
-- Name: tenants tenants_public_image; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tenants_public_image BEFORE INSERT OR UPDATE OF logo_file_id ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.public_image_guard('logo_file_id');


--
-- Name: tenants tenants_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tenants_set_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tooth_records tooth_records_validate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tooth_records_validate BEFORE INSERT ON public.tooth_records FOR EACH ROW EXECUTE FUNCTION public.tooth_records_validate();


--
-- Name: treatment_plan_items treatment_plan_items_changed; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER treatment_plan_items_changed AFTER INSERT OR DELETE OR UPDATE ON public.treatment_plan_items FOR EACH ROW EXECUTE FUNCTION public.treatment_plan_items_changed();


--
-- Name: treatment_plan_items treatment_plan_items_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER treatment_plan_items_guard BEFORE INSERT OR DELETE OR UPDATE ON public.treatment_plan_items FOR EACH ROW EXECUTE FUNCTION public.treatment_plan_items_guard();


--
-- Name: treatment_plans treatment_plans_derive; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER treatment_plans_derive BEFORE INSERT OR UPDATE ON public.treatment_plans FOR EACH ROW EXECUTE FUNCTION public.treatment_plans_derive();


--
-- Name: treatment_plans treatment_plans_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER treatment_plans_guard BEFORE INSERT OR UPDATE ON public.treatment_plans FOR EACH ROW EXECUTE FUNCTION public.treatment_plans_guard();


--
-- Name: treatment_plans treatment_plans_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER treatment_plans_set_updated_at BEFORE UPDATE ON public.treatment_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users users_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: visit_amendments visit_amendments_validate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER visit_amendments_validate BEFORE INSERT ON public.visit_amendments FOR EACH ROW EXECUTE FUNCTION public.visit_amendments_validate();


--
-- Name: visit_procedures visit_procedures_payout_changed; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER visit_procedures_payout_changed AFTER INSERT OR DELETE OR UPDATE ON public.visit_procedures FOR EACH ROW EXECUTE FUNCTION public.visit_procedures_payout_changed();


--
-- Name: visit_procedures visit_procedures_payout_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER visit_procedures_payout_guard BEFORE INSERT OR UPDATE ON public.visit_procedures FOR EACH ROW EXECUTE FUNCTION public.visit_procedures_payout_guard();


--
-- Name: visit_procedures visit_procedures_plan_item; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER visit_procedures_plan_item AFTER INSERT OR DELETE ON public.visit_procedures FOR EACH ROW EXECUTE FUNCTION public.visit_procedures_plan_item();


--
-- Name: visit_procedures visit_procedures_validate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER visit_procedures_validate BEFORE INSERT OR UPDATE OF plan_item_id, visit_id ON public.visit_procedures FOR EACH ROW EXECUTE FUNCTION public.visit_procedures_validate();


--
-- Name: visit_procedures visit_procedures_workflow; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER visit_procedures_workflow BEFORE INSERT OR DELETE OR UPDATE ON public.visit_procedures FOR EACH ROW EXECUTE FUNCTION public.visit_procedures_workflow();


--
-- Name: visits visits_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER visits_guard BEFORE INSERT OR DELETE OR UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.visits_guard();


--
-- Name: visits visits_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER visits_set_updated_at BEFORE UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: visits visits_start_appointment; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER visits_start_appointment AFTER INSERT ON public.visits FOR EACH ROW EXECUTE FUNCTION public.visits_start_appointment();


--
-- Name: visits visits_validate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER visits_validate BEFORE INSERT OR UPDATE OF appointment_id, patient_id, doctor_id, branch_id ON public.visits FOR EACH ROW EXECUTE FUNCTION public.visits_validate();


--
-- Name: appointments appointments_tenant_id_booked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_tenant_id_booked_by_fkey FOREIGN KEY (tenant_id, booked_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: appointments appointments_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) DEFERRABLE;


--
-- Name: appointments appointments_tenant_id_branch_id_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_tenant_id_branch_id_room_id_fkey FOREIGN KEY (tenant_id, branch_id, room_id) REFERENCES public.rooms(tenant_id, branch_id, id) DEFERRABLE;


--
-- Name: appointments appointments_tenant_id_checked_in_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_tenant_id_checked_in_by_fkey FOREIGN KEY (tenant_id, checked_in_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: appointments appointments_tenant_id_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_tenant_id_doctor_id_fkey FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) DEFERRABLE;


--
-- Name: appointments appointments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: appointments appointments_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) DEFERRABLE;


--
-- Name: appointments appointments_tenant_id_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_tenant_id_service_id_fkey FOREIGN KEY (tenant_id, service_id) REFERENCES public.services(tenant_id, id) DEFERRABLE;


--
-- Name: audit_log audit_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: auth_events auth_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_events
    ADD CONSTRAINT auth_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: balance_adjustments balance_adjustments_tenant_id_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.balance_adjustments
    ADD CONSTRAINT balance_adjustments_tenant_id_created_by_fkey FOREIGN KEY (tenant_id, created_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: balance_adjustments balance_adjustments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.balance_adjustments
    ADD CONSTRAINT balance_adjustments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: balance_adjustments balance_adjustments_tenant_id_installment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.balance_adjustments
    ADD CONSTRAINT balance_adjustments_tenant_id_installment_id_fkey FOREIGN KEY (tenant_id, installment_id) REFERENCES public.installments(tenant_id, id) DEFERRABLE;


--
-- Name: balance_adjustments balance_adjustments_tenant_id_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.balance_adjustments
    ADD CONSTRAINT balance_adjustments_tenant_id_invoice_id_fkey FOREIGN KEY (tenant_id, invoice_id) REFERENCES public.invoices(tenant_id, id) DEFERRABLE;


--
-- Name: branch_hours branch_hours_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branch_hours
    ADD CONSTRAINT branch_hours_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE CASCADE;


--
-- Name: branches branches_photo_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_photo_fk FOREIGN KEY (tenant_id, photo_file_id) REFERENCES public.files(tenant_id, id) ON DELETE SET NULL (photo_file_id);


--
-- Name: branches branches_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: cash_session_reopenings cash_session_reopenings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_session_reopenings
    ADD CONSTRAINT cash_session_reopenings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: cash_session_reopenings cash_session_reopenings_tenant_id_reopened_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_session_reopenings
    ADD CONSTRAINT cash_session_reopenings_tenant_id_reopened_by_fkey FOREIGN KEY (tenant_id, reopened_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: cash_session_reopenings cash_session_reopenings_tenant_id_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_session_reopenings
    ADD CONSTRAINT cash_session_reopenings_tenant_id_session_id_fkey FOREIGN KEY (tenant_id, session_id) REFERENCES public.cash_sessions(tenant_id, id) DEFERRABLE;


--
-- Name: cash_sessions cash_sessions_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT cash_sessions_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) DEFERRABLE;


--
-- Name: cash_sessions cash_sessions_tenant_id_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT cash_sessions_tenant_id_closed_by_fkey FOREIGN KEY (tenant_id, closed_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: cash_sessions cash_sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT cash_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: cash_sessions cash_sessions_tenant_id_opened_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT cash_sessions_tenant_id_opened_by_fkey FOREIGN KEY (tenant_id, opened_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: consent_templates consent_templates_tenant_id_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.consent_templates
    ADD CONSTRAINT consent_templates_tenant_id_created_by_fkey FOREIGN KEY (tenant_id, created_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: consent_templates consent_templates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.consent_templates
    ADD CONSTRAINT consent_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: consent_templates consent_templates_tenant_id_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.consent_templates
    ADD CONSTRAINT consent_templates_tenant_id_reviewed_by_fkey FOREIGN KEY (tenant_id, reviewed_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: data_exports data_exports_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.data_exports
    ADD CONSTRAINT data_exports_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: data_exports data_exports_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.data_exports
    ADD CONSTRAINT data_exports_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: doctor_branches doctor_branches_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_branches
    ADD CONSTRAINT doctor_branches_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE CASCADE;


--
-- Name: doctor_branches doctor_branches_tenant_id_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_branches
    ADD CONSTRAINT doctor_branches_tenant_id_doctor_id_fkey FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) ON DELETE CASCADE;


--
-- Name: doctor_payouts doctor_payouts_tenant_id_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_payouts
    ADD CONSTRAINT doctor_payouts_tenant_id_doctor_id_fkey FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) DEFERRABLE;


--
-- Name: doctor_payouts doctor_payouts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_payouts
    ADD CONSTRAINT doctor_payouts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: doctor_schedules doctor_schedules_doctor_branch_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_schedules
    ADD CONSTRAINT doctor_schedules_doctor_branch_fk FOREIGN KEY (doctor_id, branch_id) REFERENCES public.doctor_branches(doctor_id, branch_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: doctor_schedules doctor_schedules_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_schedules
    ADD CONSTRAINT doctor_schedules_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE CASCADE;


--
-- Name: doctor_schedules doctor_schedules_tenant_id_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_schedules
    ADD CONSTRAINT doctor_schedules_tenant_id_doctor_id_fkey FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) ON DELETE CASCADE;


--
-- Name: doctor_services doctor_services_tenant_id_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_services
    ADD CONSTRAINT doctor_services_tenant_id_doctor_id_fkey FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) ON DELETE CASCADE;


--
-- Name: doctor_services doctor_services_tenant_id_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_services
    ADD CONSTRAINT doctor_services_tenant_id_service_id_fkey FOREIGN KEY (tenant_id, service_id) REFERENCES public.services(tenant_id, id) ON DELETE CASCADE;


--
-- Name: doctor_time_off doctor_time_off_created_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_time_off
    ADD CONSTRAINT doctor_time_off_created_by_member_fk FOREIGN KEY (tenant_id, created_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: doctor_time_off doctor_time_off_tenant_id_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctor_time_off
    ADD CONSTRAINT doctor_time_off_tenant_id_doctor_id_fkey FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) ON DELETE CASCADE;


--
-- Name: doctors doctors_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctors
    ADD CONSTRAINT doctors_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: doctors doctors_tenant_id_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctors
    ADD CONSTRAINT doctors_tenant_id_member_id_fkey FOREIGN KEY (tenant_id, member_id) REFERENCES public.tenant_members(tenant_id, id) ON DELETE SET NULL (member_id);


--
-- Name: doctors doctors_tenant_id_photo_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doctors
    ADD CONSTRAINT doctors_tenant_id_photo_file_id_fkey FOREIGN KEY (tenant_id, photo_file_id) REFERENCES public.files(tenant_id, id) ON DELETE SET NULL (photo_file_id);


--
-- Name: domains domains_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.domains
    ADD CONSTRAINT domains_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: expense_categories expense_categories_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: expenses expenses_approved_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_approved_by_fk FOREIGN KEY (tenant_id, approved_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: expenses expenses_created_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_created_by_member_fk FOREIGN KEY (tenant_id, created_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: expenses expenses_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) DEFERRABLE;


--
-- Name: expenses expenses_tenant_id_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_tenant_id_category_id_fkey FOREIGN KEY (tenant_id, category_id) REFERENCES public.expense_categories(tenant_id, id) DEFERRABLE;


--
-- Name: expenses expenses_tenant_id_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_tenant_id_file_id_fkey FOREIGN KEY (tenant_id, file_id) REFERENCES public.files(tenant_id, id) DEFERRABLE;


--
-- Name: expenses expenses_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: expenses expenses_tenant_id_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_tenant_id_supplier_id_fkey FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id) DEFERRABLE;


--
-- Name: expenses expenses_voided_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_voided_by_fk FOREIGN KEY (tenant_id, voided_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: faqs faqs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.faqs
    ADD CONSTRAINT faqs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: faqs faqs_tenant_id_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.faqs
    ADD CONSTRAINT faqs_tenant_id_service_id_fkey FOREIGN KEY (tenant_id, service_id) REFERENCES public.services(tenant_id, id) ON DELETE SET NULL (service_id);


--
-- Name: files files_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: files files_uploaded_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_uploaded_by_member_fk FOREIGN KEY (tenant_id, uploaded_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: gallery_items gallery_items_branch_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.gallery_items
    ADD CONSTRAINT gallery_items_branch_fk FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE CASCADE;


--
-- Name: gallery_items gallery_items_consent_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.gallery_items
    ADD CONSTRAINT gallery_items_consent_by_fk FOREIGN KEY (tenant_id, consent_confirmed_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: gallery_items gallery_items_tenant_id_before_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.gallery_items
    ADD CONSTRAINT gallery_items_tenant_id_before_file_id_fkey FOREIGN KEY (tenant_id, before_file_id) REFERENCES public.files(tenant_id, id) DEFERRABLE;


--
-- Name: gallery_items gallery_items_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.gallery_items
    ADD CONSTRAINT gallery_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: gallery_items gallery_items_tenant_id_image_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.gallery_items
    ADD CONSTRAINT gallery_items_tenant_id_image_file_id_fkey FOREIGN KEY (tenant_id, image_file_id) REFERENCES public.files(tenant_id, id) DEFERRABLE;


--
-- Name: gallery_items gallery_items_tenant_id_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.gallery_items
    ADD CONSTRAINT gallery_items_tenant_id_service_id_fkey FOREIGN KEY (tenant_id, service_id) REFERENCES public.services(tenant_id, id) ON DELETE SET NULL (service_id);


--
-- Name: holidays holidays_created_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_created_by_member_fk FOREIGN KEY (tenant_id, created_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: holidays holidays_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE CASCADE;


--
-- Name: holidays holidays_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: in_app_notifications in_app_notifications_tenant_id_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.in_app_notifications
    ADD CONSTRAINT in_app_notifications_tenant_id_member_id_fkey FOREIGN KEY (tenant_id, member_id) REFERENCES public.tenant_members(tenant_id, id) ON DELETE CASCADE;


--
-- Name: installments installments_tenant_id_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.installments
    ADD CONSTRAINT installments_tenant_id_plan_id_fkey FOREIGN KEY (tenant_id, plan_id) REFERENCES public.payment_plans(tenant_id, id) ON DELETE CASCADE;


--
-- Name: installments installments_waived_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.installments
    ADD CONSTRAINT installments_waived_by_fk FOREIGN KEY (tenant_id, waived_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: inventory_items inventory_items_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: inventory_movements inventory_movements_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) DEFERRABLE;


--
-- Name: inventory_movements inventory_movements_tenant_id_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_tenant_id_item_id_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES public.inventory_items(tenant_id, id) DEFERRABLE;


--
-- Name: inventory_movements inventory_movements_tenant_id_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_tenant_id_supplier_id_fkey FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id) DEFERRABLE;


--
-- Name: inventory_movements inventory_movements_tenant_id_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_tenant_id_visit_id_fkey FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits(tenant_id, id) DEFERRABLE;


--
-- Name: inventory_stock inventory_stock_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_stock
    ADD CONSTRAINT inventory_stock_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE CASCADE;


--
-- Name: inventory_stock inventory_stock_tenant_id_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_stock
    ADD CONSTRAINT inventory_stock_tenant_id_item_id_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES public.inventory_items(tenant_id, id) ON DELETE CASCADE;


--
-- Name: invitations invitations_doctor_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_doctor_fk FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) ON DELETE SET NULL (doctor_id);


--
-- Name: invitations invitations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: invitations invitations_tenant_id_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_tenant_id_invited_by_fkey FOREIGN KEY (tenant_id, invited_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: invitations invitations_tenant_id_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_tenant_id_role_id_fkey FOREIGN KEY (tenant_id, role_id) REFERENCES public.roles(tenant_id, id) DEFERRABLE;


--
-- Name: invoice_items invoice_items_tenant_id_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_tenant_id_doctor_id_fkey FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) DEFERRABLE;


--
-- Name: invoice_items invoice_items_tenant_id_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_tenant_id_invoice_id_fkey FOREIGN KEY (tenant_id, invoice_id) REFERENCES public.invoices(tenant_id, id) ON DELETE CASCADE;


--
-- Name: invoice_items invoice_items_tenant_id_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_tenant_id_service_id_fkey FOREIGN KEY (tenant_id, service_id) REFERENCES public.services(tenant_id, id) DEFERRABLE;


--
-- Name: invoice_items invoice_items_tenant_id_visit_procedure_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_tenant_id_visit_procedure_id_fkey FOREIGN KEY (tenant_id, visit_procedure_id) REFERENCES public.visit_procedures(tenant_id, id) DEFERRABLE;


--
-- Name: invoices invoices_created_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_created_by_member_fk FOREIGN KEY (tenant_id, created_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: invoices invoices_discount_decided_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_discount_decided_fk FOREIGN KEY (tenant_id, discount_decided_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: invoices invoices_discount_requested_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_discount_requested_fk FOREIGN KEY (tenant_id, discount_requested_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: invoices invoices_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) DEFERRABLE;


--
-- Name: invoices invoices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) DEFERRABLE;


--
-- Name: invoices invoices_voided_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_voided_by_member_fk FOREIGN KEY (tenant_id, voided_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: lab_orders lab_orders_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lab_orders
    ADD CONSTRAINT lab_orders_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) DEFERRABLE;


--
-- Name: lab_orders lab_orders_tenant_id_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lab_orders
    ADD CONSTRAINT lab_orders_tenant_id_doctor_id_fkey FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) DEFERRABLE;


--
-- Name: lab_orders lab_orders_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lab_orders
    ADD CONSTRAINT lab_orders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: lab_orders lab_orders_tenant_id_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lab_orders
    ADD CONSTRAINT lab_orders_tenant_id_lab_id_fkey FOREIGN KEY (tenant_id, lab_id) REFERENCES public.labs(tenant_id, id) DEFERRABLE;


--
-- Name: lab_orders lab_orders_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lab_orders
    ADD CONSTRAINT lab_orders_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) DEFERRABLE;


--
-- Name: lab_orders lab_orders_tenant_id_plan_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lab_orders
    ADD CONSTRAINT lab_orders_tenant_id_plan_item_id_fkey FOREIGN KEY (tenant_id, plan_item_id) REFERENCES public.treatment_plan_items(tenant_id, id) DEFERRABLE;


--
-- Name: lab_orders lab_orders_tenant_id_remake_of_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lab_orders
    ADD CONSTRAINT lab_orders_tenant_id_remake_of_id_fkey FOREIGN KEY (tenant_id, remake_of_id) REFERENCES public.lab_orders(tenant_id, id) DEFERRABLE;


--
-- Name: lab_orders lab_orders_tenant_id_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lab_orders
    ADD CONSTRAINT lab_orders_tenant_id_visit_id_fkey FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits(tenant_id, id) DEFERRABLE;


--
-- Name: labs labs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.labs
    ADD CONSTRAINT labs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: leads leads_clinic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: leads leads_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE SET NULL;


--
-- Name: leads leads_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) DEFERRABLE;


--
-- Name: legal_acceptances legal_acceptances_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.legal_acceptances
    ADD CONSTRAINT legal_acceptances_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.legal_documents(id) DEFERRABLE;


--
-- Name: legal_acceptances legal_acceptances_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.legal_acceptances
    ADD CONSTRAINT legal_acceptances_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: legal_acceptances legal_acceptances_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.legal_acceptances
    ADD CONSTRAINT legal_acceptances_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: legal_documents legal_documents_published_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.legal_documents
    ADD CONSTRAINT legal_documents_published_by_fkey FOREIGN KEY (published_by) REFERENCES public.users(id) DEFERRABLE;


--
-- Name: member_branches member_branches_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.member_branches
    ADD CONSTRAINT member_branches_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE CASCADE;


--
-- Name: member_branches member_branches_tenant_id_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.member_branches
    ADD CONSTRAINT member_branches_tenant_id_member_id_fkey FOREIGN KEY (tenant_id, member_id) REFERENCES public.tenant_members(tenant_id, id) ON DELETE CASCADE;


--
-- Name: notification_templates notification_templates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_tenant_id_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_tenant_id_member_id_fkey FOREIGN KEY (tenant_id, member_id) REFERENCES public.tenant_members(tenant_id, id) ON DELETE SET NULL (member_id);


--
-- Name: notifications notifications_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) ON DELETE SET NULL (patient_id);


--
-- Name: outbox_events outbox_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: patient_consents patient_consents_tenant_id_paper_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_consents
    ADD CONSTRAINT patient_consents_tenant_id_paper_file_id_fkey FOREIGN KEY (tenant_id, paper_file_id) REFERENCES public.files(tenant_id, id) DEFERRABLE;


--
-- Name: patient_consents patient_consents_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_consents
    ADD CONSTRAINT patient_consents_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) DEFERRABLE;


--
-- Name: patient_consents patient_consents_tenant_id_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_consents
    ADD CONSTRAINT patient_consents_tenant_id_recorded_by_fkey FOREIGN KEY (tenant_id, recorded_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: patient_consents patient_consents_tenant_id_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_consents
    ADD CONSTRAINT patient_consents_tenant_id_revoked_by_fkey FOREIGN KEY (tenant_id, revoked_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: patient_consents patient_consents_tenant_id_signature_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_consents
    ADD CONSTRAINT patient_consents_tenant_id_signature_file_id_fkey FOREIGN KEY (tenant_id, signature_file_id) REFERENCES public.files(tenant_id, id) DEFERRABLE;


--
-- Name: patient_consents patient_consents_tenant_id_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_consents
    ADD CONSTRAINT patient_consents_tenant_id_template_id_fkey FOREIGN KEY (tenant_id, template_id) REFERENCES public.consent_templates(tenant_id, id) DEFERRABLE;


--
-- Name: patient_consents patient_consents_tenant_id_treatment_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_consents
    ADD CONSTRAINT patient_consents_tenant_id_treatment_plan_id_fkey FOREIGN KEY (tenant_id, treatment_plan_id) REFERENCES public.treatment_plans(tenant_id, id) DEFERRABLE;


--
-- Name: patient_consents patient_consents_tenant_id_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_consents
    ADD CONSTRAINT patient_consents_tenant_id_visit_id_fkey FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits(tenant_id, id) DEFERRABLE;


--
-- Name: patient_consents patient_consents_tenant_id_witness_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_consents
    ADD CONSTRAINT patient_consents_tenant_id_witness_member_id_fkey FOREIGN KEY (tenant_id, witness_member_id) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: patient_files patient_files_archived_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_files
    ADD CONSTRAINT patient_files_archived_by_member_fk FOREIGN KEY (tenant_id, archived_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: patient_files patient_files_tenant_id_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_files
    ADD CONSTRAINT patient_files_tenant_id_file_id_fkey FOREIGN KEY (tenant_id, file_id) REFERENCES public.files(tenant_id, id) ON DELETE CASCADE;


--
-- Name: patient_files patient_files_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_files
    ADD CONSTRAINT patient_files_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) ON DELETE CASCADE;


--
-- Name: patient_files patient_files_tenant_id_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_files
    ADD CONSTRAINT patient_files_tenant_id_visit_id_fkey FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits(tenant_id, id) ON DELETE SET NULL (visit_id);


--
-- Name: patient_medical_history patient_medical_history_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_medical_history
    ADD CONSTRAINT patient_medical_history_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) ON DELETE CASCADE;


--
-- Name: patient_medical_history patient_medical_history_updated_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_medical_history
    ADD CONSTRAINT patient_medical_history_updated_by_member_fk FOREIGN KEY (tenant_id, updated_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: patient_medical_history_versions patient_medical_history_versions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_medical_history_versions
    ADD CONSTRAINT patient_medical_history_versions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: patient_medical_history_versions patient_medical_history_versions_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_medical_history_versions
    ADD CONSTRAINT patient_medical_history_versions_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) ON DELETE CASCADE;


--
-- Name: patient_medical_history_versions patient_medical_history_versions_tenant_id_saved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patient_medical_history_versions
    ADD CONSTRAINT patient_medical_history_versions_tenant_id_saved_by_fkey FOREIGN KEY (tenant_id, saved_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: patients patients_created_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_created_by_member_fk FOREIGN KEY (tenant_id, created_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: patients patients_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: patients patients_tenant_id_guardian_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_tenant_id_guardian_patient_id_fkey FOREIGN KEY (tenant_id, guardian_patient_id) REFERENCES public.patients(tenant_id, id) ON DELETE SET NULL (guardian_patient_id);


--
-- Name: patients patients_tenant_id_merged_into_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_tenant_id_merged_into_id_fkey FOREIGN KEY (tenant_id, merged_into_id) REFERENCES public.patients(tenant_id, id) DEFERRABLE;


--
-- Name: patients patients_tenant_id_preferred_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_tenant_id_preferred_branch_id_fkey FOREIGN KEY (tenant_id, preferred_branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE SET NULL (preferred_branch_id);


--
-- Name: payment_gateways payment_gateways_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_gateways
    ADD CONSTRAINT payment_gateways_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: payment_plans payment_plans_created_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_plans
    ADD CONSTRAINT payment_plans_created_by_member_fk FOREIGN KEY (tenant_id, created_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: payment_plans payment_plans_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_plans
    ADD CONSTRAINT payment_plans_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: payment_plans payment_plans_tenant_id_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_plans
    ADD CONSTRAINT payment_plans_tenant_id_invoice_id_fkey FOREIGN KEY (tenant_id, invoice_id) REFERENCES public.invoices(tenant_id, id) DEFERRABLE;


--
-- Name: payment_plans payment_plans_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_plans
    ADD CONSTRAINT payment_plans_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) DEFERRABLE;


--
-- Name: payment_plans payment_plans_tenant_id_treatment_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_plans
    ADD CONSTRAINT payment_plans_tenant_id_treatment_plan_id_fkey FOREIGN KEY (tenant_id, treatment_plan_id) REFERENCES public.treatment_plans(tenant_id, id) DEFERRABLE;


--
-- Name: payments payments_received_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_received_by_member_fk FOREIGN KEY (tenant_id, received_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: payments payments_reversed_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_reversed_by_member_fk FOREIGN KEY (tenant_id, reversed_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: payments payments_tenant_id_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_tenant_id_appointment_id_fkey FOREIGN KEY (tenant_id, appointment_id) REFERENCES public.appointments(tenant_id, id) DEFERRABLE;


--
-- Name: payments payments_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) DEFERRABLE;


--
-- Name: payments payments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: payments payments_tenant_id_installment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_tenant_id_installment_id_fkey FOREIGN KEY (tenant_id, installment_id) REFERENCES public.installments(tenant_id, id) DEFERRABLE;


--
-- Name: payments payments_tenant_id_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_tenant_id_invoice_id_fkey FOREIGN KEY (tenant_id, invoice_id) REFERENCES public.invoices(tenant_id, id) DEFERRABLE;


--
-- Name: payments payments_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) DEFERRABLE;


--
-- Name: platform_audit_log platform_audit_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_audit_log
    ADD CONSTRAINT platform_audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) DEFERRABLE;


--
-- Name: platform_audit_log platform_audit_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_audit_log
    ADD CONSTRAINT platform_audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: platform_invoices platform_invoices_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_invoices
    ADD CONSTRAINT platform_invoices_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: platform_invoices platform_invoices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_invoices
    ADD CONSTRAINT platform_invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) DEFERRABLE;


--
-- Name: platform_invoices platform_invoices_tenant_id_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_invoices
    ADD CONSTRAINT platform_invoices_tenant_id_subscription_id_fkey FOREIGN KEY (tenant_id, subscription_id) REFERENCES public.subscriptions(tenant_id, id) DEFERRABLE;


--
-- Name: platform_settings platform_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: platform_tenant_notes platform_tenant_notes_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_tenant_notes
    ADD CONSTRAINT platform_tenant_notes_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES public.users(id) DEFERRABLE;


--
-- Name: platform_tenant_notes platform_tenant_notes_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.platform_tenant_notes
    ADD CONSTRAINT platform_tenant_notes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: posts posts_tenant_id_cover_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_tenant_id_cover_file_id_fkey FOREIGN KEY (tenant_id, cover_file_id) REFERENCES public.files(tenant_id, id) ON DELETE SET NULL (cover_file_id);


--
-- Name: posts posts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: prescription_items prescription_items_tenant_id_prescription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prescription_items
    ADD CONSTRAINT prescription_items_tenant_id_prescription_id_fkey FOREIGN KEY (tenant_id, prescription_id) REFERENCES public.prescriptions(tenant_id, id) ON DELETE CASCADE;


--
-- Name: prescriptions prescriptions_issued_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_issued_by_member_fk FOREIGN KEY (tenant_id, issued_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: prescriptions prescriptions_replaces_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_replaces_fk FOREIGN KEY (tenant_id, replaces_id) REFERENCES public.prescriptions(tenant_id, id) DEFERRABLE;


--
-- Name: prescriptions prescriptions_tenant_id_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_tenant_id_doctor_id_fkey FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) DEFERRABLE;


--
-- Name: prescriptions prescriptions_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) DEFERRABLE;


--
-- Name: prescriptions prescriptions_tenant_id_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_tenant_id_visit_id_fkey FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits(tenant_id, id) ON DELETE CASCADE;


--
-- Name: recalls recalls_created_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recalls
    ADD CONSTRAINT recalls_created_by_member_fk FOREIGN KEY (tenant_id, created_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: recalls recalls_tenant_id_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recalls
    ADD CONSTRAINT recalls_tenant_id_appointment_id_fkey FOREIGN KEY (tenant_id, appointment_id) REFERENCES public.appointments(tenant_id, id) ON DELETE SET NULL (appointment_id);


--
-- Name: recalls recalls_tenant_id_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recalls
    ADD CONSTRAINT recalls_tenant_id_doctor_id_fkey FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) ON DELETE SET NULL (doctor_id);


--
-- Name: recalls recalls_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recalls
    ADD CONSTRAINT recalls_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: recalls recalls_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recalls
    ADD CONSTRAINT recalls_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) ON DELETE CASCADE;


--
-- Name: recalls recalls_tenant_id_source_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recalls
    ADD CONSTRAINT recalls_tenant_id_source_visit_id_fkey FOREIGN KEY (tenant_id, source_visit_id) REFERENCES public.visits(tenant_id, id) ON DELETE SET NULL (source_visit_id);


--
-- Name: refresh_tokens refresh_tokens_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: refunds refunds_branch_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_branch_fk FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) DEFERRABLE;


--
-- Name: refunds refunds_created_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_created_by_member_fk FOREIGN KEY (tenant_id, created_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: refunds refunds_tenant_id_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_tenant_id_payment_id_fkey FOREIGN KEY (tenant_id, payment_id) REFERENCES public.payments(tenant_id, id) DEFERRABLE;


--
-- Name: reviews reviews_tenant_id_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_tenant_id_appointment_id_fkey FOREIGN KEY (tenant_id, appointment_id) REFERENCES public.appointments(tenant_id, id) ON DELETE SET NULL (appointment_id);


--
-- Name: reviews reviews_tenant_id_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_tenant_id_doctor_id_fkey FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) ON DELETE SET NULL (doctor_id);


--
-- Name: reviews reviews_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) ON DELETE SET NULL (patient_id);


--
-- Name: roles roles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: rooms rooms_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE CASCADE;


--
-- Name: service_categories service_categories_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: services services_catalog_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_catalog_code_fkey FOREIGN KEY (catalog_code) REFERENCES public.service_catalog(code) DEFERRABLE;


--
-- Name: services services_tenant_id_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_tenant_id_category_id_fkey FOREIGN KEY (tenant_id, category_id) REFERENCES public.service_categories(tenant_id, id) ON DELETE SET NULL (category_id);


--
-- Name: services services_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: services services_tenant_id_image_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_tenant_id_image_file_id_fkey FOREIGN KEY (tenant_id, image_file_id) REFERENCES public.files(tenant_id, id) ON DELETE SET NULL (image_file_id);


--
-- Name: site_pages site_pages_tenant_id_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.site_pages
    ADD CONSTRAINT site_pages_tenant_id_site_id_fkey FOREIGN KEY (tenant_id, site_id) REFERENCES public.sites(tenant_id, id) ON DELETE CASCADE;


--
-- Name: sites sites_share_file_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_share_file_fk FOREIGN KEY (tenant_id, share_file_id) REFERENCES public.files(tenant_id, id) ON DELETE SET NULL (share_file_id);


--
-- Name: sites sites_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id) DEFERRABLE;


--
-- Name: sites sites_tenant_id_favicon_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_tenant_id_favicon_file_id_fkey FOREIGN KEY (tenant_id, favicon_file_id) REFERENCES public.files(tenant_id, id) ON DELETE SET NULL (favicon_file_id);


--
-- Name: sites sites_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id) DEFERRABLE;


--
-- Name: subscriptions subscriptions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: suppliers suppliers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_counters tenant_counters_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenant_counters
    ADD CONSTRAINT tenant_counters_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_members tenant_members_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_members tenant_members_tenant_id_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_tenant_id_role_id_fkey FOREIGN KEY (tenant_id, role_id) REFERENCES public.roles(tenant_id, id) DEFERRABLE;


--
-- Name: tenant_members tenant_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tenant_settings tenant_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenant_settings
    ADD CONSTRAINT tenant_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenants tenants_deletion_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_deletion_requested_by_fkey FOREIGN KEY (deletion_requested_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tenants tenants_logo_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_logo_fk FOREIGN KEY (id, logo_file_id) REFERENCES public.files(tenant_id, id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: tooth_records tooth_records_recorded_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tooth_records
    ADD CONSTRAINT tooth_records_recorded_by_member_fk FOREIGN KEY (tenant_id, recorded_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: tooth_records tooth_records_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tooth_records
    ADD CONSTRAINT tooth_records_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) ON DELETE CASCADE;


--
-- Name: tooth_records tooth_records_tenant_id_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tooth_records
    ADD CONSTRAINT tooth_records_tenant_id_visit_id_fkey FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits(tenant_id, id) ON DELETE SET NULL (visit_id);


--
-- Name: treatment_plan_items treatment_plan_items_tenant_id_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.treatment_plan_items
    ADD CONSTRAINT treatment_plan_items_tenant_id_appointment_id_fkey FOREIGN KEY (tenant_id, appointment_id) REFERENCES public.appointments(tenant_id, id) ON DELETE SET NULL (appointment_id);


--
-- Name: treatment_plan_items treatment_plan_items_tenant_id_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.treatment_plan_items
    ADD CONSTRAINT treatment_plan_items_tenant_id_plan_id_fkey FOREIGN KEY (tenant_id, plan_id) REFERENCES public.treatment_plans(tenant_id, id) ON DELETE CASCADE;


--
-- Name: treatment_plan_items treatment_plan_items_tenant_id_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.treatment_plan_items
    ADD CONSTRAINT treatment_plan_items_tenant_id_service_id_fkey FOREIGN KEY (tenant_id, service_id) REFERENCES public.services(tenant_id, id) DEFERRABLE;


--
-- Name: treatment_plans treatment_plans_accepted_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.treatment_plans
    ADD CONSTRAINT treatment_plans_accepted_by_member_fk FOREIGN KEY (tenant_id, accepted_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: treatment_plans treatment_plans_tenant_id_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.treatment_plans
    ADD CONSTRAINT treatment_plans_tenant_id_doctor_id_fkey FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) DEFERRABLE;


--
-- Name: treatment_plans treatment_plans_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.treatment_plans
    ADD CONSTRAINT treatment_plans_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: treatment_plans treatment_plans_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.treatment_plans
    ADD CONSTRAINT treatment_plans_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) DEFERRABLE;


--
-- Name: usage_counters usage_counters_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usage_counters
    ADD CONSTRAINT usage_counters_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: visit_amendments visit_amendments_tenant_id_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visit_amendments
    ADD CONSTRAINT visit_amendments_tenant_id_author_id_fkey FOREIGN KEY (tenant_id, author_id) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: visit_amendments visit_amendments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visit_amendments
    ADD CONSTRAINT visit_amendments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: visit_amendments visit_amendments_tenant_id_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visit_amendments
    ADD CONSTRAINT visit_amendments_tenant_id_visit_id_fkey FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits(tenant_id, id) ON DELETE CASCADE;


--
-- Name: visit_procedures visit_procedures_created_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visit_procedures
    ADD CONSTRAINT visit_procedures_created_by_member_fk FOREIGN KEY (tenant_id, created_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: visit_procedures visit_procedures_tenant_id_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visit_procedures
    ADD CONSTRAINT visit_procedures_tenant_id_doctor_id_fkey FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) DEFERRABLE;


--
-- Name: visit_procedures visit_procedures_tenant_id_payout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visit_procedures
    ADD CONSTRAINT visit_procedures_tenant_id_payout_id_fkey FOREIGN KEY (tenant_id, payout_id) REFERENCES public.doctor_payouts(tenant_id, id) ON DELETE SET NULL (payout_id);


--
-- Name: visit_procedures visit_procedures_tenant_id_plan_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visit_procedures
    ADD CONSTRAINT visit_procedures_tenant_id_plan_item_id_fkey FOREIGN KEY (tenant_id, plan_item_id) REFERENCES public.treatment_plan_items(tenant_id, id) ON DELETE SET NULL (plan_item_id);


--
-- Name: visit_procedures visit_procedures_tenant_id_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visit_procedures
    ADD CONSTRAINT visit_procedures_tenant_id_service_id_fkey FOREIGN KEY (tenant_id, service_id) REFERENCES public.services(tenant_id, id) DEFERRABLE;


--
-- Name: visit_procedures visit_procedures_tenant_id_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visit_procedures
    ADD CONSTRAINT visit_procedures_tenant_id_visit_id_fkey FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits(tenant_id, id) ON DELETE CASCADE;


--
-- Name: visits visits_created_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_created_by_member_fk FOREIGN KEY (tenant_id, created_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: visits visits_finalized_by_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_finalized_by_member_fk FOREIGN KEY (tenant_id, finalized_by) REFERENCES public.tenant_members(tenant_id, id) DEFERRABLE;


--
-- Name: visits visits_tenant_id_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_tenant_id_appointment_id_fkey FOREIGN KEY (tenant_id, appointment_id) REFERENCES public.appointments(tenant_id, id) DEFERRABLE;


--
-- Name: visits visits_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) DEFERRABLE;


--
-- Name: visits visits_tenant_id_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_tenant_id_doctor_id_fkey FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) DEFERRABLE;


--
-- Name: visits visits_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: visits visits_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) DEFERRABLE;


--
-- Name: waitlist_entries waitlist_entries_tenant_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.waitlist_entries
    ADD CONSTRAINT waitlist_entries_tenant_id_branch_id_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) DEFERRABLE;


--
-- Name: waitlist_entries waitlist_entries_tenant_id_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.waitlist_entries
    ADD CONSTRAINT waitlist_entries_tenant_id_doctor_id_fkey FOREIGN KEY (tenant_id, doctor_id) REFERENCES public.doctors(tenant_id, id) DEFERRABLE;


--
-- Name: waitlist_entries waitlist_entries_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.waitlist_entries
    ADD CONSTRAINT waitlist_entries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: waitlist_entries waitlist_entries_tenant_id_offered_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.waitlist_entries
    ADD CONSTRAINT waitlist_entries_tenant_id_offered_appointment_id_fkey FOREIGN KEY (tenant_id, offered_appointment_id) REFERENCES public.appointments(tenant_id, id) ON DELETE SET NULL (offered_appointment_id);


--
-- Name: waitlist_entries waitlist_entries_tenant_id_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.waitlist_entries
    ADD CONSTRAINT waitlist_entries_tenant_id_patient_id_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients(tenant_id, id) ON DELETE CASCADE;


--
-- Name: waitlist_entries waitlist_entries_tenant_id_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.waitlist_entries
    ADD CONSTRAINT waitlist_entries_tenant_id_service_id_fkey FOREIGN KEY (tenant_id, service_id) REFERENCES public.services(tenant_id, id) DEFERRABLE;


--
-- Name: webhook_events webhook_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: appointments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: balance_adjustments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.balance_adjustments ENABLE ROW LEVEL SECURITY;

--
-- Name: appointments branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.appointments AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[])))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[]))));


--
-- Name: balance_adjustments branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.balance_adjustments AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.invoices i
  WHERE (i.id = balance_adjustments.invoice_id))))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.invoices i
  WHERE (i.id = balance_adjustments.invoice_id)))));


--
-- Name: cash_session_reopenings branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.cash_session_reopenings AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.cash_sessions s
  WHERE (s.id = cash_session_reopenings.session_id))))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.cash_sessions s
  WHERE (s.id = cash_session_reopenings.session_id)))));


--
-- Name: cash_sessions branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.cash_sessions AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[])))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[]))));


--
-- Name: expenses branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.expenses AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[])))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[]))));


--
-- Name: installments branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.installments AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.payment_plans p
  WHERE (p.id = installments.plan_id))))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.payment_plans p
  WHERE (p.id = installments.plan_id)))));


--
-- Name: inventory_movements branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.inventory_movements AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[])))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[]))));


--
-- Name: inventory_stock branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.inventory_stock AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[])))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[]))));


--
-- Name: invoice_items branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.invoice_items AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.invoices i
  WHERE (i.id = invoice_items.invoice_id))))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.invoices i
  WHERE (i.id = invoice_items.invoice_id)))));


--
-- Name: invoices branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.invoices AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[])))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[]))));


--
-- Name: lab_orders branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.lab_orders AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[])))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[]))));


--
-- Name: payment_plans branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.payment_plans AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (invoice_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.invoices i
  WHERE (i.id = payment_plans.invoice_id))))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (invoice_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.invoices i
  WHERE (i.id = payment_plans.invoice_id)))));


--
-- Name: payments branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.payments AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[])))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[]))));


--
-- Name: prescription_items branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.prescription_items AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.prescriptions p
  WHERE (p.id = prescription_items.prescription_id))))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.prescriptions p
  WHERE (p.id = prescription_items.prescription_id)))));


--
-- Name: prescriptions branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.prescriptions AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.visits v
  WHERE (v.id = prescriptions.visit_id))))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.visits v
  WHERE (v.id = prescriptions.visit_id)))));


--
-- Name: refunds branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.refunds AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.payments p
  WHERE (p.id = refunds.payment_id))))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.payments p
  WHERE (p.id = refunds.payment_id)))));


--
-- Name: visit_amendments branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.visit_amendments AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.visits v
  WHERE (v.id = visit_amendments.visit_id))))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.visits v
  WHERE (v.id = visit_amendments.visit_id)))));


--
-- Name: visit_procedures branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.visit_procedures AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.visits v
  WHERE (v.id = visit_procedures.visit_id))))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (EXISTS ( SELECT 1
   FROM public.visits v
  WHERE (v.id = visit_procedures.visit_id)))));


--
-- Name: visits branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.visits AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[])))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[]))));


--
-- Name: waitlist_entries branch_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY branch_access ON public.waitlist_entries AS RESTRICTIVE USING (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[])))) WITH CHECK (((( SELECT public.member_branch_ids() AS member_branch_ids) IS NULL) OR (branch_id = ANY (( SELECT public.member_branch_ids() AS member_branch_ids)::uuid[]))));


--
-- Name: branch_hours; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.branch_hours ENABLE ROW LEVEL SECURITY;

--
-- Name: branches; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_session_reopenings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.cash_session_reopenings ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: consent_templates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.consent_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: data_exports; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.data_exports ENABLE ROW LEVEL SECURITY;

--
-- Name: doctor_branches; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.doctor_branches ENABLE ROW LEVEL SECURITY;

--
-- Name: doctor_payouts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.doctor_payouts ENABLE ROW LEVEL SECURITY;

--
-- Name: doctor_schedules; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.doctor_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: doctor_services; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.doctor_services ENABLE ROW LEVEL SECURITY;

--
-- Name: doctor_time_off; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.doctor_time_off ENABLE ROW LEVEL SECURITY;

--
-- Name: doctors; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;

--
-- Name: domains; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.domains ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_categories; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: faqs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;

--
-- Name: files; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

--
-- Name: gallery_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.gallery_items ENABLE ROW LEVEL SECURITY;

--
-- Name: holidays; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

--
-- Name: in_app_notifications; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: installments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.installments ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_movements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_stock; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.inventory_stock ENABLE ROW LEVEL SECURITY;

--
-- Name: invitations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: lab_orders; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.lab_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: labs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.labs ENABLE ROW LEVEL SECURITY;

--
-- Name: member_branches; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.member_branches ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_templates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: outbox_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_consents; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.patient_consents ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_files; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.patient_files ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_medical_history; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.patient_medical_history ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_medical_history_versions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.patient_medical_history_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: patients; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_gateways; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.payment_gateways ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_plans; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.payment_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_invoices; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.platform_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: posts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

--
-- Name: prescription_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;

--
-- Name: prescriptions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: recalls; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.recalls ENABLE ROW LEVEL SECURITY;

--
-- Name: refunds; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

--
-- Name: reviews; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: roles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

--
-- Name: rooms; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: service_categories; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: services; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

--
-- Name: site_pages; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.site_pages ENABLE ROW LEVEL SECURITY;

--
-- Name: sites; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: suppliers; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_counters; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.tenant_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: appointments tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.appointments USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: audit_log tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.audit_log USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: balance_adjustments tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.balance_adjustments USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: branch_hours tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.branch_hours USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: branches tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.branches USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: cash_session_reopenings tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.cash_session_reopenings USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: cash_sessions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.cash_sessions USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: consent_templates tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.consent_templates USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: data_exports tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.data_exports USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: doctor_branches tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.doctor_branches USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: doctor_payouts tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.doctor_payouts USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: doctor_schedules tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.doctor_schedules USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: doctor_services tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.doctor_services USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: doctor_time_off tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.doctor_time_off USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: doctors tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.doctors USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: domains tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.domains USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: expense_categories tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.expense_categories USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: expenses tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.expenses USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: faqs tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.faqs USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: files tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.files USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: gallery_items tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.gallery_items USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: holidays tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.holidays USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: in_app_notifications tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.in_app_notifications USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: installments tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.installments USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: inventory_items tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.inventory_items USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: inventory_movements tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.inventory_movements USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: inventory_stock tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.inventory_stock USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: invitations tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.invitations USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: invoice_items tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.invoice_items USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: invoices tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.invoices USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: lab_orders tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.lab_orders USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: labs tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.labs USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: member_branches tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.member_branches USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: notification_templates tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.notification_templates USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: notifications tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.notifications USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: outbox_events tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.outbox_events USING (((tenant_id = public.current_tenant_id()) OR ((tenant_id IS NULL) AND (public.current_tenant_id() IS NULL)))) WITH CHECK (((tenant_id = public.current_tenant_id()) OR ((tenant_id IS NULL) AND (public.current_tenant_id() IS NULL))));


--
-- Name: patient_consents tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.patient_consents USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: patient_files tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.patient_files USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: patient_medical_history tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.patient_medical_history USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: patient_medical_history_versions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.patient_medical_history_versions USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: patients tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.patients USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: payment_gateways tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.payment_gateways USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: payment_plans tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.payment_plans USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: payments tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.payments USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: platform_invoices tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.platform_invoices USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: posts tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.posts USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: prescription_items tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.prescription_items USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: prescriptions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.prescriptions USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: recalls tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.recalls USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: refunds tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.refunds USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: reviews tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.reviews USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: roles tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.roles USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: rooms tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.rooms USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: service_categories tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.service_categories USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: services tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.services USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: site_pages tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.site_pages USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: sites tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.sites USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: subscriptions tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.subscriptions USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: suppliers tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.suppliers USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: tenant_counters tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.tenant_counters USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: tenant_members tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.tenant_members USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: tenant_settings tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.tenant_settings USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: tooth_records tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.tooth_records USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: treatment_plan_items tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.treatment_plan_items USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: treatment_plans tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.treatment_plans USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: usage_counters tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.usage_counters USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: visit_amendments tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.visit_amendments USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: visit_procedures tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.visit_procedures USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: visits tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.visits USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: waitlist_entries tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.waitlist_entries USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: tenant_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;

--
-- Name: tenants tenant_self; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_self ON public.tenants USING ((id = public.current_tenant_id())) WITH CHECK ((id = public.current_tenant_id()));


--
-- Name: tenant_settings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: tenants; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

--
-- Name: tooth_records; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.tooth_records ENABLE ROW LEVEL SECURITY;

--
-- Name: treatment_plan_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.treatment_plan_items ENABLE ROW LEVEL SECURITY;

--
-- Name: treatment_plans; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.treatment_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_counters; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: visit_amendments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.visit_amendments ENABLE ROW LEVEL SECURITY;

--
-- Name: visit_procedures; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.visit_procedures ENABLE ROW LEVEL SECURITY;

--
-- Name: visits; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;

--
-- Name: waitlist_entries; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO app_user;
GRANT USAGE ON SCHEMA public TO app_worker;
GRANT USAGE ON SCHEMA public TO app_definer;
GRANT USAGE ON SCHEMA public TO app_platform;


--
-- Name: FUNCTION acting_member_is_owner(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.acting_member_is_owner() FROM PUBLIC;
GRANT ALL ON FUNCTION public.acting_member_is_owner() TO app_user;


--
-- Name: FUNCTION billing_instructions(); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.billing_instructions() FROM PUBLIC;
GRANT ALL ON FUNCTION public.billing_instructions() TO app_user;
GRANT ALL ON FUNCTION public.billing_instructions() TO app_worker;
GRANT ALL ON FUNCTION public.billing_instructions() TO app_platform;


--
-- Name: FUNCTION clinic_object_keys(p_tenant uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.clinic_object_keys(p_tenant uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.clinic_object_keys(p_tenant uuid) TO app_worker;


--
-- Name: FUNCTION clinics_due_for_purge(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.clinics_due_for_purge() FROM PUBLIC;
GRANT ALL ON FUNCTION public.clinics_due_for_purge() TO app_worker;


--
-- Name: FUNCTION doctor_busy_intervals(p_doctors uuid[], p_from timestamp with time zone, p_to timestamp with time zone, p_exclude uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.doctor_busy_intervals(p_doctors uuid[], p_from timestamp with time zone, p_to timestamp with time zone, p_exclude uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.doctor_busy_intervals(p_doctors uuid[], p_from timestamp with time zone, p_to timestamp with time zone, p_exclude uuid) TO app_user;


--
-- Name: FUNCTION domain_allowed_for_tls(p_host text); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.domain_allowed_for_tls(p_host text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.domain_allowed_for_tls(p_host text) TO app_user;


--
-- Name: FUNCTION expire_subscriptions(p_grace_days integer); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.expire_subscriptions(p_grace_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.expire_subscriptions(p_grace_days integer) TO app_worker;


--
-- Name: FUNCTION expire_trials(); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.expire_trials() FROM PUBLIC;
GRANT ALL ON FUNCTION public.expire_trials() TO app_worker;


--
-- Name: FUNCTION is_owner_role(p_role uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_owner_role(p_role uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_owner_role(p_role uuid) TO app_user;


--
-- Name: FUNCTION login_candidate(p_email text, p_phone text); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.login_candidate(p_email text, p_phone text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.login_candidate(p_email text, p_phone text) TO app_user;
GRANT ALL ON FUNCTION public.login_candidate(p_email text, p_phone text) TO app_platform;


--
-- Name: FUNCTION mark_no_shows(p_grace interval); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.mark_no_shows(p_grace interval) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_no_shows(p_grace interval) TO app_worker;


--
-- Name: FUNCTION member_access_state(p_member uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.member_access_state(p_member uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.member_access_state(p_member uuid) TO app_user;


--
-- Name: FUNCTION memberships_for_user(p_user uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.memberships_for_user(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.memberships_for_user(p_user uuid) TO app_user;


--
-- Name: FUNCTION merge_patients(p_survivor uuid, p_merged uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.merge_patients(p_survivor uuid, p_merged uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merge_patients(p_survivor uuid, p_merged uuid) TO app_user;


--
-- Name: FUNCTION open_invitation(p_token_hash text); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.open_invitation(p_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.open_invitation(p_token_hash text) TO app_user;


--
-- Name: FUNCTION patient_merge_counts(p_patient uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.patient_merge_counts(p_patient uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.patient_merge_counts(p_patient uuid) TO app_user;


--
-- Name: FUNCTION platform_activate(p_actor uuid, p_tenant uuid, p_cycle text); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_activate(p_actor uuid, p_tenant uuid, p_cycle text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_activate(p_actor uuid, p_tenant uuid, p_cycle text) TO app_platform;


--
-- Name: FUNCTION platform_add_note(p_actor uuid, p_tenant uuid, p_body text); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_add_note(p_actor uuid, p_tenant uuid, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_add_note(p_actor uuid, p_tenant uuid, p_body text) TO app_platform;


--
-- Name: FUNCTION platform_assert_admin(p_actor uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_assert_admin(p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_assert_admin(p_actor uuid) TO app_platform;


--
-- Name: FUNCTION platform_change_plan(p_actor uuid, p_tenant uuid, p_plan uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_change_plan(p_actor uuid, p_tenant uuid, p_plan uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_change_plan(p_actor uuid, p_tenant uuid, p_plan uuid) TO app_platform;


--
-- Name: FUNCTION platform_clinics(p_actor uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_clinics(p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_clinics(p_actor uuid) TO app_platform;


--
-- Name: FUNCTION platform_create_plan(p_actor uuid, p_plan jsonb, p_ip inet); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_create_plan(p_actor uuid, p_plan jsonb, p_ip inet) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_create_plan(p_actor uuid, p_plan jsonb, p_ip inet) TO app_platform;


--
-- Name: FUNCTION platform_deletions(p_actor uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_deletions(p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_deletions(p_actor uuid) TO app_platform;


--
-- Name: FUNCTION platform_extend_trial(p_actor uuid, p_tenant uuid, p_until timestamp with time zone); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_extend_trial(p_actor uuid, p_tenant uuid, p_until timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_extend_trial(p_actor uuid, p_tenant uuid, p_until timestamp with time zone) TO app_platform;


--
-- Name: FUNCTION platform_grace(p_actor uuid, p_tenant uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_grace(p_actor uuid, p_tenant uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_grace(p_actor uuid, p_tenant uuid) TO app_platform;


--
-- Name: FUNCTION platform_leads(p_actor uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_leads(p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_leads(p_actor uuid) TO app_platform;


--
-- Name: FUNCTION platform_notes(p_actor uuid, p_tenant uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_notes(p_actor uuid, p_tenant uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_notes(p_actor uuid, p_tenant uuid) TO app_platform;


--
-- Name: FUNCTION platform_payments(p_actor uuid, p_tenant uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_payments(p_actor uuid, p_tenant uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_payments(p_actor uuid, p_tenant uuid) TO app_platform;


--
-- Name: FUNCTION platform_plan_clinics(p_actor uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_plan_clinics(p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_plan_clinics(p_actor uuid) TO app_platform;


--
-- Name: FUNCTION platform_publish_legal(p_actor uuid, p_kind text, p_title text, p_body text, p_reaccept boolean); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_publish_legal(p_actor uuid, p_kind text, p_title text, p_body text, p_reaccept boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_publish_legal(p_actor uuid, p_kind text, p_title text, p_body text, p_reaccept boolean) TO app_platform;


--
-- Name: FUNCTION platform_reactivate(p_actor uuid, p_tenant uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_reactivate(p_actor uuid, p_tenant uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_reactivate(p_actor uuid, p_tenant uuid) TO app_platform;


--
-- Name: FUNCTION platform_record(p_actor uuid, p_action text, p_tenant uuid, p_details jsonb, p_ip inet); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_record(p_actor uuid, p_action text, p_tenant uuid, p_details jsonb, p_ip inet) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_record(p_actor uuid, p_action text, p_tenant uuid, p_details jsonb, p_ip inet) TO app_platform;


--
-- Name: FUNCTION platform_record_payment(p_actor uuid, p_tenant uuid, p_amount_minor bigint, p_cycle text, p_method text, p_reference text, p_note text, p_key uuid, p_ip inet); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_record_payment(p_actor uuid, p_tenant uuid, p_amount_minor bigint, p_cycle text, p_method text, p_reference text, p_note text, p_key uuid, p_ip inet) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_record_payment(p_actor uuid, p_tenant uuid, p_amount_minor bigint, p_cycle text, p_method text, p_reference text, p_note text, p_key uuid, p_ip inet) TO app_platform;


--
-- Name: FUNCTION platform_restore_clinic(p_actor uuid, p_tenant uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_restore_clinic(p_actor uuid, p_tenant uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_restore_clinic(p_actor uuid, p_tenant uuid) TO app_platform;


--
-- Name: FUNCTION platform_set_billing_instructions(p_actor uuid, p_text text, p_ip inet); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_set_billing_instructions(p_actor uuid, p_text text, p_ip inet) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_set_billing_instructions(p_actor uuid, p_text text, p_ip inet) TO app_platform;


--
-- Name: FUNCTION platform_set_lead_status(p_actor uuid, p_lead uuid, p_status text); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_set_lead_status(p_actor uuid, p_lead uuid, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_set_lead_status(p_actor uuid, p_lead uuid, p_status text) TO app_platform;


--
-- Name: FUNCTION platform_suspend(p_actor uuid, p_tenant uuid, p_reason text); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_suspend(p_actor uuid, p_tenant uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_suspend(p_actor uuid, p_tenant uuid, p_reason text) TO app_platform;


--
-- Name: FUNCTION platform_update_plan(p_actor uuid, p_plan uuid, p_changes jsonb, p_ip inet); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.platform_update_plan(p_actor uuid, p_plan uuid, p_changes jsonb, p_ip inet) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_update_plan(p_actor uuid, p_plan uuid, p_changes jsonb, p_ip inet) TO app_platform;


--
-- Name: FUNCTION provision_tenant(p_slug text, p_name_ar text, p_name_en text, p_owner_user uuid, p_root_domain text, p_plan_code text, p_locale text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.provision_tenant(p_slug text, p_name_ar text, p_name_en text, p_owner_user uuid, p_root_domain text, p_plan_code text, p_locale text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.provision_tenant(p_slug text, p_name_ar text, p_name_en text, p_owner_user uuid, p_root_domain text, p_plan_code text, p_locale text) TO app_user;


--
-- Name: FUNCTION purge_auth_data(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.purge_auth_data() FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_auth_data() TO app_worker;


--
-- Name: FUNCTION purge_clinic(p_tenant uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.purge_clinic(p_tenant uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_clinic(p_tenant uuid) TO app_worker;


--
-- Name: FUNCTION purge_orphan_images(p_age interval); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.purge_orphan_images(p_age interval) FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_orphan_images(p_age interval) TO app_worker;


--
-- Name: FUNCTION release_all_expired_holds(); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.release_all_expired_holds() FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_all_expired_holds() TO app_worker;


--
-- Name: FUNCTION release_expired_holds(p_doctor uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.release_expired_holds(p_doctor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_expired_holds(p_doctor uuid) TO app_user;
GRANT ALL ON FUNCTION public.release_expired_holds(p_doctor uuid) TO app_worker;


--
-- Name: FUNCTION report_attendance(p_from date, p_to date, p_branch uuid, p_doctor uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.report_attendance(p_from date, p_to date, p_branch uuid, p_doctor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_attendance(p_from date, p_to date, p_branch uuid, p_doctor uuid) TO app_user;


--
-- Name: FUNCTION report_expenses(p_from date, p_to date, p_branch uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.report_expenses(p_from date, p_to date, p_branch uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_expenses(p_from date, p_to date, p_branch uuid) TO app_user;


--
-- Name: FUNCTION report_money(p_from date, p_to date, p_branch uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.report_money(p_from date, p_to date, p_branch uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_money(p_from date, p_to date, p_branch uuid) TO app_user;


--
-- Name: FUNCTION report_new_patients(p_from date, p_to date, p_branch uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.report_new_patients(p_from date, p_to date, p_branch uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_new_patients(p_from date, p_to date, p_branch uuid) TO app_user;


--
-- Name: FUNCTION report_outstanding(p_branch uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.report_outstanding(p_branch uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_outstanding(p_branch uuid) TO app_user;


--
-- Name: FUNCTION report_overdue_installments(p_branch uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.report_overdue_installments(p_branch uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_overdue_installments(p_branch uuid) TO app_user;


--
-- Name: FUNCTION report_procedures(p_from date, p_to date, p_branch uuid, p_doctor uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.report_procedures(p_from date, p_to date, p_branch uuid, p_doctor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_procedures(p_from date, p_to date, p_branch uuid, p_doctor uuid) TO app_user;


--
-- Name: FUNCTION request_clinic_deletion(p_user uuid, p_tenant uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.request_clinic_deletion(p_user uuid, p_tenant uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_clinic_deletion(p_user uuid, p_tenant uuid) TO app_user;


--
-- Name: FUNCTION resolve_tenant_by_host(p_host text); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.resolve_tenant_by_host(p_host text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_tenant_by_host(p_host text) TO app_user;


--
-- Name: FUNCTION slug_available(p_slug text); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.slug_available(p_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.slug_available(p_slug text) TO app_user;


--
-- Name: FUNCTION visit_procedure_billed_elsewhere(p_procedure uuid, p_item uuid); Type: ACL; Schema: public; Owner: app_definer
--

REVOKE ALL ON FUNCTION public.visit_procedure_billed_elsewhere(p_procedure uuid, p_item uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.visit_procedure_billed_elsewhere(p_procedure uuid, p_item uuid) TO app_user;


--
-- Name: TABLE appointments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.appointments TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.appointments TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.appointments TO app_definer;


--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.audit_log TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.audit_log TO app_worker;
GRANT INSERT ON TABLE public.audit_log TO app_definer;


--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.audit_log_id_seq TO app_user;
GRANT SELECT,USAGE ON SEQUENCE public.audit_log_id_seq TO app_worker;


--
-- Name: TABLE auth_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.auth_events TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.auth_events TO app_worker;


--
-- Name: SEQUENCE auth_events_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.auth_events_id_seq TO app_user;
GRANT SELECT,USAGE ON SEQUENCE public.auth_events_id_seq TO app_worker;


--
-- Name: TABLE balance_adjustments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.balance_adjustments TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.balance_adjustments TO app_worker;


--
-- Name: TABLE branch_hours; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.branch_hours TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.branch_hours TO app_worker;


--
-- Name: TABLE branches; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.branches TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.branches TO app_worker;
GRANT SELECT ON TABLE public.branches TO app_definer;


--
-- Name: TABLE cash_session_reopenings; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.cash_session_reopenings TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cash_session_reopenings TO app_worker;


--
-- Name: TABLE cash_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.cash_sessions TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cash_sessions TO app_worker;


--
-- Name: TABLE consent_templates; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.consent_templates TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.consent_templates TO app_worker;


--
-- Name: TABLE data_exports; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.data_exports TO app_worker;
GRANT SELECT ON TABLE public.data_exports TO app_user;


--
-- Name: COLUMN data_exports.tenant_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(tenant_id) ON TABLE public.data_exports TO app_user;


--
-- Name: COLUMN data_exports.requested_by; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(requested_by) ON TABLE public.data_exports TO app_user;


--
-- Name: TABLE doctor_branches; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.doctor_branches TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.doctor_branches TO app_worker;
GRANT SELECT ON TABLE public.doctor_branches TO app_definer;


--
-- Name: TABLE doctor_payouts; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.doctor_payouts TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.doctor_payouts TO app_worker;


--
-- Name: TABLE doctor_schedules; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.doctor_schedules TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.doctor_schedules TO app_worker;


--
-- Name: TABLE doctor_services; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.doctor_services TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.doctor_services TO app_worker;


--
-- Name: TABLE doctor_time_off; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.doctor_time_off TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.doctor_time_off TO app_worker;


--
-- Name: TABLE doctors; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.doctors TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.doctors TO app_worker;
GRANT SELECT ON TABLE public.doctors TO app_definer;


--
-- Name: TABLE domains; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.domains TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.domains TO app_worker;
GRANT SELECT ON TABLE public.domains TO app_definer;


--
-- Name: TABLE expense_categories; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.expense_categories TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.expense_categories TO app_worker;


--
-- Name: TABLE expenses; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.expenses TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.expenses TO app_worker;


--
-- Name: TABLE faqs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.faqs TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.faqs TO app_worker;


--
-- Name: TABLE files; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.files TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.files TO app_worker;


--
-- Name: TABLE gallery_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.gallery_items TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.gallery_items TO app_worker;


--
-- Name: TABLE holidays; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.holidays TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.holidays TO app_worker;


--
-- Name: TABLE in_app_notifications; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.in_app_notifications TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.in_app_notifications TO app_worker;


--
-- Name: TABLE installments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.installments TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.installments TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.installments TO app_definer;


--
-- Name: TABLE inventory_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.inventory_items TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.inventory_items TO app_worker;


--
-- Name: TABLE inventory_movements; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.inventory_movements TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.inventory_movements TO app_worker;


--
-- Name: TABLE inventory_stock; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.inventory_stock TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.inventory_stock TO app_worker;


--
-- Name: TABLE invitations; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.invitations TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invitations TO app_worker;
GRANT SELECT ON TABLE public.invitations TO app_definer;


--
-- Name: TABLE invoice_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invoice_items TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invoice_items TO app_worker;
GRANT SELECT ON TABLE public.invoice_items TO app_definer;


--
-- Name: TABLE invoices; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invoices TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invoices TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.invoices TO app_definer;


--
-- Name: TABLE lab_orders; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.lab_orders TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.lab_orders TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.lab_orders TO app_definer;


--
-- Name: TABLE labs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.labs TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.labs TO app_worker;


--
-- Name: TABLE leads; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.leads TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.leads TO app_definer;


--
-- Name: COLUMN leads.full_name; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(full_name) ON TABLE public.leads TO app_user;


--
-- Name: COLUMN leads.phone; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(phone) ON TABLE public.leads TO app_user;


--
-- Name: COLUMN leads.email; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(email) ON TABLE public.leads TO app_user;


--
-- Name: COLUMN leads.clinic_name; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(clinic_name) ON TABLE public.leads TO app_user;


--
-- Name: COLUMN leads.city; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(city) ON TABLE public.leads TO app_user;


--
-- Name: COLUMN leads.message; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(message) ON TABLE public.leads TO app_user;


--
-- Name: COLUMN leads.source; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(source) ON TABLE public.leads TO app_user;


--
-- Name: COLUMN leads.kind; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(kind) ON TABLE public.leads TO app_user;


--
-- Name: COLUMN leads.plan_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(plan_id) ON TABLE public.leads TO app_user;


--
-- Name: COLUMN leads.billing_cycle; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(billing_cycle) ON TABLE public.leads TO app_user;


--
-- Name: COLUMN leads.clinic_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(clinic_id) ON TABLE public.leads TO app_user;


--
-- Name: COLUMN leads.ip; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(ip) ON TABLE public.leads TO app_user;


--
-- Name: COLUMN leads.user_agent; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(user_agent) ON TABLE public.leads TO app_user;


--
-- Name: TABLE legal_acceptances; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT ON TABLE public.legal_acceptances TO app_user;
GRANT SELECT,INSERT ON TABLE public.legal_acceptances TO app_worker;


--
-- Name: COLUMN legal_acceptances.id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(id) ON TABLE public.legal_acceptances TO app_user;


--
-- Name: COLUMN legal_acceptances.user_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(user_id) ON TABLE public.legal_acceptances TO app_user;


--
-- Name: COLUMN legal_acceptances.document_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(document_id) ON TABLE public.legal_acceptances TO app_user;
GRANT SELECT(document_id) ON TABLE public.legal_acceptances TO app_platform;


--
-- Name: COLUMN legal_acceptances.tenant_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(tenant_id) ON TABLE public.legal_acceptances TO app_user;


--
-- Name: COLUMN legal_acceptances.accepted_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(accepted_at) ON TABLE public.legal_acceptances TO app_user;


--
-- Name: TABLE legal_documents; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.legal_documents TO app_user;
GRANT SELECT ON TABLE public.legal_documents TO app_worker;
GRANT SELECT,INSERT ON TABLE public.legal_documents TO app_definer;
GRANT SELECT ON TABLE public.legal_documents TO app_platform;


--
-- Name: TABLE member_branches; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.member_branches TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.member_branches TO app_worker;
GRANT SELECT ON TABLE public.member_branches TO app_definer;


--
-- Name: TABLE notification_templates; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.notification_templates TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_templates TO app_worker;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.notifications TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notifications TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.notifications TO app_definer;


--
-- Name: TABLE otp_codes; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.otp_codes TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.otp_codes TO app_worker;


--
-- Name: TABLE outbox_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.outbox_events TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.outbox_events TO app_worker;


--
-- Name: SEQUENCE outbox_events_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.outbox_events_id_seq TO app_user;
GRANT SELECT,USAGE ON SEQUENCE public.outbox_events_id_seq TO app_worker;


--
-- Name: TABLE patient_consents; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.patient_consents TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patient_consents TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.patient_consents TO app_definer;


--
-- Name: TABLE patient_files; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.patient_files TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patient_files TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.patient_files TO app_definer;


--
-- Name: TABLE patient_medical_history; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.patient_medical_history TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patient_medical_history TO app_worker;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patient_medical_history TO app_definer;


--
-- Name: TABLE patient_medical_history_versions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.patient_medical_history_versions TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patient_medical_history_versions TO app_worker;
GRANT SELECT,INSERT,UPDATE ON TABLE public.patient_medical_history_versions TO app_definer;


--
-- Name: SEQUENCE patient_medical_history_versions_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.patient_medical_history_versions_id_seq TO app_user;
GRANT SELECT,USAGE ON SEQUENCE public.patient_medical_history_versions_id_seq TO app_worker;


--
-- Name: TABLE patients; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.patients TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patients TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.patients TO app_definer;


--
-- Name: TABLE payment_gateways; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.payment_gateways TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.payment_gateways TO app_worker;


--
-- Name: TABLE payment_plans; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.payment_plans TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.payment_plans TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.payment_plans TO app_definer;


--
-- Name: TABLE payments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.payments TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.payments TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.payments TO app_definer;


--
-- Name: TABLE plans; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.plans TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.plans TO app_worker;
GRANT SELECT,INSERT ON TABLE public.plans TO app_definer;
GRANT SELECT ON TABLE public.plans TO app_platform;


--
-- Name: COLUMN plans.name_ar; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(name_ar) ON TABLE public.plans TO app_definer;


--
-- Name: COLUMN plans.price_monthly_minor; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(price_monthly_minor) ON TABLE public.plans TO app_definer;


--
-- Name: COLUMN plans.price_yearly_minor; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(price_yearly_minor) ON TABLE public.plans TO app_definer;


--
-- Name: COLUMN plans.trial_days; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(trial_days) ON TABLE public.plans TO app_definer;


--
-- Name: COLUMN plans.limits; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(limits) ON TABLE public.plans TO app_definer;


--
-- Name: COLUMN plans.features; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(features) ON TABLE public.plans TO app_definer;


--
-- Name: COLUMN plans.is_public; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(is_public) ON TABLE public.plans TO app_definer;


--
-- Name: COLUMN plans.updated_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(updated_at) ON TABLE public.plans TO app_definer;


--
-- Name: TABLE platform_audit_log; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_audit_log TO app_worker;
GRANT SELECT,INSERT ON TABLE public.platform_audit_log TO app_definer;
GRANT SELECT ON TABLE public.platform_audit_log TO app_platform;


--
-- Name: SEQUENCE platform_audit_log_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.platform_audit_log_id_seq TO app_user;
GRANT SELECT,USAGE ON SEQUENCE public.platform_audit_log_id_seq TO app_worker;


--
-- Name: SEQUENCE platform_invoice_number_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.platform_invoice_number_seq TO app_user;
GRANT SELECT,USAGE ON SEQUENCE public.platform_invoice_number_seq TO app_worker;
GRANT USAGE ON SEQUENCE public.platform_invoice_number_seq TO app_definer;


--
-- Name: TABLE platform_invoices; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_invoices TO app_worker;
GRANT SELECT,INSERT ON TABLE public.platform_invoices TO app_definer;


--
-- Name: COLUMN platform_invoices.id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(id) ON TABLE public.platform_invoices TO app_user;


--
-- Name: COLUMN platform_invoices.tenant_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(tenant_id) ON TABLE public.platform_invoices TO app_user;


--
-- Name: COLUMN platform_invoices.subscription_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(subscription_id) ON TABLE public.platform_invoices TO app_user;


--
-- Name: COLUMN platform_invoices.number; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(number) ON TABLE public.platform_invoices TO app_user;


--
-- Name: COLUMN platform_invoices.period_start; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(period_start) ON TABLE public.platform_invoices TO app_user;


--
-- Name: COLUMN platform_invoices.period_end; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(period_end) ON TABLE public.platform_invoices TO app_user;


--
-- Name: COLUMN platform_invoices.amount_minor; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(amount_minor) ON TABLE public.platform_invoices TO app_user;


--
-- Name: COLUMN platform_invoices.tax_minor; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(tax_minor) ON TABLE public.platform_invoices TO app_user;


--
-- Name: COLUMN platform_invoices.currency; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(currency) ON TABLE public.platform_invoices TO app_user;


--
-- Name: COLUMN platform_invoices.status; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(status) ON TABLE public.platform_invoices TO app_user;


--
-- Name: COLUMN platform_invoices.provider; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(provider) ON TABLE public.platform_invoices TO app_user;


--
-- Name: COLUMN platform_invoices.provider_ref; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(provider_ref) ON TABLE public.platform_invoices TO app_user;


--
-- Name: COLUMN platform_invoices.pdf_file_key; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(pdf_file_key) ON TABLE public.platform_invoices TO app_user;


--
-- Name: COLUMN platform_invoices.issued_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(issued_at) ON TABLE public.platform_invoices TO app_user;


--
-- Name: COLUMN platform_invoices.paid_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(paid_at) ON TABLE public.platform_invoices TO app_user;


--
-- Name: COLUMN platform_invoices.billing_cycle; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_cycle) ON TABLE public.platform_invoices TO app_user;


--
-- Name: TABLE platform_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_settings TO app_definer;


--
-- Name: TABLE platform_tenant_notes; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.platform_tenant_notes TO app_definer;


--
-- Name: TABLE posts; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.posts TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.posts TO app_worker;


--
-- Name: TABLE prescription_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.prescription_items TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.prescription_items TO app_worker;


--
-- Name: TABLE prescriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.prescriptions TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.prescriptions TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.prescriptions TO app_definer;


--
-- Name: TABLE recalls; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.recalls TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.recalls TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.recalls TO app_definer;


--
-- Name: TABLE refresh_tokens; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.refresh_tokens TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.refresh_tokens TO app_worker;


--
-- Name: TABLE refunds; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.refunds TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.refunds TO app_worker;
GRANT SELECT ON TABLE public.refunds TO app_definer;


--
-- Name: TABLE reviews; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.reviews TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.reviews TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.reviews TO app_definer;


--
-- Name: TABLE roles; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.roles TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.roles TO app_worker;
GRANT SELECT ON TABLE public.roles TO app_definer;


--
-- Name: TABLE rooms; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.rooms TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rooms TO app_worker;


--
-- Name: TABLE service_catalog; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.service_catalog TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.service_catalog TO app_worker;


--
-- Name: TABLE service_categories; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.service_categories TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.service_categories TO app_worker;


--
-- Name: TABLE services; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.services TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.services TO app_worker;
GRANT SELECT ON TABLE public.services TO app_definer;


--
-- Name: TABLE site_pages; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.site_pages TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.site_pages TO app_worker;


--
-- Name: TABLE sites; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.sites TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sites TO app_worker;


--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.subscriptions TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.subscriptions TO app_worker;
GRANT SELECT ON TABLE public.subscriptions TO app_definer;


--
-- Name: COLUMN subscriptions.plan_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(plan_id) ON TABLE public.subscriptions TO app_definer;


--
-- Name: COLUMN subscriptions.status; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(status) ON TABLE public.subscriptions TO app_definer;


--
-- Name: COLUMN subscriptions.billing_cycle; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(billing_cycle) ON TABLE public.subscriptions TO app_definer;


--
-- Name: COLUMN subscriptions.trial_ends_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(trial_ends_at) ON TABLE public.subscriptions TO app_definer;


--
-- Name: COLUMN subscriptions.current_period_start; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(current_period_start) ON TABLE public.subscriptions TO app_definer;


--
-- Name: COLUMN subscriptions.current_period_end; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(current_period_end) ON TABLE public.subscriptions TO app_definer;


--
-- Name: COLUMN subscriptions.grace_ends_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(grace_ends_at) ON TABLE public.subscriptions TO app_definer;


--
-- Name: COLUMN subscriptions.updated_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(updated_at) ON TABLE public.subscriptions TO app_definer;


--
-- Name: TABLE suppliers; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.suppliers TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.suppliers TO app_worker;


--
-- Name: TABLE templates; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.templates TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.templates TO app_worker;


--
-- Name: TABLE tenant_counters; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.tenant_counters TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_counters TO app_worker;


--
-- Name: TABLE tenant_members; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.tenant_members TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_members TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.tenant_members TO app_definer;


--
-- Name: TABLE tenant_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.tenant_settings TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_settings TO app_worker;


--
-- Name: TABLE tenants; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.tenants TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenants TO app_worker;
GRANT SELECT ON TABLE public.tenants TO app_definer;


--
-- Name: COLUMN tenants.name_en; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(name_en) ON TABLE public.tenants TO app_user;


--
-- Name: COLUMN tenants.name_ar; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(name_ar) ON TABLE public.tenants TO app_user;


--
-- Name: COLUMN tenants.status; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(status) ON TABLE public.tenants TO app_definer;


--
-- Name: COLUMN tenants.onboarding_step; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(onboarding_step) ON TABLE public.tenants TO app_user;


--
-- Name: COLUMN tenants.timezone; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(timezone) ON TABLE public.tenants TO app_user;


--
-- Name: COLUMN tenants.currency; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(currency) ON TABLE public.tenants TO app_user;


--
-- Name: COLUMN tenants.default_locale; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(default_locale) ON TABLE public.tenants TO app_user;


--
-- Name: COLUMN tenants.logo_file_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(logo_file_id) ON TABLE public.tenants TO app_user;


--
-- Name: COLUMN tenants.primary_phone; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(primary_phone) ON TABLE public.tenants TO app_user;


--
-- Name: COLUMN tenants.whatsapp; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(whatsapp) ON TABLE public.tenants TO app_user;


--
-- Name: COLUMN tenants.email; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(email) ON TABLE public.tenants TO app_user;


--
-- Name: COLUMN tenants.social_links; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(social_links) ON TABLE public.tenants TO app_user;


--
-- Name: COLUMN tenants.specialties; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(specialties) ON TABLE public.tenants TO app_user;


--
-- Name: COLUMN tenants.about_en; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(about_en) ON TABLE public.tenants TO app_user;


--
-- Name: COLUMN tenants.about_ar; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(about_ar) ON TABLE public.tenants TO app_user;


--
-- Name: COLUMN tenants.updated_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(updated_at) ON TABLE public.tenants TO app_user;
GRANT UPDATE(updated_at) ON TABLE public.tenants TO app_definer;


--
-- Name: COLUMN tenants.deleted_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(deleted_at) ON TABLE public.tenants TO app_definer;


--
-- Name: COLUMN tenants.suspended_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(suspended_at) ON TABLE public.tenants TO app_definer;


--
-- Name: COLUMN tenants.suspension_reason; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(suspension_reason) ON TABLE public.tenants TO app_definer;


--
-- Name: COLUMN tenants.suspension_kind; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(suspension_kind) ON TABLE public.tenants TO app_definer;


--
-- Name: COLUMN tenants.status_before_suspension; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(status_before_suspension) ON TABLE public.tenants TO app_definer;


--
-- Name: COLUMN tenants.delete_after; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(delete_after) ON TABLE public.tenants TO app_definer;


--
-- Name: COLUMN tenants.deletion_requested_by; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(deletion_requested_by) ON TABLE public.tenants TO app_definer;


--
-- Name: COLUMN tenants.status_before_cancellation; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(status_before_cancellation) ON TABLE public.tenants TO app_definer;


--
-- Name: TABLE tooth_records; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.tooth_records TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tooth_records TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.tooth_records TO app_definer;


--
-- Name: TABLE treatment_plan_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.treatment_plan_items TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.treatment_plan_items TO app_worker;
GRANT SELECT ON TABLE public.treatment_plan_items TO app_definer;


--
-- Name: TABLE treatment_plans; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.treatment_plans TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.treatment_plans TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.treatment_plans TO app_definer;


--
-- Name: TABLE usage_counters; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.usage_counters TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.usage_counters TO app_worker;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.users TO app_worker;
GRANT SELECT ON TABLE public.users TO app_definer;


--
-- Name: COLUMN users.id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(id) ON TABLE public.users TO app_user;
GRANT SELECT(id) ON TABLE public.users TO app_platform;


--
-- Name: COLUMN users.email; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(email),INSERT(email),UPDATE(email) ON TABLE public.users TO app_user;
GRANT SELECT(email) ON TABLE public.users TO app_platform;


--
-- Name: COLUMN users.phone; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(phone),INSERT(phone),UPDATE(phone) ON TABLE public.users TO app_user;


--
-- Name: COLUMN users.password_hash; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT(password_hash),UPDATE(password_hash) ON TABLE public.users TO app_user;


--
-- Name: COLUMN users.google_sub; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(google_sub),INSERT(google_sub),UPDATE(google_sub) ON TABLE public.users TO app_user;


--
-- Name: COLUMN users.full_name; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(full_name),INSERT(full_name),UPDATE(full_name) ON TABLE public.users TO app_user;
GRANT SELECT(full_name) ON TABLE public.users TO app_platform;


--
-- Name: COLUMN users.avatar_url; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(avatar_url),INSERT(avatar_url),UPDATE(avatar_url) ON TABLE public.users TO app_user;


--
-- Name: COLUMN users.locale; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(locale),INSERT(locale),UPDATE(locale) ON TABLE public.users TO app_user;


--
-- Name: COLUMN users.email_verified_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(email_verified_at),UPDATE(email_verified_at) ON TABLE public.users TO app_user;


--
-- Name: COLUMN users.phone_verified_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(phone_verified_at),UPDATE(phone_verified_at) ON TABLE public.users TO app_user;


--
-- Name: COLUMN users.totp_secret_enc; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(totp_secret_enc) ON TABLE public.users TO app_user;


--
-- Name: COLUMN users.platform_role; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(platform_role) ON TABLE public.users TO app_user;


--
-- Name: COLUMN users.is_active; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(is_active) ON TABLE public.users TO app_user;


--
-- Name: COLUMN users.last_login_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(last_login_at),UPDATE(last_login_at) ON TABLE public.users TO app_user;


--
-- Name: COLUMN users.created_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(created_at) ON TABLE public.users TO app_user;


--
-- Name: COLUMN users.updated_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(updated_at),UPDATE(updated_at) ON TABLE public.users TO app_user;


--
-- Name: COLUMN users.sessions_revoked_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(sessions_revoked_at) ON TABLE public.users TO app_user;


--
-- Name: TABLE visit_amendments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.visit_amendments TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.visit_amendments TO app_worker;


--
-- Name: TABLE visit_procedures; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.visit_procedures TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.visit_procedures TO app_worker;


--
-- Name: TABLE visits; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.visits TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.visits TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.visits TO app_definer;


--
-- Name: TABLE waitlist_entries; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.waitlist_entries TO app_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.waitlist_entries TO app_worker;
GRANT SELECT,UPDATE ON TABLE public.waitlist_entries TO app_definer;


--
-- Name: TABLE webhook_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.webhook_events TO app_worker;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,USAGE ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,USAGE ON SEQUENCES TO app_worker;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,UPDATE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO app_worker;


--
-- PostgreSQL database dump complete
--

\unrestrict 5ahh8VR2z6TXdOQVfJVrVMOZ68zR1EcoAU8W9cCgAYD9uRh3Hz5Q3v3QG97gCV5

