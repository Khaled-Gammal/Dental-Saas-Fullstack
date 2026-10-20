-- migrate:up
-- Phase H9 (DSH-16, NFR-16; owner 2026-10-20): patient consents.
-- * The clinic writes its consent texts (one per kind of treatment), each save a new version, old versions kept: a
--   signed consent always points at the exact version signed. New clinics get starter drafts; a draft cannot be signed
--   until the owner saves it as reviewed.
-- * The patient (or a child's guardian) signs on the clinic's tablet or phone; or staff record a paper form with a
--   photo/scan of it. The text signed is copied here by the database, never sent by the client.
-- * A service can need a consent: the visit warns when it is missing (never blocks).
-- * A signed consent is never changed or deleted; it can be withdrawn, with a reason.

-- ---------- consent texts ----------
ALTER TABLE consent_templates
  ADD COLUMN reviewed_at  timestamptz,
  ADD COLUMN reviewed_by  uuid,
  ADD COLUMN created_by   uuid,
  ADD CONSTRAINT consent_templates_key_format CHECK (key ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  ADD CONSTRAINT consent_templates_title CHECK (title_ar IS NOT NULL AND char_length(btrim(title_ar)) BETWEEN 2 AND 150),
  ADD CONSTRAINT consent_templates_body CHECK (body_ar IS NOT NULL AND char_length(btrim(body_ar)) BETWEEN 20 AND 20000),
  ADD CONSTRAINT consent_templates_review CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL)),
  ADD FOREIGN KEY (tenant_id, reviewed_by) REFERENCES tenant_members(tenant_id, id) DEFERRABLE INITIALLY IMMEDIATE,
  ADD FOREIGN KEY (tenant_id, created_by) REFERENCES tenant_members(tenant_id, id) DEFERRABLE INITIALLY IMMEDIATE;

-- a version is never edited: the API may only archive or bring back a text (is_active), never delete it
CREATE OR REPLACE FUNCTION consent_templates_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'app_user' THEN RETURN coalesce(NEW, OLD); END IF; -- migrations, seeds, the clinic's erase
  IF (NEW.key, NEW.version, NEW.title_ar, NEW.body_ar, NEW.reviewed_at, NEW.reviewed_by, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.key, OLD.version, OLD.title_ar, OLD.body_ar, OLD.reviewed_at, OLD.reviewed_by, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a consent text is never edited: save a new version' USING ERRCODE = 'check_violation', CONSTRAINT = 'consent_templates_locked';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER consent_templates_guard BEFORE UPDATE ON consent_templates FOR EACH ROW EXECUTE FUNCTION consent_templates_guard();
REVOKE DELETE ON consent_templates FROM app_user;

-- ---------- services that need a consent ----------
ALTER TABLE services ADD COLUMN consent_key text CONSTRAINT services_consent_key CHECK (consent_key ~ '^[a-z0-9][a-z0-9_-]{1,39}$');

-- ---------- signed consents ----------
ALTER TABLE patient_consents
  ALTER COLUMN signature_file_id DROP NOT NULL,
  ADD COLUMN method         text NOT NULL DEFAULT 'screen' CONSTRAINT patient_consents_method_kind CHECK (method IN ('screen', 'paper')),
  ADD COLUMN paper_file_id  uuid,
  ADD COLUMN title_snapshot text,
  ADD COLUMN recorded_by    uuid,
  ADD COLUMN revoked_by     uuid,
  ADD COLUMN revoke_reason  text,
  ADD CONSTRAINT patient_consents_method CHECK (
    (method = 'screen' AND signature_file_id IS NOT NULL AND paper_file_id IS NULL)
    OR (method = 'paper' AND paper_file_id IS NOT NULL AND signature_file_id IS NULL)),
  ADD CONSTRAINT patient_consents_signer CHECK (char_length(btrim(signer_name)) BETWEEN 2 AND 120),
  ADD CONSTRAINT patient_consents_revoked CHECK ((revoked_at IS NULL) = (revoked_by IS NULL) AND (revoked_at IS NULL) = (revoke_reason IS NULL)),
  ADD CONSTRAINT patient_consents_revoke_reason CHECK (revoke_reason IS NULL OR char_length(btrim(revoke_reason)) BETWEEN 3 AND 300),
  ADD FOREIGN KEY (tenant_id, paper_file_id) REFERENCES files(tenant_id, id) DEFERRABLE INITIALLY IMMEDIATE,
  ADD FOREIGN KEY (tenant_id, recorded_by) REFERENCES tenant_members(tenant_id, id) DEFERRABLE INITIALLY IMMEDIATE,
  ADD FOREIGN KEY (tenant_id, revoked_by) REFERENCES tenant_members(tenant_id, id) DEFERRABLE INITIALLY IMMEDIATE;
-- the patient's own guardian relations (a sibling may be a guardian) are accepted as signers too
ALTER TABLE patient_consents DROP CONSTRAINT patient_consents_signer_relation_check,
  ADD CONSTRAINT patient_consents_signer_relation_check
  CHECK (signer_relation IN ('self', 'father', 'mother', 'sibling', 'spouse', 'legal_guardian', 'other'));

-- The database, not the client, decides what was signed: the reviewed, active version's text; the signature or scan is
-- a private consent file of this clinic; a visit is this patient's. Afterwards a consent can only be withdrawn.
CREATE OR REPLACE FUNCTION patient_consents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_t record; v_file uuid;
BEGIN
  IF current_user <> 'app_user' THEN RETURN coalesce(NEW, OLD); END IF; -- migrations, seeds, patient merge, the erase
  IF TG_OP = 'INSERT' THEN
    SELECT title_ar, body_ar, reviewed_at, is_active INTO v_t FROM consent_templates WHERE id = NEW.template_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'consent text not found' USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'consent_template_missing';
    END IF;
    IF v_t.reviewed_at IS NULL THEN
      RAISE EXCEPTION 'a draft is reviewed before it is signed' USING ERRCODE = 'check_violation', CONSTRAINT = 'consent_template_draft';
    END IF;
    IF NOT v_t.is_active THEN
      RAISE EXCEPTION 'this consent text is archived' USING ERRCODE = 'check_violation', CONSTRAINT = 'consent_template_archived';
    END IF;
    IF EXISTS (SELECT 1 FROM consent_templates n JOIN consent_templates t ON t.id = NEW.template_id
               WHERE n.key = t.key AND n.version > t.version) THEN
      RAISE EXCEPTION 'a newer version of this consent text exists' USING ERRCODE = 'check_violation', CONSTRAINT = 'consent_template_outdated';
    END IF;
    v_file := coalesce(NEW.signature_file_id, NEW.paper_file_id);
    IF NOT EXISTS (SELECT 1 FROM files WHERE id = v_file AND kind = 'consent' AND is_private) THEN
      RAISE EXCEPTION 'the signature is a private consent file' USING ERRCODE = 'check_violation', CONSTRAINT = 'patient_consents_file';
    END IF;
    IF NEW.visit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM visits WHERE id = NEW.visit_id AND patient_id = NEW.patient_id) THEN
      RAISE EXCEPTION 'the visit is another patient''s' USING ERRCODE = 'check_violation', CONSTRAINT = 'patient_consents_visit';
    END IF;
    NEW.title_snapshot := v_t.title_ar;
    NEW.body_snapshot := v_t.body_ar;
    NEW.locale := 'ar';
    NEW.signed_at := now();
    NEW.revoked_at := NULL; NEW.revoked_by := NULL; NEW.revoke_reason := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a signed consent is never deleted' USING ERRCODE = 'check_violation', CONSTRAINT = 'patient_consents_locked';
  END IF;
  -- UPDATE: withdrawing it, once, is the only change
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
     OR (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.template_id, NEW.visit_id, NEW.treatment_plan_id, NEW.locale, NEW.body_snapshot, NEW.title_snapshot,
         NEW.signer_name, NEW.signer_relation, NEW.signature_file_id, NEW.paper_file_id, NEW.method, NEW.witness_member_id, NEW.recorded_by,
         NEW.signed_at, NEW.signed_ip)
        IS DISTINCT FROM
        (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.template_id, OLD.visit_id, OLD.treatment_plan_id, OLD.locale, OLD.body_snapshot, OLD.title_snapshot,
         OLD.signer_name, OLD.signer_relation, OLD.signature_file_id, OLD.paper_file_id, OLD.method, OLD.witness_member_id, OLD.recorded_by,
         OLD.signed_at, OLD.signed_ip) THEN
    RAISE EXCEPTION 'a signed consent is never changed; it can be withdrawn once' USING ERRCODE = 'check_violation', CONSTRAINT = 'patient_consents_locked';
  END IF;
  NEW.revoked_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER patient_consents_guard BEFORE INSERT OR UPDATE OR DELETE ON patient_consents FOR EACH ROW EXECUTE FUNCTION patient_consents_guard();
REVOKE DELETE ON patient_consents FROM app_user;

-- ---------- starter drafts (owner's choice: drafts, reviewed before use) ----------
-- Plain, general wording for the clinic to adapt; they are drafts (reviewed_at NULL) and cannot be signed as they are.
CREATE OR REPLACE FUNCTION seed_consent_drafts(p_tenant uuid) RETURNS int
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  IF EXISTS (SELECT 1 FROM consent_templates WHERE tenant_id = p_tenant) THEN RETURN 0; END IF;
  INSERT INTO consent_templates (tenant_id, key, version, title_ar, body_ar)
  SELECT p_tenant, d.key, 1, d.title, d.body FROM (VALUES
    ('general', 'موافقة على الكشف والعلاج',
     E'أوافق على أن يقوم طبيب العيادة بفحص أسناني وفمي، وعلى إجراء الأشعة اللازمة للتشخيص، وعلى العلاج الذي يشرحه لي الطبيب.\n\n'
     || E'شرح لي الطبيب حالتي والعلاج المقترح والبدائل المتاحة، وأُتيحت لي فرصة السؤال وأُجيب عن أسئلتي.\n\n'
     || E'أقررت للطبيب بحالتي الصحية والأدوية التي أتناولها والحساسية التي أعرفها، وأتعهد بإبلاغه بأي تغيير.\n\n'
     || 'أعلم أن لي الحق في التوقف عن العلاج في أي وقت.'),
    ('extraction', 'موافقة على خلع سن',
     E'أوافق على خلع السن/الأسنان التي حددها الطبيب، بعد أن شرح لي سبب الخلع والبدائل المتاحة.\n\n'
     || E'أعلم أن من الآثار المحتملة بعد الخلع: ألمًا أو تورمًا أو نزيفًا بسيطًا، وقد يحدث التهاب في مكان الخلع، وفي حالات قليلة تنميل مؤقت أو دائم في الشفة أو اللسان.\n\n'
     || 'أتعهد باتباع تعليمات الطبيب بعد الخلع وبالعودة إلى العيادة عند حدوث أي مضاعفات.'),
    ('anesthesia', 'موافقة على التخدير الموضعي',
     E'أوافق على استخدام التخدير الموضعي أثناء العلاج.\n\n'
     || E'أعلم أن التخدير قد يسبب تنميلًا مؤقتًا، ونادرًا: ألمًا أو كدمة في مكان الحقن، أو خفقانًا، أو حساسية من المخدر.\n\n'
     || 'أقررت للطبيب بأي حساسية أو أمراض أعرفها (مثل أمراض القلب أو الضغط أو السكر) أو حمل.'),
    ('implant', 'موافقة على زراعة الأسنان',
     E'أوافق على إجراء زراعة الأسنان التي شرحها لي الطبيب، بمراحلها ومدتها وتكلفتها التقريبية.\n\n'
     || E'أعلم أن نجاح الزراعة يعتمد على حالة العظم والصحة العامة والعناية بالفم، وأنها قد لا تلتحم بالعظم في بعض الحالات فتحتاج إلى إعادة.\n\n'
     || E'أعلم أن من الآثار المحتملة: ألمًا أو تورمًا أو كدمة، وقد يحدث التهاب، ونادرًا تنميل في الشفة أو الذقن.\n\n'
     || 'أتعهد باتباع التعليمات وحضور مواعيد المتابعة، وأعلم أن التدخين يقلل فرص النجاح.')
  ) AS d(key, title, body);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- the clinics that exist already get the drafts too
SELECT seed_consent_drafts(id) FROM tenants;

-- sign-up: as in 0030, plus the starter consent drafts
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

  -- the owner holds every permission; the owner creates the clinic's other roles (H4)
  INSERT INTO roles (tenant_id, key, name_en, name_ar, is_system, permissions)
  VALUES (v_tenant, 'owner', 'Owner', 'المالك', true, ARRAY['*']);

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

  -- H9: starter consent drafts, reviewed by the owner before use
  PERFORM seed_consent_drafts(v_tenant);

  INSERT INTO audit_log (tenant_id, actor_type, actor_user_id, action, entity_type, entity_id)
  VALUES (v_tenant, 'member', p_owner_user, 'tenant.signup', 'tenant', v_tenant);

  RETURN QUERY SELECT v_tenant, v_member, v_branch, v_host;
END $$;

-- migrate:down
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

  -- the owner holds every permission; the owner creates the clinic's other roles (H4)
  INSERT INTO roles (tenant_id, key, name_en, name_ar, is_system, permissions)
  VALUES (v_tenant, 'owner', 'Owner', 'المالك', true, ARRAY['*']);

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
DROP FUNCTION IF EXISTS seed_consent_drafts(uuid);
GRANT DELETE ON patient_consents, consent_templates TO app_user;
DROP TRIGGER IF EXISTS patient_consents_guard ON patient_consents;
DROP FUNCTION IF EXISTS patient_consents_guard();
ALTER TABLE patient_consents DROP CONSTRAINT patient_consents_signer_relation_check,
  ADD CONSTRAINT patient_consents_signer_relation_check CHECK (signer_relation IN ('self','father','mother','spouse','legal_guardian','other'));
DELETE FROM patient_consents WHERE method = 'paper';
ALTER TABLE patient_consents
  DROP CONSTRAINT IF EXISTS patient_consents_revoke_reason, DROP CONSTRAINT IF EXISTS patient_consents_revoked,
  DROP CONSTRAINT IF EXISTS patient_consents_signer, DROP CONSTRAINT IF EXISTS patient_consents_method,
  DROP COLUMN IF EXISTS revoke_reason, DROP COLUMN IF EXISTS revoked_by, DROP COLUMN IF EXISTS recorded_by,
  DROP COLUMN IF EXISTS title_snapshot, DROP COLUMN IF EXISTS paper_file_id, DROP COLUMN IF EXISTS method,
  ALTER COLUMN signature_file_id SET NOT NULL;
ALTER TABLE services DROP COLUMN IF EXISTS consent_key;
DROP TRIGGER IF EXISTS consent_templates_guard ON consent_templates;
DROP FUNCTION IF EXISTS consent_templates_guard();
ALTER TABLE consent_templates
  DROP CONSTRAINT IF EXISTS consent_templates_review, DROP CONSTRAINT IF EXISTS consent_templates_body,
  DROP CONSTRAINT IF EXISTS consent_templates_title, DROP CONSTRAINT IF EXISTS consent_templates_key_format,
  DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS reviewed_by, DROP COLUMN IF EXISTS reviewed_at;
