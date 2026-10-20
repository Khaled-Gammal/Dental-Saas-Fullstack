-- migrate:up
-- Phase H4 (owner 2026-10-20): the owner creates roles and chooses their permissions. Decisions: the built-in roles
-- (owner, doctor, receptionist, assistant, accountant) stay as B.1 sets them; custom roles take any permission of the
-- catalogue below except '*' (the owner's alone); staff:manage may be granted (the API stops a member raising their
-- own rights). Mixing clinical and money writing only warns in the dashboard.
-- The API connects as app_user; migrations and seeds run as the admin role, so these guards bind the API only.

-- 1. What may be granted: the permissions the API checks (B.1). Retired or unused ones (expenses:write:cash,
--    inventory:*, subscription:read) are not offered. The API keeps the same list; a test compares them.
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

-- 2. Custom roles: an Arabic name (unique among the clinic's roles in use), archived instead of deleted once used
ALTER TABLE roles
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN updated_at  timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT roles_name_ar_length CHECK (char_length(btrim(name_ar)) BETWEEN 2 AND 60);
CREATE UNIQUE INDEX roles_tenant_name_ar ON roles (tenant_id, lower(btrim(name_ar))) WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION roles_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r roles; bad text;
BEGIN
  IF current_user <> 'app_user' THEN RETURN coalesce(NEW, OLD); END IF;   -- migrations and seeds
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'a built-in role is not deleted' USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_system_fixed';
    END IF;
    RETURN OLD;
  END IF;
  r := NEW;
  IF TG_OP = 'INSERT' AND r.is_system THEN
    -- sign-up creates the built-in roles with exactly their defaults
    IF r.key NOT IN ('owner','doctor','receptionist','assistant','accountant') OR r.permissions <> default_role_permissions(r.key) THEN
      RAISE EXCEPTION 'a built-in role has its default permissions' USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_system_fixed';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.is_system OR r.is_system) THEN
    -- only the discount limits of a built-in role change (DISC-002)
    IF (r.key, r.is_system, r.permissions, r.name_ar, r.name_en, r.archived_at) IS DISTINCT FROM
       (OLD.key, OLD.is_system, OLD.permissions, OLD.name_ar, OLD.name_en, OLD.archived_at) THEN
      RAISE EXCEPTION 'a built-in role is fixed' USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_system_fixed';
    END IF;
    RETURN NEW;
  END IF;
  -- a custom role
  IF r.key NOT LIKE 'custom-%' OR (TG_OP = 'UPDATE' AND r.key <> OLD.key) THEN
    RAISE EXCEPTION 'a custom role keeps its generated key' USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_custom_key';
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

-- 3. ACCESS-005 for role edits: changing a role's permissions applies to its members on their next request
CREATE OR REPLACE FUNCTION roles_bump_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.permissions IS DISTINCT FROM OLD.permissions THEN
    UPDATE tenant_members SET access_version = access_version + 1 WHERE role_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER roles_bump_access AFTER UPDATE OF permissions ON roles FOR EACH ROW EXECUTE FUNCTION roles_bump_access();

-- 4. An archived role is given to nobody new (members and invitations)
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
DROP INDEX IF EXISTS roles_tenant_name_ar;
-- custom roles stay (members may hold them); only the new columns and checks go
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_name_ar_length, DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS archived_at;
DROP FUNCTION IF EXISTS grantable_permissions();
