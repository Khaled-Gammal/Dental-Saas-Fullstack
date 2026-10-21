-- migrate:up
-- Platform plans page (2026-10-21): "N clinics on this plan" was counted by the API as app_user, where row-level
-- security hides every subscription (no clinic is selected in the panel), so every plan showed 0. Counted here instead,
-- like platform_clinics(): platform admins only, as app_definer, numbers only (no clinic data).
CREATE OR REPLACE FUNCTION platform_plan_clinics(p_actor uuid)
RETURNS TABLE (plan_id uuid, clinics int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN QUERY
  SELECT s.plan_id, count(*)::int FROM subscriptions s WHERE s.status <> 'cancelled' GROUP BY s.plan_id;
END $$;
ALTER FUNCTION platform_plan_clinics(uuid) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION platform_plan_clinics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_plan_clinics(uuid) TO app_user;

-- migrate:down
DROP FUNCTION IF EXISTS platform_plan_clinics(uuid);
