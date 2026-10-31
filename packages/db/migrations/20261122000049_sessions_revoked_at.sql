-- migrate:up
-- Review R11: a password reset revoked the refresh tokens, but an access token already handed out stayed valid until
-- it expired (up to 15 minutes) — for whoever had stolen the password, too. The reset now stamps
-- users.sessions_revoked_at, and member_access_state() (read on every signed-in request) returns it: a token issued
-- before that moment is refused at once.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_revoked_at timestamptz;
GRANT UPDATE (sessions_revoked_at) ON users TO app_user;

DROP FUNCTION IF EXISTS member_access_state(uuid);
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

-- migrate:down
DROP FUNCTION IF EXISTS member_access_state(uuid);
CREATE FUNCTION member_access_state(p_member uuid)
RETURNS TABLE (tenant_id uuid, status text, access_version int, tenant_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.tenant_id, m.status, m.access_version, t.status FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id WHERE m.id = p_member
$$;
ALTER FUNCTION member_access_state(uuid) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION member_access_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_access_state(uuid) TO app_user;
REVOKE UPDATE (sessions_revoked_at) ON users FROM app_user;
ALTER TABLE users DROP COLUMN IF EXISTS sessions_revoked_at;
