-- migrate:up
-- Phase H4 (owner 2026-10-20): roles are the clinic's own. Sign-up creates one role, the owner, holding every
-- permission ('*'); the owner creates every other role and chooses its permissions, and may change or delete any of
-- them. The owner role is the only fixed one. staff:manage may be given to a role (the API stops a member who is not
-- the owner raising their own rights). Mixing clinical and money writing only warns in the dashboard.
-- The API connects as app_user; migrations and seeds run as the admin role, so these guards bind the API only.

-- 1. What a role may hold: the permissions the API checks (B.1). Never '*' (the owner role's alone).
--    The API keeps the same list; a test compares them.
CREATE OR REPLACE FUNCTION grantable_permissions() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'branches:read','branches:write','settings:write','website:write','staff:manage',
    'patients:read','patients:write','patients:merge','patients:block','clinical:read','clinical:write','treatments:write:own',
    'appointments:read','appointments:write','appointments:write:own','appointments:override',
    'invoices:read','invoices:read:own','invoices:write','invoices:void',
    'payments:write','payments:refund','payments:reverse','payments:adjust','discounts:apply','discounts:approve',
    'expenses:read','expenses:write','expenses:approve','cash:operate','cash:reopen',
    'reports:read','reports:read:daily','reports:read:own','audit:read']
$$;

-- 2. Roles: an Arabic name (unique among the clinic's roles in use), archived instead of deleted once referred to
ALTER TABLE roles
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN updated_at  timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT roles_name_ar_length CHECK (char_length(btrim(name_ar)) BETWEEN 2 AND 60);
CREATE UNIQUE INDEX roles_tenant_name_ar ON roles (tenant_id, lower(btrim(name_ar))) WHERE archived_at IS NULL;

-- 3. Existing clinics: the roles sign-up used to create (doctor, receptionist, assistant, accountant) become ordinary
--    roles the owner edits or deletes; they keep their members and their permissions, minus those no feature uses
--    (inventory:*, subscription:read), so every role holds catalogue permissions only. Members whose role changed
--    get a new access version (ACCESS-005).
UPDATE tenant_members m SET access_version = m.access_version + 1 FROM roles r
 WHERE r.id = m.role_id AND r.key <> 'owner' AND NOT r.permissions <@ grantable_permissions();
UPDATE roles SET permissions = ARRAY(SELECT p FROM unnest(permissions) p WHERE p = ANY (grantable_permissions()) ORDER BY p)
 WHERE key <> 'owner' AND NOT permissions <@ grantable_permissions();
UPDATE roles SET is_system = false WHERE is_system AND key <> 'owner';

-- 4. Sign-up creates the owner role only
CREATE OR REPLACE FUNCTION provision_tenant(
  p_slug        text,
  p_name_ar     text,
  p_name_en     text,
  p_owner_user  uuid,
  p_root_domain text,
  p_plan_code   text DEFAULT 'pro',
  p_locale      text DEFAULT 'ar'
) RETURNS TABLE (tenant_id uuid, owner_member_id uuid, branch_id uuid, hostname text)
LANGUAGE plpgsql AS $$
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

  INSERT INTO audit_log (tenant_id, actor_type, actor_user_id, action, entity_type, entity_id)
  VALUES (v_tenant, 'member', p_owner_user, 'tenant.signup', 'tenant', v_tenant);

  RETURN QUERY SELECT v_tenant, v_member, v_branch, v_host;
END $$;

-- 5. The guard: the owner role is fixed; every other role holds catalogue permissions and keeps its key
CREATE OR REPLACE FUNCTION roles_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER roles_guard BEFORE INSERT OR UPDATE OR DELETE ON roles FOR EACH ROW EXECUTE FUNCTION roles_guard();

-- 6. ACCESS-005 for role edits: changing a role's permissions applies to its members on their next request
CREATE OR REPLACE FUNCTION roles_bump_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.permissions IS DISTINCT FROM OLD.permissions THEN
    UPDATE tenant_members SET access_version = access_version + 1 WHERE role_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER roles_bump_access AFTER UPDATE OF permissions ON roles FOR EACH ROW EXECUTE FUNCTION roles_bump_access();

-- 7. An archived role is given to nobody new (members and invitations)
CREATE OR REPLACE FUNCTION role_assignable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id)
     AND EXISTS (SELECT 1 FROM roles WHERE id = NEW.role_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'an archived role is not given to anyone' USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_archived';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_members_role_assignable BEFORE INSERT OR UPDATE OF role_id ON tenant_members FOR EACH ROW EXECUTE FUNCTION role_assignable();
CREATE TRIGGER invitations_role_assignable BEFORE INSERT OR UPDATE OF role_id ON invitations FOR EACH ROW EXECUTE FUNCTION role_assignable();

-- migrate:down
DROP TRIGGER IF EXISTS invitations_role_assignable ON invitations;
DROP TRIGGER IF EXISTS tenant_members_role_assignable ON tenant_members;
DROP FUNCTION IF EXISTS role_assignable();
DROP TRIGGER IF EXISTS roles_bump_access ON roles;
DROP FUNCTION IF EXISTS roles_bump_access();
DROP TRIGGER IF EXISTS roles_guard ON roles;
DROP FUNCTION IF EXISTS roles_guard();
-- sign-up creates the five roles again (0003); the former built-in roles are marked built in again. Roles created
-- since stay; inventory:* and subscription:read are not given back (no feature uses them).
CREATE OR REPLACE FUNCTION provision_tenant(
  p_slug        text,
  p_name_ar     text,
  p_name_en     text,
  p_owner_user  uuid,
  p_root_domain text,
  p_plan_code   text DEFAULT 'pro',
  p_locale      text DEFAULT 'ar'
) RETURNS TABLE (tenant_id uuid, owner_member_id uuid, branch_id uuid, hostname text)
LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_plan   record;
  v_member uuid;
  v_branch uuid;
  v_host   text;
  v_role   text;
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

  FOREACH v_role IN ARRAY ARRAY['owner','doctor','receptionist','assistant','accountant'] LOOP
    INSERT INTO roles (tenant_id, key, name_en, name_ar, is_system, permissions)
    VALUES (v_tenant, v_role,
      initcap(v_role),
      CASE v_role WHEN 'owner' THEN 'المالك' WHEN 'doctor' THEN 'طبيب' WHEN 'receptionist' THEN 'الاستقبال'
                  WHEN 'assistant' THEN 'مساعد' ELSE 'محاسب' END,
      true, default_role_permissions(v_role));
  END LOOP;

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

  INSERT INTO audit_log (tenant_id, actor_type, actor_user_id, action, entity_type, entity_id)
  VALUES (v_tenant, 'member', p_owner_user, 'tenant.signup', 'tenant', v_tenant);

  RETURN QUERY SELECT v_tenant, v_member, v_branch, v_host;
END $$;
UPDATE roles SET is_system = true WHERE key IN ('doctor','receptionist','assistant','accountant');
DROP INDEX IF EXISTS roles_tenant_name_ar;
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_name_ar_length, DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS archived_at;
DROP FUNCTION IF EXISTS grantable_permissions();
