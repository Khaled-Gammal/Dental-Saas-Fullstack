-- migrate:up
-- Schema v4 audit, SEC-01 / SEC-06 (docs/database/schema-v3-audit.md).
--
-- SEC-01: request_clinic_deletion(p_user, p_tenant) runs as app_definer (BYPASSRLS) and believed both arguments: any
-- session of the clinic API role could close any clinic, given its owner's id (the class 0062 fixed for platform_*()).
-- It now also requires that the clinic is the request's own (app.tenant_id) and the owner is the signed-in user
-- (app.user_id); the API calls it inside the request's clinic transaction (clinic-data.repository.ts). Same message and
-- constraint name as before, so the API's error mapping is unchanged.
--
-- SEC-06: member_access_state() (read on every signed-in request) did not say whether the account itself is still
-- active, so a deactivated account kept working until its access token expired. It now returns user_active; the API
-- guard refuses false. The columns before it are unchanged, so an API that does not read it yet keeps working.

CREATE OR REPLACE FUNCTION request_clinic_deletion(p_user uuid, p_tenant uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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

DROP FUNCTION member_access_state(uuid);
CREATE FUNCTION member_access_state(p_member uuid)
RETURNS TABLE (tenant_id uuid, status text, access_version int, tenant_status text, sessions_revoked_at timestamptz, user_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.tenant_id, m.status, m.access_version, t.status, u.sessions_revoked_at, u.is_active
  FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id JOIN users u ON u.id = m.user_id
  WHERE m.id = p_member
$$;
ALTER FUNCTION member_access_state(uuid) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION member_access_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_access_state(uuid) TO app_user;

-- migrate:down
DROP FUNCTION member_access_state(uuid);
CREATE FUNCTION member_access_state(p_member uuid)
RETURNS TABLE (tenant_id uuid, status text, access_version int, tenant_status text, sessions_revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.tenant_id, m.status, m.access_version, t.status, u.sessions_revoked_at
  FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id JOIN users u ON u.id = m.user_id
  WHERE m.id = p_member
$$;
ALTER FUNCTION member_access_state(uuid) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION member_access_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_access_state(uuid) TO app_user;

CREATE OR REPLACE FUNCTION request_clinic_deletion(p_user uuid, p_tenant uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text; v_after timestamptz := now() + interval '90 days';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_members m JOIN roles r ON r.id = m.role_id
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
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (NULL, 'tenant.deletion_requested', p_tenant, jsonb_build_object('requested_by', p_user, 'delete_after', v_after));
  RETURN v_after;
END $$;
