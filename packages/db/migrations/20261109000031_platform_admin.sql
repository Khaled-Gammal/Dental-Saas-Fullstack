-- migrate:up
-- Phase H5 (owner 2026-10-20, reverses the CLR-14 default "defer ADM"): the platform admin panel. A platform admin
-- (users.platform_role = 'super_admin', set by a command) sees every clinic and extends trials, suspends and
-- reactivates clinics, changes their plan and keeps notes (ADM-01, ADM-02), and edits plans (ADM-04).
-- Clinic tables have RLS, so the cross-clinic reads and the writes the API role may not do run in SECURITY DEFINER
-- functions owned by app_definer (BYPASSRLS). Each checks that the acting user is an active platform admin and writes
-- platform_audit_log. They return figures, never patient records.
-- Suspension (owner's choice): staff of a suspended clinic cannot sign in or use the API; its website is offline
-- (resolve_tenant_by_host already skips it). Data is kept; reactivation restores the status it had.

ALTER TABLE tenants
  ADD COLUMN suspended_at       timestamptz,
  ADD COLUMN suspension_reason  text CONSTRAINT tenants_suspension_reason CHECK (char_length(suspension_reason) BETWEEN 3 AND 300),
  ADD COLUMN status_before_suspension text,
  ADD CONSTRAINT tenants_suspension_complete CHECK ((status = 'suspended') = (suspended_at IS NOT NULL AND suspension_reason IS NOT NULL AND status_before_suspension IS NOT NULL)) NOT VALID;

-- private notes the platform team keeps on a clinic (platform data: like plans and the platform audit log since 0004,
-- the API role neither reads nor writes it directly — only through the platform functions below)
CREATE TABLE platform_tenant_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id),
  body           text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_tenant_notes_tenant ON platform_tenant_notes (tenant_id, created_at DESC);
REVOKE ALL ON platform_tenant_notes FROM app_user, app_worker;

-- (users, patients and appointments are readable by app_definer since earlier phases)
GRANT SELECT ON subscriptions, plans, branches, platform_tenant_notes, platform_audit_log TO app_definer;
GRANT UPDATE (status, suspended_at, suspension_reason, status_before_suspension, updated_at) ON tenants TO app_definer;
GRANT UPDATE (status, plan_id, trial_ends_at, updated_at) ON subscriptions TO app_definer;
GRANT UPDATE (name_ar, price_monthly_minor, price_yearly_minor, trial_days, limits, features, is_public, updated_at) ON plans TO app_definer;
GRANT INSERT ON platform_audit_log, platform_tenant_notes TO app_definer;
GRANT UPDATE ON tenant_members TO app_definer;   -- access_version, so a suspension cuts off sessions at once

-- the caller must be an active platform admin (the API passes the user its platform token names)
CREATE OR REPLACE FUNCTION platform_assert_admin(p_actor uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_actor AND platform_role = 'super_admin' AND is_active) THEN
    RAISE EXCEPTION 'not a platform admin' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'platform_admin_only';
  END IF;
END $$;

-- ADM-01: every clinic with its plan and figures (counts only)
CREATE OR REPLACE FUNCTION platform_clinics(p_actor uuid)
RETURNS TABLE (id uuid, slug text, name_ar text, name_en text, status text, created_at timestamptz, suspended_at timestamptz,
               plan_code text, plan_name_ar text, subscription_status text, trial_ends_at timestamptz,
               members int, branches int, patients int, appointments_30d int, last_login_at timestamptz, owner_email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN QUERY
  SELECT t.id, t.slug::text, t.name_ar, t.name_en, t.status, t.created_at, t.suspended_at,
         p.code, p.name_ar, s.status, s.trial_ends_at,
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
  WHERE t.deleted_at IS NULL
  ORDER BY t.created_at DESC;
END $$;

-- ADM-02: extend a trial to a date (later than now, within a year)
CREATE OR REPLACE FUNCTION platform_extend_trial(p_actor uuid, p_tenant uuid, p_until timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (p_actor, 'tenant.trial_extended', p_tenant, jsonb_build_object('from', v_before, 'to', p_until));
END $$;

-- ADM-02: suspend (staff cut off at their next request, website offline) and reactivate (the status it had)
CREATE OR REPLACE FUNCTION platform_suspend(p_actor uuid, p_tenant uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  SELECT status INTO v_status FROM tenants WHERE id = p_tenant AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'clinic not found' USING ERRCODE = 'no_data_found', CONSTRAINT = 'platform_clinic_missing'; END IF;
  IF v_status IN ('suspended', 'cancelled') THEN
    RAISE EXCEPTION 'the clinic is already %', v_status USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_status';
  END IF;
  UPDATE tenants SET status = 'suspended', suspended_at = now(), suspension_reason = btrim(p_reason), status_before_suspension = v_status, updated_at = now()
   WHERE id = p_tenant;
  UPDATE tenant_members SET access_version = access_version + 1 WHERE tenant_id = p_tenant;
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (p_actor, 'tenant.suspended', p_tenant, jsonb_build_object('reason', btrim(p_reason), 'from', v_status));
END $$;

CREATE OR REPLACE FUNCTION platform_reactivate(p_actor uuid, p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_back text;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  SELECT status_before_suspension INTO v_back FROM tenants WHERE id = p_tenant AND status = 'suspended' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the clinic is not suspended' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_status';
  END IF;
  UPDATE tenants SET status = v_back, suspended_at = NULL, suspension_reason = NULL, status_before_suspension = NULL, updated_at = now()
   WHERE id = p_tenant;
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (p_actor, 'tenant.reactivated', p_tenant, jsonb_build_object('to', v_back));
END $$;

-- ADM-02: move the clinic's live subscription to another plan (limits apply to what is added from now on)
CREATE OR REPLACE FUNCTION platform_change_plan(p_actor uuid, p_tenant uuid, p_plan uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

-- what the panel records itself (signing in): the actor must be an admin
CREATE OR REPLACE FUNCTION platform_record(p_actor uuid, p_action text, p_tenant uuid, p_details jsonb, p_ip inet) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details, ip) VALUES (p_actor, p_action, p_tenant, coalesce(p_details, '{}'), p_ip);
END $$;

-- ADM-02: notes on a clinic, kept as written
CREATE OR REPLACE FUNCTION platform_notes(p_actor uuid, p_tenant uuid)
RETURNS TABLE (id uuid, body text, created_at timestamptz, author text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN QUERY SELECT n.id, n.body, n.created_at, u.full_name FROM platform_tenant_notes n JOIN users u ON u.id = n.author_user_id
   WHERE n.tenant_id = p_tenant ORDER BY n.created_at DESC LIMIT 100;
END $$;

CREATE OR REPLACE FUNCTION platform_add_note(p_actor uuid, p_tenant uuid, p_body text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'clinic not found' USING ERRCODE = 'no_data_found', CONSTRAINT = 'platform_clinic_missing';
  END IF;
  INSERT INTO platform_tenant_notes (tenant_id, author_user_id, body) VALUES (p_tenant, p_actor, btrim(p_body));
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id) VALUES (p_actor, 'tenant.note_added', p_tenant);
END $$;

-- ADM-04: a plan's name, prices, trial length, limits and features; limits and features merge into what it has
CREATE OR REPLACE FUNCTION platform_update_plan(p_actor uuid, p_plan uuid, p_changes jsonb, p_ip inet) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

ALTER FUNCTION platform_record(uuid, text, uuid, jsonb, inet) OWNER TO app_definer;
ALTER FUNCTION platform_notes(uuid, uuid) OWNER TO app_definer;
ALTER FUNCTION platform_add_note(uuid, uuid, text) OWNER TO app_definer;
ALTER FUNCTION platform_update_plan(uuid, uuid, jsonb, inet) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION platform_record(uuid, text, uuid, jsonb, inet), platform_notes(uuid, uuid), platform_add_note(uuid, uuid, text),
  platform_update_plan(uuid, uuid, jsonb, inet) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_record(uuid, text, uuid, jsonb, inet), platform_notes(uuid, uuid), platform_add_note(uuid, uuid, text),
  platform_update_plan(uuid, uuid, jsonb, inet) TO app_user;

ALTER FUNCTION platform_assert_admin(uuid) OWNER TO app_definer;
ALTER FUNCTION platform_clinics(uuid) OWNER TO app_definer;
ALTER FUNCTION platform_extend_trial(uuid, uuid, timestamptz) OWNER TO app_definer;
ALTER FUNCTION platform_suspend(uuid, uuid, text) OWNER TO app_definer;
ALTER FUNCTION platform_reactivate(uuid, uuid) OWNER TO app_definer;
ALTER FUNCTION platform_change_plan(uuid, uuid, uuid) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION platform_assert_admin(uuid), platform_clinics(uuid), platform_extend_trial(uuid, uuid, timestamptz),
  platform_suspend(uuid, uuid, text), platform_reactivate(uuid, uuid), platform_change_plan(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_assert_admin(uuid), platform_clinics(uuid), platform_extend_trial(uuid, uuid, timestamptz),
  platform_suspend(uuid, uuid, text), platform_reactivate(uuid, uuid), platform_change_plan(uuid, uuid, uuid) TO app_user;

-- every signed-in clinic request: the member, their clinic's status, the access version (one primary-key lookup)
DROP FUNCTION IF EXISTS member_access_state(uuid);
CREATE FUNCTION member_access_state(p_member uuid)
RETURNS TABLE (tenant_id uuid, status text, access_version int, tenant_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.tenant_id, m.status, m.access_version, t.status FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id WHERE m.id = p_member
$$;
ALTER FUNCTION member_access_state(uuid) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION member_access_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_access_state(uuid) TO app_user;

-- migrate:down
DROP FUNCTION IF EXISTS member_access_state(uuid);
CREATE FUNCTION member_access_state(p_member uuid)
RETURNS TABLE (tenant_id uuid, status text, access_version int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.tenant_id, m.status, m.access_version FROM tenant_members m WHERE m.id = p_member
$$;
ALTER FUNCTION member_access_state(uuid) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION member_access_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_access_state(uuid) TO app_user;
DROP FUNCTION IF EXISTS platform_update_plan(uuid, uuid, jsonb, inet);
DROP FUNCTION IF EXISTS platform_add_note(uuid, uuid, text);
DROP FUNCTION IF EXISTS platform_notes(uuid, uuid);
DROP FUNCTION IF EXISTS platform_record(uuid, text, uuid, jsonb, inet);
DROP FUNCTION IF EXISTS platform_change_plan(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS platform_reactivate(uuid, uuid);
DROP FUNCTION IF EXISTS platform_suspend(uuid, uuid, text);
DROP FUNCTION IF EXISTS platform_extend_trial(uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS platform_clinics(uuid);
DROP FUNCTION IF EXISTS platform_assert_admin(uuid);
REVOKE UPDATE ON tenant_members FROM app_definer;
REVOKE INSERT ON platform_audit_log FROM app_definer;
REVOKE UPDATE (name_ar, price_monthly_minor, price_yearly_minor, trial_days, limits, features, is_public, updated_at) ON plans FROM app_definer;
REVOKE UPDATE (status, plan_id, trial_ends_at, updated_at) ON subscriptions FROM app_definer;
REVOKE UPDATE (status, suspended_at, suspension_reason, status_before_suspension, updated_at) ON tenants FROM app_definer;
REVOKE SELECT ON subscriptions, plans, branches, platform_audit_log FROM app_definer;
DROP TABLE IF EXISTS platform_tenant_notes;
-- a clinic suspended from the panel goes back to the status it had
UPDATE tenants SET status = coalesce(status_before_suspension, status) WHERE status = 'suspended' AND status_before_suspension IS NOT NULL;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_suspension_complete,
  DROP COLUMN IF EXISTS status_before_suspension, DROP COLUMN IF EXISTS suspension_reason, DROP COLUMN IF EXISTS suspended_at;
