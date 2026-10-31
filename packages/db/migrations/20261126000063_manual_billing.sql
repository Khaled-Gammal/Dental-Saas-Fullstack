-- migrate:up
-- Phase 2B (BIL-02, manual for now — owner 2026-10-31): clinics pay outside the system (InstaPay, Vodafone Cash, a bank
-- transfer, cash) and a platform admin records the payment. Until now "activate" started a month or a year once and
-- nothing happened when it ran out; a clinic stayed active for ever, and an active one could not be renewed.
--
--   * platform_record_payment(): records the payment as a paid platform invoice and extends the subscription by a month
--     or a year — from the end of the paid period when renewing early, from now otherwise — and lifts a suspension for
--     an ended trial or an unpaid subscription. Idempotent per form (a double click records one payment).
--   * expire_subscriptions() (worker, every 15 minutes): a period that ran out makes the subscription past due (the
--     clinic keeps working, warned) and starts its grace (subscriptions.grace_ends_at = now + BILLING_POLICY.graceDays,
--     never in the past: a clinic activated long ago gets its full grace and its reminders after this deploy); when the
--     grace is over the clinic is suspended as unpaid.
--   * The payment instructions the clinics see (one text the platform edits), and each clinic's own payments.

-- 1. suspension for an unpaid subscription, beside "manual" and "trial_ended"
ALTER TABLE tenants DROP CONSTRAINT tenants_suspension_kind;
ALTER TABLE tenants ADD CONSTRAINT tenants_suspension_kind CHECK (suspension_kind IN ('manual', 'trial_ended', 'unpaid'));

-- 2. what a recorded payment keeps beside the invoice columns: the period bought, a note, who recorded it, and the form's
--    idempotency key. provider = the method, provider_ref = the transfer's reference.
ALTER TABLE platform_invoices
  ADD COLUMN billing_cycle   text CONSTRAINT platform_invoices_cycle CHECK (billing_cycle IN ('monthly', 'yearly')),
  ADD COLUMN note            text CONSTRAINT platform_invoices_note CHECK (char_length(note) <= 500),
  ADD COLUMN recorded_by     uuid REFERENCES users(id),
  ADD COLUMN idempotency_key uuid,
  ADD CONSTRAINT platform_invoices_method CHECK (provider IS NULL OR provider IN ('instapay', 'vodafone_cash', 'bank_transfer', 'cash', 'other')),
  ADD CONSTRAINT platform_invoices_period CHECK (period_end > period_start);
CREATE UNIQUE INDEX platform_invoices_idempotency ON platform_invoices (idempotency_key) WHERE idempotency_key IS NOT NULL;
-- the same transfer recorded twice for a clinic is a mistake
CREATE UNIQUE INDEX platform_invoices_reference ON platform_invoices (tenant_id, provider, lower(provider_ref)) WHERE provider_ref IS NOT NULL AND status = 'paid';
CREATE SEQUENCE platform_invoice_number_seq;
REVOKE SELECT ON platform_invoices FROM app_user;
GRANT SELECT (id, tenant_id, subscription_id, number, period_start, period_end, amount_minor, tax_minor, currency, status, provider, provider_ref,
              pdf_file_key, issued_at, paid_at, billing_cycle) ON platform_invoices TO app_user;

-- 3. platform settings: one row per key, written only through the platform functions; the payment instructions are
--    read by the clinic API and the worker through billing_instructions()
CREATE TABLE platform_settings (
  key         text PRIMARY KEY CHECK (key IN ('billing_instructions')),
  value       text NOT NULL CHECK (char_length(value) <= 2000),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id)
);
REVOKE ALL ON platform_settings FROM app_user, app_worker;

CREATE FUNCTION billing_instructions() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT value FROM platform_settings WHERE key = 'billing_instructions'
$$;

CREATE FUNCTION platform_set_billing_instructions(p_actor uuid, p_text text, p_ip inet) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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

-- 4. a payment: the invoice, the new period, the suspension lifted. Returns the invoice id (the same one again for a
--    repeated idempotency key, without extending twice).
CREATE FUNCTION platform_record_payment(p_actor uuid, p_tenant uuid, p_amount_minor bigint, p_cycle text, p_method text,
                                        p_reference text, p_note text, p_key uuid, p_ip inet) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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

-- 5. a clinic's payments, newest first (the panel's role reads no clinic data directly)
CREATE FUNCTION platform_payments(p_actor uuid, p_tenant uuid)
RETURNS TABLE (id uuid, number text, period_start date, period_end date, amount_minor bigint, currency char(3), status text, method text,
               reference text, billing_cycle text, note text, paid_at timestamptz, recorded_by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN QUERY
    SELECT i.id, i.number, i.period_start, i.period_end, i.amount_minor, i.currency, i.status, i.provider, i.provider_ref, i.billing_cycle, i.note,
           i.paid_at, u.full_name::text
      FROM platform_invoices i LEFT JOIN users u ON u.id = i.recorded_by
     WHERE i.tenant_id = p_tenant ORDER BY i.issued_at DESC, i.number DESC LIMIT 200;
END $$;

-- 5b. the day a past-due clinic is suspended (the panel's role reads no subscriptions directly)
CREATE FUNCTION platform_grace(p_actor uuid, p_tenant uuid) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN (SELECT grace_ends_at FROM subscriptions WHERE tenant_id = p_tenant AND status = 'past_due');
END $$;

-- 6. worker: periods that ran out. Past due at once (the clinic keeps working, and is told); suspended as unpaid after
--    the grace days. Returns how many of each.
CREATE FUNCTION expire_subscriptions(p_grace_days int) RETURNS TABLE (past_due int, suspended int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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

-- 7. reactivating an unpaid clinic would be suspended again within minutes: record the payment instead (unless its
--    subscription is already paid again, e.g. activated without a payment). A clinic reactivated from a manual
--    suspension while its subscription is past due gets a fresh grace (the worker sets it), not an instant suspension.
CREATE OR REPLACE FUNCTION platform_reactivate(p_actor uuid, p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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

ALTER FUNCTION billing_instructions() OWNER TO app_definer;
ALTER FUNCTION platform_set_billing_instructions(uuid, text, inet) OWNER TO app_definer;
ALTER FUNCTION platform_record_payment(uuid, uuid, bigint, text, text, text, text, uuid, inet) OWNER TO app_definer;
ALTER FUNCTION platform_payments(uuid, uuid) OWNER TO app_definer;
ALTER FUNCTION platform_grace(uuid, uuid) OWNER TO app_definer;
ALTER FUNCTION expire_subscriptions(int) OWNER TO app_definer;
ALTER FUNCTION platform_reactivate(uuid, uuid) OWNER TO app_definer;
-- (subscriptions, tenants, tenant_members, plans, users and the platform audit log: granted to app_definer by 0031 and earlier)
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_settings TO app_definer;
GRANT SELECT, INSERT ON platform_invoices TO app_definer;
GRANT UPDATE (grace_ends_at) ON subscriptions TO app_definer;
GRANT USAGE ON SEQUENCE platform_invoice_number_seq TO app_definer;
REVOKE EXECUTE ON FUNCTION billing_instructions(), platform_set_billing_instructions(uuid, text, inet),
  platform_record_payment(uuid, uuid, bigint, text, text, text, text, uuid, inet), platform_payments(uuid, uuid), platform_grace(uuid, uuid),
  expire_subscriptions(int), platform_reactivate(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing_instructions() TO app_user, app_worker, app_platform;
GRANT EXECUTE ON FUNCTION platform_set_billing_instructions(uuid, text, inet), platform_record_payment(uuid, uuid, bigint, text, text, text, text, uuid, inet),
  platform_payments(uuid, uuid), platform_grace(uuid, uuid), platform_reactivate(uuid, uuid) TO app_platform;
GRANT EXECUTE ON FUNCTION expire_subscriptions(int) TO app_worker;

-- migrate:down
CREATE OR REPLACE FUNCTION platform_reactivate(p_actor uuid, p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_back text;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  SELECT status_before_suspension INTO v_back FROM tenants WHERE id = p_tenant AND status = 'suspended' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the clinic is not suspended' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_status';
  END IF;
  IF EXISTS (SELECT 1 FROM subscriptions WHERE tenant_id = p_tenant AND status = 'trialing' AND trial_ends_at <= now()) THEN
    RAISE EXCEPTION 'the trial has ended' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_trial_ended';
  END IF;
  UPDATE tenants SET status = v_back, suspended_at = NULL, suspension_reason = NULL, suspension_kind = NULL, status_before_suspension = NULL, updated_at = now()
   WHERE id = p_tenant;
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (p_actor, 'tenant.reactivated', p_tenant, jsonb_build_object('to', v_back));
END $$;
DROP FUNCTION IF EXISTS expire_subscriptions(int);
DROP FUNCTION IF EXISTS platform_grace(uuid, uuid);
DROP FUNCTION IF EXISTS platform_payments(uuid, uuid);
UPDATE subscriptions SET grace_ends_at = NULL WHERE grace_ends_at IS NOT NULL;
REVOKE UPDATE (grace_ends_at) ON subscriptions FROM app_definer;
DROP FUNCTION IF EXISTS platform_record_payment(uuid, uuid, bigint, text, text, text, text, uuid, inet);
DROP FUNCTION IF EXISTS platform_set_billing_instructions(uuid, text, inet);
DROP FUNCTION IF EXISTS billing_instructions();
DROP TABLE IF EXISTS platform_settings;
DROP SEQUENCE IF EXISTS platform_invoice_number_seq;
REVOKE SELECT, INSERT ON platform_invoices FROM app_definer;
REVOKE SELECT (id, tenant_id, subscription_id, number, period_start, period_end, amount_minor, tax_minor, currency, status, provider, provider_ref,
               pdf_file_key, issued_at, paid_at, billing_cycle) ON platform_invoices FROM app_user;
GRANT SELECT ON platform_invoices TO app_user;
DROP INDEX IF EXISTS platform_invoices_reference;
DROP INDEX IF EXISTS platform_invoices_idempotency;
ALTER TABLE platform_invoices DROP CONSTRAINT IF EXISTS platform_invoices_period, DROP CONSTRAINT IF EXISTS platform_invoices_method,
  DROP COLUMN IF EXISTS idempotency_key, DROP COLUMN IF EXISTS recorded_by, DROP COLUMN IF EXISTS note, DROP COLUMN IF EXISTS billing_cycle;
UPDATE tenants SET suspension_kind = 'manual' WHERE suspension_kind = 'unpaid';
ALTER TABLE tenants DROP CONSTRAINT tenants_suspension_kind;
ALTER TABLE tenants ADD CONSTRAINT tenants_suspension_kind CHECK (suspension_kind IN ('manual', 'trial_ended'));
