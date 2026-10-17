-- migrate:up
-- Phase D3: Arabic-normalised name search, medical-history versions, clinical documents (SRS PATIENT-001/002/004/005,
-- L10N-007). Additive. The trigram index on the normalised name is built CONCURRENTLY in the next migration.

-- ---------------------------------------------------------------------
-- 1. Arabic spelling variants Egyptian staff type interchangeably are one search key:
--    أ إ آ ٱ -> ا ; ة -> ه ; ى -> ي ; ؤ -> و ; ئ -> ي ; diacritics (harakat, superscript alef) and tatweel removed;
--    Latin letters lower-cased; spaces collapsed. IMMUTABLE, so it can back a stored generated column and an index.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ar_normalize(p text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    translate(lower(regexp_replace(coalesce(p, ''), '[ً-ٰٟـ]', '', 'g')), 'أإآٱةىؤئ', 'ااااهيوي'),
    '\s+', ' ', 'g'))
$$;

-- A stored generated column: always in step with full_name, no trigger, no touch of updated_at for existing rows.
-- Adding it rewrites `patients` once under an exclusive lock: seconds at today's size (see database-design.md, D-03).
ALTER TABLE patients ADD COLUMN full_name_norm text GENERATED ALWAYS AS (ar_normalize(full_name)) STORED;

-- ---------------------------------------------------------------------
-- 2. Medical history versions (PATIENT-005): every save keeps a snapshot; append-only for the API role.
-- ---------------------------------------------------------------------
CREATE TABLE patient_medical_history_versions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id   uuid NOT NULL,
  allergies    text[] NOT NULL,
  conditions   text[] NOT NULL,
  medications  text[] NOT NULL,
  is_pregnant  boolean,
  is_smoker    boolean,
  notes        text,
  saved_by     uuid,
  saved_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, saved_by) REFERENCES tenant_members(tenant_id, id)
);
CREATE INDEX patient_medical_history_versions_patient ON patient_medical_history_versions (tenant_id, patient_id, saved_at DESC);
ALTER TABLE patient_medical_history_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_medical_history_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patient_medical_history_versions
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
REVOKE UPDATE, DELETE ON patient_medical_history_versions FROM app_user;

CREATE OR REPLACE FUNCTION patient_medical_history_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.allergies, NEW.conditions, NEW.medications, NEW.is_pregnant, NEW.is_smoker, NEW.notes)
       IS NOT DISTINCT FROM (OLD.allergies, OLD.conditions, OLD.medications, OLD.is_pregnant, OLD.is_smoker, OLD.notes) THEN
    RETURN NULL; -- a save that changed nothing is not a new version
  END IF;
  INSERT INTO patient_medical_history_versions (tenant_id, patient_id, allergies, conditions, medications, is_pregnant, is_smoker, notes, saved_by, saved_at)
  VALUES (NEW.tenant_id, NEW.patient_id, NEW.allergies, NEW.conditions, NEW.medications, NEW.is_pregnant, NEW.is_smoker, NEW.notes, NEW.updated_by, NEW.updated_at);
  RETURN NULL;
END $$;
CREATE TRIGGER patient_medical_history_version AFTER INSERT OR UPDATE ON patient_medical_history
  FOR EACH ROW EXECUTE FUNCTION patient_medical_history_version();

-- the current history of existing patients becomes their first version
INSERT INTO patient_medical_history_versions (tenant_id, patient_id, allergies, conditions, medications, is_pregnant, is_smoker, notes, saved_by, saved_at)
SELECT h.tenant_id, h.patient_id, h.allergies, h.conditions, h.medications, h.is_pregnant, h.is_smoker, h.notes,
       CASE WHEN EXISTS (SELECT 1 FROM tenant_members m WHERE m.tenant_id = h.tenant_id AND m.id = h.updated_by) THEN h.updated_by END, h.updated_at
FROM patient_medical_history h;

-- ---------------------------------------------------------------------
-- 3. Clinical documents (PATIENT-004): never hard-deleted, archived with a reason; who archived it is a member.
--    X-rays, clinical photos and consents are already forced private by the files CHECK; documents are made private too.
-- ---------------------------------------------------------------------
ALTER TABLE patient_files
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid,
  ADD COLUMN archive_reason text CHECK (char_length(archive_reason) BETWEEN 3 AND 200),
  ADD CONSTRAINT patient_files_archived_by_member_fk FOREIGN KEY (tenant_id, archived_by) REFERENCES tenant_members(tenant_id, id),
  ADD CONSTRAINT patient_files_archive_complete CHECK ((archived_at IS NULL) = (archive_reason IS NULL)),
  ADD CONSTRAINT patient_files_caption_length CHECK (char_length(caption) <= 200);
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_check;  -- the 0001 CHECK, re-declared below with documents included
ALTER TABLE files ADD CONSTRAINT files_clinical_private
  CHECK (NOT (kind IN ('xray', 'clinical_photo', 'consent', 'document') AND is_private = false)) NOT VALID;
ALTER TABLE files VALIDATE CONSTRAINT files_clinical_private;

-- migrate:down
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_clinical_private;
ALTER TABLE files ADD CONSTRAINT files_check CHECK (NOT (kind IN ('xray','clinical_photo','consent') AND is_private = false));
ALTER TABLE patient_files DROP CONSTRAINT IF EXISTS patient_files_caption_length,
  DROP CONSTRAINT IF EXISTS patient_files_archive_complete, DROP CONSTRAINT IF EXISTS patient_files_archived_by_member_fk,
  DROP COLUMN IF EXISTS archive_reason, DROP COLUMN IF EXISTS archived_by, DROP COLUMN IF EXISTS archived_at;
DROP TRIGGER IF EXISTS patient_medical_history_version ON patient_medical_history;
DROP FUNCTION IF EXISTS patient_medical_history_version();
DROP TABLE IF EXISTS patient_medical_history_versions;
ALTER TABLE patients DROP COLUMN IF EXISTS full_name_norm;
DROP FUNCTION IF EXISTS ar_normalize(text);
