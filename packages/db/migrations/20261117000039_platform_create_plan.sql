-- migrate:up
-- Platform plans page (owner 2026-10-24): the admin adds a plan («خطة جديدة»), not only edits the two seeded ones.
-- Like platform_update_plan(): platform admins only, as app_definer (the API role writes no platform table since 0004),
-- written to the platform audit log. A new plan goes after the others (sort_order), so it shows last on the pricing
-- table. Its code is what the landing page's «اشترك الآن» link carries (#/signup?plan=<code>), so it is a short Latin
-- slug, unique, and never changes. Plans have no English name in the app (Arabic only): name_en repeats name_ar.
GRANT INSERT ON plans TO app_definer;

CREATE OR REPLACE FUNCTION platform_create_plan(p_actor uuid, p_plan jsonb, p_ip inet) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text := lower(btrim(p_plan->>'code'));
  v_name text := btrim(p_plan->>'name_ar');
  v_id   uuid;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  IF v_code IS NULL OR v_code !~ '^[a-z0-9][a-z0-9_-]{1,39}$' THEN
    RAISE EXCEPTION 'plan code is a Latin slug' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_plan_code';
  END IF;
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'plan name is 2 to 60 characters' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_plan_name';
  END IF;
  INSERT INTO plans (code, name_en, name_ar, price_monthly_minor, price_yearly_minor, trial_days, limits, features, is_public, sort_order)
  VALUES (v_code, v_name, v_name, (p_plan->>'price_monthly_minor')::bigint, (p_plan->>'price_yearly_minor')::bigint,
          coalesce((p_plan->>'trial_days')::int, 14), coalesce(p_plan->'limits', '{}'), coalesce(p_plan->'features', '{}'),
          coalesce((p_plan->>'is_public')::boolean, true), (SELECT coalesce(max(sort_order), 0) + 1 FROM plans))
  RETURNING id INTO v_id;
  INSERT INTO platform_audit_log (actor_user_id, action, details, ip) VALUES (p_actor, 'plan.created', jsonb_build_object('plan', v_code, 'values', p_plan), p_ip);
  RETURN v_id;
END $$;
ALTER FUNCTION platform_create_plan(uuid, jsonb, inet) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION platform_create_plan(uuid, jsonb, inet) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_create_plan(uuid, jsonb, inet) TO app_user;

-- migrate:down
DROP FUNCTION IF EXISTS platform_create_plan(uuid, jsonb, inet);
REVOKE INSERT ON plans FROM app_definer;
