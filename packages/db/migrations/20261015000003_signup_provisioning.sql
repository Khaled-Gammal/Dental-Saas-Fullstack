-- migrate:up
-- Week 2: self-service sign-up. A doctor signs up and gets a complete, working clinic in one transaction.

-- ---------------------------------------------------------------------
-- Platform defaults every environment needs (dev seed reuses the same ids)
-- ---------------------------------------------------------------------
INSERT INTO plans (id, code, name_en, name_ar, price_monthly_minor, price_yearly_minor, currency, trial_days, limits, features, sort_order) VALUES
 ('00000000-0000-0000-0000-00000000a001','basic','Basic','الأساسية', 50000, 500000,'EGP',14,
  '{"branches":1,"staff":5,"patients":2000,"sms_credits":200,"storage_mb":2048}','{"custom_domain":false,"online_payments":false}',1),
 ('00000000-0000-0000-0000-00000000a002','pro','Pro','الاحترافية', 120000, 1200000,'EGP',14,
  '{"branches":5,"staff":30,"patients":50000,"sms_credits":1000,"storage_mb":20480}','{"custom_domain":true,"online_payments":true,"remove_badge":true}',2)
ON CONFLICT DO NOTHING;

INSERT INTO templates (id, code, name, sections_schema, default_theme) VALUES
 ('00000000-0000-0000-0000-00000000b001','smile','Smile','{}','{"primary":"#0E7C86","font_ar":"Cairo","font_en":"Inter"}')
ON CONFLICT DO NOTHING;

INSERT INTO service_catalog (code, category, name_en, name_ar, default_duration_minutes, sort_order) VALUES
 ('consultation','general','Consultation','كشف',20,1),
 ('scaling','preventive','Scaling & polishing','تنظيف الجير والتلميع',45,2),
 ('filling_composite','restorative','Composite filling','حشو تجميلي',45,3),
 ('rct','endodontic','Root canal treatment','علاج عصب',90,4),
 ('extraction','surgery','Tooth extraction','خلع ضرس',30,5),
 ('crown_zirconia','prosthodontic','Zirconia crown','تركيبة زيركون',60,6),
 ('implant','surgery','Dental implant','زراعة أسنان',90,7),
 ('braces_consult','orthodontic','Braces consultation','استشارة تقويم',30,8),
 ('whitening','cosmetic','Teeth whitening','تبييض الأسنان',60,9)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- Default permissions per seeded role (SRS 2.2). Owners can edit them later.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION default_role_permissions(p_role text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN ARRAY['*']
    WHEN 'doctor' THEN ARRAY['branches:read','patients:read','patients:write','clinical:read','clinical:write',
      'appointments:read','appointments:write:own','treatments:write:own','invoices:read:own','reports:read:own']
    WHEN 'receptionist' THEN ARRAY['branches:read','patients:read','patients:write','clinical:read',
      'appointments:read','appointments:write','appointments:override','invoices:read','invoices:write','payments:write',
      'reports:read:daily']
    WHEN 'assistant' THEN ARRAY['branches:read','patients:read','clinical:read','appointments:read','appointments:write',
      'inventory:read','inventory:write']
    WHEN 'accountant' THEN ARRAY['branches:read','patients:read','appointments:read','invoices:read','invoices:write',
      'payments:write','expenses:write','inventory:read','reports:read','subscription:read']
    ELSE ARRAY[]::text[] END
$$;

-- Words that can never be a clinic subdomain (platform hosts and look-alikes)
CREATE OR REPLACE FUNCTION is_reserved_slug(p_slug text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(p_slug) = ANY (ARRAY['www','app','api','admin','dashboard','mail','smtp','static','assets','cdn','docs',
    'help','support','status','blog','billing','pay','auth','login','signup','register','account','demo','test','dev',
    'staging','internal','root','system'])
$$;

-- Sign-up form: "is this subdomain free?" without seeing other clinics (runs as app_definer)
CREATE OR REPLACE FUNCTION slug_available(p_slug text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_slug ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$'
     AND NOT is_reserved_slug(p_slug)
     AND NOT EXISTS (SELECT 1 FROM tenants WHERE slug = p_slug::citext)
$$;
ALTER FUNCTION slug_available(text) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION slug_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION slug_available(text) TO app_user;

-- ---------------------------------------------------------------------
-- provision_tenant: builds a complete clinic for a new owner.
-- Runs as app_user INSIDE the sign-up transaction, after
--   select set_config('app.tenant_id', <new uuid>, true)
-- so every row passes the same RLS checks as normal traffic.
-- ---------------------------------------------------------------------
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

REVOKE EXECUTE ON FUNCTION provision_tenant(text, text, text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_tenant(text, text, text, uuid, text, text, text) TO app_user;

-- migrate:down
DROP FUNCTION IF EXISTS provision_tenant(text, text, text, uuid, text, text, text);
DROP FUNCTION IF EXISTS slug_available(text);
DROP FUNCTION IF EXISTS is_reserved_slug(text);
DROP FUNCTION IF EXISTS default_role_permissions(text);
