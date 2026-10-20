-- migrate:up
-- Phase H7 (LND-04): the landing page's contact form for clinics that want a call. Anyone may send one (through the
-- API, throttled); only platform admins read them and move them along (new → contacted → converted / lost), in the
-- platform panel. A lead is a stranger's name and phone number: the API role may add one but never read them back.
-- Owner, 2026-10-20: «اشترك الآن» on the pricing table opens sign-up with a plan and a billing cycle; the new clinic is
-- recorded here as a subscription request (kind 'subscribe', linked to the clinic) for the admin to collect payment and
-- activate it. The clinic itself starts on the usual trial.

ALTER TABLE leads
  ADD COLUMN kind          text NOT NULL DEFAULT 'call' CONSTRAINT leads_kind CHECK (kind IN ('call', 'subscribe')),
  ADD COLUMN plan_id       uuid REFERENCES plans(id) ON DELETE SET NULL,  -- the plan they asked about, if any
  ADD COLUMN billing_cycle text CONSTRAINT leads_billing_cycle CHECK (billing_cycle IN ('monthly', 'yearly')),
  ADD COLUMN clinic_id     uuid REFERENCES tenants(id) ON DELETE SET NULL, -- a subscription request: the clinic just created
  ADD COLUMN ip          inet,
  ADD COLUMN user_agent  text,
  ADD COLUMN updated_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_by  uuid REFERENCES users(id),
  ADD CONSTRAINT leads_full_name CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
  ADD CONSTRAINT leads_phone CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT leads_email CHECK (email IS NULL OR char_length(email) <= 254),
  ADD CONSTRAINT leads_clinic_name CHECK (clinic_name IS NULL OR char_length(clinic_name) <= 150),
  ADD CONSTRAINT leads_city CHECK (city IS NULL OR char_length(city) <= 80),
  ADD CONSTRAINT leads_message CHECK (message IS NULL OR char_length(message) <= 2000),
  ADD CONSTRAINT leads_source CHECK (source IS NULL OR char_length(source) <= 100),
  ADD CONSTRAINT leads_user_agent CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  -- the clinic link may be cleared later (the clinic deleted); the cycle stays
  ADD CONSTRAINT leads_subscribe CHECK (CASE kind WHEN 'subscribe' THEN billing_cycle IS NOT NULL ELSE billing_cycle IS NULL AND clinic_id IS NULL END);
CREATE INDEX leads_created ON leads (created_at DESC);

-- the API inserts the visitor's fields only (status, dates and who handled it are not theirs to set) and reads nothing
REVOKE ALL ON leads FROM app_user;
GRANT INSERT (kind, full_name, phone, email, clinic_name, city, message, source, plan_id, billing_cycle, clinic_id, ip, user_agent) ON leads TO app_user;
GRANT SELECT, UPDATE ON leads TO app_definer;

-- the panel's list: newest first, the plan's name with it
CREATE OR REPLACE FUNCTION platform_leads(p_actor uuid)
RETURNS TABLE (id uuid, kind text, full_name text, phone text, email text, clinic_name text, city text, message text, source text,
               status text, billing_cycle text, clinic_id uuid, plan_code text, plan_name_ar text, created_at timestamptz, updated_at timestamptz, updated_by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN QUERY
  SELECT l.id, l.kind, l.full_name, l.phone, l.email::text, l.clinic_name, l.city, l.message, l.source, l.status, l.billing_cycle,
         l.clinic_id, p.code, p.name_ar,
         l.created_at, l.updated_at, u.full_name
  FROM leads l LEFT JOIN plans p ON p.id = l.plan_id LEFT JOIN users u ON u.id = l.updated_by
  ORDER BY l.created_at DESC
  LIMIT 500;
END $$;
ALTER FUNCTION platform_leads(uuid) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION platform_leads(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_leads(uuid) TO app_user;

-- moving a lead along; the platform audit log names who did it
CREATE OR REPLACE FUNCTION platform_set_lead_status(p_actor uuid, p_lead uuid, p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old text;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  SELECT status INTO v_old FROM leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead not found' USING ERRCODE = 'no_data_found', CONSTRAINT = 'lead_not_found';
  END IF;
  IF v_old = p_status THEN RETURN; END IF;
  UPDATE leads SET status = p_status, updated_at = now(), updated_by = p_actor WHERE id = p_lead;
  INSERT INTO platform_audit_log (actor_user_id, action, details)
  VALUES (p_actor, 'lead.status', jsonb_build_object('lead_id', p_lead, 'from', v_old, 'to', p_status));
END $$;
ALTER FUNCTION platform_set_lead_status(uuid, uuid, text) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION platform_set_lead_status(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_set_lead_status(uuid, uuid, text) TO app_user;

-- migrate:down
DROP FUNCTION IF EXISTS platform_set_lead_status(uuid, uuid, text);
DROP FUNCTION IF EXISTS platform_leads(uuid);
REVOKE SELECT, UPDATE ON leads FROM app_definer;
REVOKE ALL ON leads FROM app_user;
GRANT SELECT, INSERT ON leads TO app_user;
DROP INDEX IF EXISTS leads_created;
ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_subscribe, DROP CONSTRAINT IF EXISTS leads_user_agent, DROP CONSTRAINT IF EXISTS leads_source, DROP CONSTRAINT IF EXISTS leads_message,
  DROP CONSTRAINT IF EXISTS leads_city, DROP CONSTRAINT IF EXISTS leads_clinic_name, DROP CONSTRAINT IF EXISTS leads_email,
  DROP CONSTRAINT IF EXISTS leads_phone, DROP CONSTRAINT IF EXISTS leads_full_name,
  DROP COLUMN IF EXISTS updated_by, DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS user_agent, DROP COLUMN IF EXISTS ip,
  DROP COLUMN IF EXISTS clinic_id, DROP COLUMN IF EXISTS billing_cycle, DROP COLUMN IF EXISTS plan_id, DROP COLUMN IF EXISTS kind;
