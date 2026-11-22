-- migrate:up
-- Schema v4 audit, SEC-02 (docs/database/schema-v3-audit.md): the owner role and a member's own access were guarded by
-- the API alone (staff.service.ts assertAssignable / updateMember / editableRole). The database accepted a member with
-- staff:manage making themselves owner, inviting someone as owner, or widening the role they hold. These guards repeat
-- the same rules for the API role (app_user), so one bug in the staff endpoints cannot become an owner takeover.
-- The finer rule "a non-owner grants only permissions they hold" stays in the API.
--
-- Who acts is app.member_id (TenantDb.run sets it on every signed-in request). Two paths give the owner role with no
-- member in the context, and stay open:
--   * sign-up: provision_tenant() adds the first member of a clinic that has none yet;
--   * accepting an invitation: the invitation for that role and that email was claimed in this same transaction
--     (claimInvitation sets accepted_at = now(), and now() is the transaction's start).
-- Migrations, seeds, the worker and the definer functions (platform, deletion) run as other roles and are not checked,
-- as in roles_guard (0030).

-- the active owner acting in this transaction, if any
CREATE FUNCTION acting_member_is_owner() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM tenant_members m JOIN roles r ON r.id = m.role_id
                  WHERE m.id = current_member_id() AND m.tenant_id = current_tenant_id()
                    AND m.status = 'active' AND r.key = 'owner' AND r.is_system)
$$;
REVOKE EXECUTE ON FUNCTION acting_member_is_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acting_member_is_owner() TO app_user;

CREATE FUNCTION is_owner_role(p_role uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM roles WHERE id = p_role AND key = 'owner' AND is_system)
$$;
REVOKE EXECUTE ON FUNCTION is_owner_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_owner_role(uuid) TO app_user;

-- 1. Members: only an owner gives or takes the owner role, or changes an owner's status or branches; nobody but an
--    owner changes their own role, status or branches.
CREATE FUNCTION tenant_members_owner_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
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
CREATE TRIGGER tenant_members_owner_guard BEFORE INSERT OR UPDATE OF role_id, status, all_branches ON tenant_members
  FOR EACH ROW EXECUTE FUNCTION tenant_members_owner_guard();

-- 2. Invitations: only an owner invites someone as owner (or turns an invitation into one).
CREATE FUNCTION invitations_owner_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user <> 'app_user' THEN RETURN NEW; END IF;
  IF (TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id) AND is_owner_role(NEW.role_id) AND NOT acting_member_is_owner() THEN
    RAISE EXCEPTION 'only an owner invites an owner' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'owner_role_only';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invitations_owner_guard BEFORE INSERT OR UPDATE OF role_id ON invitations
  FOR EACH ROW EXECUTE FUNCTION invitations_owner_guard();

-- 3. Roles: the permissions of a role change only by a signed-in member, and never by a non-owner who holds that role.
CREATE FUNCTION roles_own_role_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
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
CREATE TRIGGER roles_own_role_guard BEFORE UPDATE OF permissions ON roles
  FOR EACH ROW EXECUTE FUNCTION roles_own_role_guard();

-- migrate:down
DROP TRIGGER IF EXISTS roles_own_role_guard ON roles;
DROP FUNCTION IF EXISTS roles_own_role_guard();
DROP TRIGGER IF EXISTS invitations_owner_guard ON invitations;
DROP FUNCTION IF EXISTS invitations_owner_guard();
DROP TRIGGER IF EXISTS tenant_members_owner_guard ON tenant_members;
DROP FUNCTION IF EXISTS tenant_members_owner_guard();
DROP FUNCTION IF EXISTS is_owner_role(uuid);
DROP FUNCTION IF EXISTS acting_member_is_owner();
