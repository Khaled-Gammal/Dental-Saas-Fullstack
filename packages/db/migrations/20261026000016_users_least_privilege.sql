-- migrate:up
-- Phase C, part 5 (SRS SEC-103): the API role can no longer read password hashes or 2FA secrets of every account.
-- `users` has no RLS (a login exists across clinics), so a single injection bug could otherwise dump them all.
-- Sign-in gets the one hash it needs through login_candidate(), which returns a single account per call.
REVOKE SELECT ON users FROM app_user;
GRANT SELECT (id, email, phone, google_sub, full_name, avatar_url, locale, email_verified_at, phone_verified_at,
              platform_role, is_active, last_login_at, created_at, updated_at) ON users TO app_user;

GRANT SELECT ON users TO app_definer;
CREATE OR REPLACE FUNCTION login_candidate(p_email text, p_phone text)
RETURNS TABLE (id uuid, password_hash text, is_active boolean, email text, phone text,
               email_verified_at timestamptz, phone_verified_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.password_hash, u.is_active, u.email::text, u.phone, u.email_verified_at, u.phone_verified_at
  FROM users u
  WHERE u.email = p_email::citext OR (p_phone IS NOT NULL AND u.phone = p_phone)
  ORDER BY (u.email = p_email::citext) DESC
  LIMIT 1
$$;
ALTER FUNCTION login_candidate(text, text) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION login_candidate(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION login_candidate(text, text) TO app_user;

-- migrate:down
DROP FUNCTION IF EXISTS login_candidate(text, text);
REVOKE SELECT ON users FROM app_definer;
GRANT SELECT ON users TO app_user;
