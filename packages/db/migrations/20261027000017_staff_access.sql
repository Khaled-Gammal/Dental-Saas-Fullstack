-- migrate:up
-- Phase D1: staff invitations and member management (SRS ACCESS-001, ACCESS-002, ACCESS-005, AUDIT-003). Additive.

-- ---------------------------------------------------------------------
-- 1. Invitations: optional job title and the doctor record the invitee will log in as. At most one open (not yet
--    accepted or revoked) invitation per email and clinic: the API revokes an expired one before inviting again.
-- ---------------------------------------------------------------------
ALTER TABLE invitations
  ADD COLUMN job_title text CHECK (char_length(job_title) BETWEEN 1 AND 80),
  ADD COLUMN doctor_id uuid,
  ADD CONSTRAINT invitations_doctor_fk FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors (tenant_id, id) ON DELETE SET NULL (doctor_id);
CREATE UNIQUE INDEX invitations_one_open_per_email ON invitations (tenant_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- The invitation link, before the invitee has a session: what the accept page shows, for one hashed token.
CREATE OR REPLACE FUNCTION open_invitation(p_token_hash text)
RETURNS TABLE (invitation_id uuid, tenant_id uuid, email text, role_id uuid, role_key text, role_name_ar text,
               branch_ids uuid[], job_title text, doctor_id uuid, expires_at timestamptz,
               clinic_slug text, clinic_name_ar text, clinic_name_en text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.tenant_id, i.email::text, i.role_id, r.key, r.name_ar, i.branch_ids, i.job_title, i.doctor_id, i.expires_at,
         t.slug::text, t.name_ar, t.name_en
  FROM invitations i
  JOIN roles r ON r.id = i.role_id
  JOIN tenants t ON t.id = i.tenant_id
  WHERE i.token_hash = p_token_hash AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
    AND t.deleted_at IS NULL AND t.status <> 'cancelled'
$$;
ALTER FUNCTION open_invitation(text) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION open_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION open_invitation(text) TO app_user;

-- ---------------------------------------------------------------------
-- 2. Access version: bumped whenever a member's role, status or branches change. Access tokens carry the version;
--    the API refuses a token whose version is stale, so a change applies on the member's next request (ACCESS-005).
-- ---------------------------------------------------------------------
ALTER TABLE tenant_members ADD COLUMN access_version int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION tenant_members_bump_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.role_id, NEW.status, NEW.all_branches) IS DISTINCT FROM (OLD.role_id, OLD.status, OLD.all_branches) THEN
    NEW.access_version := OLD.access_version + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_members_bump_access BEFORE UPDATE ON tenant_members
  FOR EACH ROW EXECUTE FUNCTION tenant_members_bump_access();

CREATE OR REPLACE FUNCTION member_branches_bump_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE tenant_members SET access_version = access_version + 1 WHERE id = coalesce(NEW.member_id, OLD.member_id);
  RETURN NULL;
END $$;
CREATE TRIGGER member_branches_bump_access AFTER INSERT OR DELETE ON member_branches
  FOR EACH ROW EXECUTE FUNCTION member_branches_bump_access();

-- Checked on every signed-in request (before a clinic transaction exists): one primary-key lookup, three columns.
CREATE OR REPLACE FUNCTION member_access_state(p_member uuid)
RETURNS TABLE (tenant_id uuid, status text, access_version int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.tenant_id, m.status, m.access_version FROM tenant_members m WHERE m.id = p_member
$$;
ALTER FUNCTION member_access_state(uuid) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION member_access_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_access_state(uuid) TO app_user;

-- ---------------------------------------------------------------------
-- 3. A clinic always keeps at least one active owner. Serialized per clinic, so two owners cannot demote each other
--    at the same moment. Tenant hard delete (app.allow_hard_delete) is exempt.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tenant_members_keep_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_owner_role uuid;
BEGIN
  IF coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' THEN
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
CREATE TRIGGER tenant_members_keep_owner BEFORE UPDATE OR DELETE ON tenant_members
  FOR EACH ROW EXECUTE FUNCTION tenant_members_keep_owner();

-- ---------------------------------------------------------------------
-- 4. Audit trail for staff and clinic setup (AUDIT-003). The function now also handles tables keyed by something
--    other than `id` (tenants, member_branches, doctor_branches, tenant_settings) and stays silent during a tenant
--    hard delete, where the clinic row the audit rows would point at is being removed.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' THEN RETURN NULL; END IF;
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

-- the clinic row itself: profile changes (creation is already recorded as tenant.signup)
CREATE TRIGGER audit_tenants AFTER UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION audit_row_change('clinic');
CREATE TRIGGER audit_tenant_settings AFTER UPDATE ON tenant_settings FOR EACH ROW EXECUTE FUNCTION audit_row_change('clinic_settings');
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('tenant_members', 'member', ARRAY[]::text[]), ('member_branches', 'member_branch', ARRAY[]::text[]),
      ('invitations', 'invitation', ARRAY['token_hash']), ('roles', 'role', ARRAY[]::text[]),
      ('branches', 'branch', ARRAY[]::text[]), ('branch_hours', 'branch_hours', ARRAY[]::text[]),
      ('holidays', 'holiday', ARRAY[]::text[]), ('rooms', 'room', ARRAY[]::text[]),
      ('doctors', 'doctor', ARRAY[]::text[]), ('doctor_branches', 'doctor_branch', ARRAY[]::text[]),
      ('doctor_schedules', 'doctor_schedule', ARRAY[]::text[]), ('doctor_time_off', 'doctor_time_off', ARRAY['reason']),
      ('services', 'service', ARRAY[]::text[]), ('doctor_services', 'doctor_service', ARRAY[]::text[])) x(tbl, entity, secret)
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change(%s)',
                   'audit_' || t.tbl, t.tbl,
                   array_to_string(array_prepend(quote_literal(t.entity), ARRAY(SELECT quote_literal(s) FROM unnest(t.secret) s)), ', '));
  END LOOP;
END $$;

-- migrate:down
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_members','member_branches','invitations','roles','branches','branch_hours','holidays','rooms',
                           'doctors','doctor_branches','doctor_schedules','doctor_time_off','services','doctor_services'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'audit_' || t, t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS audit_tenant_settings ON tenant_settings;
DROP TRIGGER IF EXISTS audit_tenants ON tenants;
-- audit_row_change keeps its newer body (a superset of the 0013 one)
DROP TRIGGER IF EXISTS tenant_members_keep_owner ON tenant_members;
DROP FUNCTION IF EXISTS tenant_members_keep_owner();
DROP FUNCTION IF EXISTS member_access_state(uuid);
DROP TRIGGER IF EXISTS member_branches_bump_access ON member_branches;
DROP FUNCTION IF EXISTS member_branches_bump_access();
DROP TRIGGER IF EXISTS tenant_members_bump_access ON tenant_members;
DROP FUNCTION IF EXISTS tenant_members_bump_access();
ALTER TABLE tenant_members DROP COLUMN IF EXISTS access_version;
DROP FUNCTION IF EXISTS open_invitation(text);
DROP INDEX IF EXISTS invitations_one_open_per_email;
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_doctor_fk, DROP COLUMN IF EXISTS doctor_id, DROP COLUMN IF EXISTS job_title;
