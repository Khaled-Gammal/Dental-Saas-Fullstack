-- migrate:up
-- Review R11 (cleanup): two SECURITY DEFINER lookups from the initial schema that nothing calls — invitations are
-- accepted through the staff module's own queries, and no payment provider is wired yet. A definer function the API
-- role may execute but does not need is attack surface (it reads across clinics); a provider integration will add
-- the lookup it needs, with its own checks.
DROP FUNCTION IF EXISTS invitation_by_token(text);
DROP FUNCTION IF EXISTS tenant_for_payment(text, text);

-- migrate:down
CREATE OR REPLACE FUNCTION invitation_by_token(p_token_hash text)
RETURNS TABLE (invitation_id uuid, tenant_id uuid, email citext, phone text, role_id uuid, branch_ids uuid[], expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, tenant_id, email, phone, role_id, branch_ids, expires_at
  FROM invitations
  WHERE token_hash = p_token_hash AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
$$;
CREATE OR REPLACE FUNCTION tenant_for_payment(p_provider text, p_provider_ref text)
RETURNS TABLE (tenant_id uuid, payment_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT tenant_id, id FROM payments WHERE provider = p_provider AND provider_ref = p_provider_ref
$$;
ALTER FUNCTION invitation_by_token(text) OWNER TO app_definer;
ALTER FUNCTION tenant_for_payment(text, text) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION invitation_by_token(text), tenant_for_payment(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invitation_by_token(text), tenant_for_payment(text, text) TO app_user;
