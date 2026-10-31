-- migrate:up
-- Phase 2C-2 (owner 2026-10-31): before/after cases on the clinic website. gallery_items has had the 'before_after'
-- type, its "before" image and a consent flag since the start (a published case needs consent: initial schema); this
-- records who confirmed the patient's consent and when, and keeps cases simple: clinic-wide, never "featured" (that is
-- the photos' one-per-scope highlight), and two different images.
--
-- A case's images are patient images: their own file kind ('case'), used by that one case only and never as a photo,
-- so withdrawing the consent or deleting the case takes them off the site (the API serves them uncached).

ALTER TABLE files DROP CONSTRAINT files_kind_check;
ALTER TABLE files ADD CONSTRAINT files_kind_check
  CHECK (kind IN ('logo', 'image', 'gallery', 'case', 'xray', 'clinical_photo', 'consent', 'document', 'invoice_pdf', 'other'));
-- an uploaded case image never attached (a form left without saving) is purged like the other website images
CREATE OR REPLACE FUNCTION purge_orphan_images(p_age interval DEFAULT interval '1 day')
RETURNS TABLE (tenant_id uuid, id uuid, variant_widths int[])
LANGUAGE sql AS $$
  DELETE FROM files f
  WHERE f.kind IN ('gallery', 'logo', 'image', 'case') AND f.created_at < now() - p_age AND NOT file_in_use(f.id)
  RETURNING f.tenant_id, f.id, f.variant_widths
$$;

ALTER TABLE gallery_items
  ADD COLUMN consent_confirmed_at timestamptz,
  ADD COLUMN consent_confirmed_by uuid,
  ADD CONSTRAINT gallery_items_consent_by_fk FOREIGN KEY (tenant_id, consent_confirmed_by) REFERENCES tenant_members(tenant_id, id)
    DEFERRABLE INITIALLY IMMEDIATE,
  -- consent given is consent recorded: when and by whom
  ADD CONSTRAINT gallery_items_consent_recorded CHECK (NOT consent_confirmed OR (consent_confirmed_at IS NOT NULL AND consent_confirmed_by IS NOT NULL)),
  ADD CONSTRAINT gallery_items_case_images CHECK (type <> 'before_after' OR before_file_id IS DISTINCT FROM image_file_id),
  ADD CONSTRAINT gallery_items_case_clinic_wide CHECK (type = 'photo' OR branch_id IS NULL),
  ADD CONSTRAINT gallery_items_case_not_featured CHECK (type = 'photo' OR NOT is_featured);
CREATE INDEX gallery_items_type_order ON gallery_items (tenant_id, type, sort_order, id);

-- photos use website images; a case uses two case images that no other row uses
CREATE FUNCTION gallery_items_files_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'photo' THEN
    IF EXISTS (SELECT 1 FROM files WHERE id = NEW.image_file_id AND kind = 'case') THEN
      RAISE EXCEPTION 'a case image is not a photo' USING ERRCODE = 'check_violation', CONSTRAINT = 'gallery_items_case_files';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM files WHERE id IN (NEW.image_file_id, NEW.before_file_id) AND kind <> 'case') THEN
      RAISE EXCEPTION 'a case shows case images' USING ERRCODE = 'check_violation', CONSTRAINT = 'gallery_items_case_files';
    END IF;
    IF EXISTS (SELECT 1 FROM gallery_items g WHERE g.id <> NEW.id
                AND (g.image_file_id IN (NEW.image_file_id, NEW.before_file_id) OR g.before_file_id IN (NEW.image_file_id, NEW.before_file_id))) THEN
      RAISE EXCEPTION 'a case image belongs to one case' USING ERRCODE = 'check_violation', CONSTRAINT = 'gallery_items_case_files';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gallery_items_files_guard BEFORE INSERT OR UPDATE OF type, image_file_id, before_file_id ON gallery_items
  FOR EACH ROW EXECUTE FUNCTION gallery_items_files_guard();

-- The confirming member is the one acting in the transaction (app.member_id), never a value the client sends: a
-- confirmation stamps it, a withdrawal clears it (a published case cannot lose its consent: the API unpublishes it in
-- the same change, and the initial schema's CHECK refuses a published case without consent).
CREATE FUNCTION gallery_items_consent_stamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- new images are confirmed again (the API asks for it): the record names who confirmed these images, and when
  IF NEW.consent_confirmed AND (TG_OP = 'INSERT' OR NOT OLD.consent_confirmed OR NEW.image_file_id IS DISTINCT FROM OLD.image_file_id
                                OR NEW.before_file_id IS DISTINCT FROM OLD.before_file_id) THEN
    NEW.consent_confirmed_at := now();
    NEW.consent_confirmed_by := nullif(current_setting('app.member_id', true), '')::uuid;
  ELSIF NOT NEW.consent_confirmed THEN
    NEW.consent_confirmed_at := NULL;
    NEW.consent_confirmed_by := NULL;
  ELSE
    NEW.consent_confirmed_at := OLD.consent_confirmed_at; -- kept as first recorded
    NEW.consent_confirmed_by := OLD.consent_confirmed_by;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gallery_items_consent_stamp BEFORE INSERT OR UPDATE OF consent_confirmed, consent_confirmed_at, consent_confirmed_by, image_file_id, before_file_id ON gallery_items
  FOR EACH ROW EXECUTE FUNCTION gallery_items_consent_stamp();

-- migrate:down
DROP TRIGGER IF EXISTS gallery_items_files_guard ON gallery_items;
DROP FUNCTION IF EXISTS gallery_items_files_guard();
DROP TRIGGER IF EXISTS gallery_items_consent_stamp ON gallery_items;
DROP FUNCTION IF EXISTS gallery_items_consent_stamp();
DROP INDEX IF EXISTS gallery_items_type_order;
ALTER TABLE gallery_items
  DROP CONSTRAINT IF EXISTS gallery_items_case_not_featured,
  DROP CONSTRAINT IF EXISTS gallery_items_case_clinic_wide, DROP CONSTRAINT IF EXISTS gallery_items_case_images,
  DROP CONSTRAINT IF EXISTS gallery_items_consent_recorded, DROP CONSTRAINT IF EXISTS gallery_items_consent_by_fk,
  DROP COLUMN IF EXISTS consent_confirmed_by, DROP COLUMN IF EXISTS consent_confirmed_at;
CREATE OR REPLACE FUNCTION purge_orphan_images(p_age interval DEFAULT interval '1 day')
RETURNS TABLE (tenant_id uuid, id uuid, variant_widths int[])
LANGUAGE sql AS $$
  DELETE FROM files f
  WHERE f.kind IN ('gallery', 'logo', 'image') AND f.created_at < now() - p_age AND NOT file_in_use(f.id)
  RETURNING f.tenant_id, f.id, f.variant_widths
$$;
UPDATE files SET kind = 'gallery' WHERE kind = 'case';
ALTER TABLE files DROP CONSTRAINT files_kind_check;
ALTER TABLE files ADD CONSTRAINT files_kind_check
  CHECK (kind IN ('logo', 'image', 'gallery', 'xray', 'clinical_photo', 'consent', 'document', 'invoice_pdf', 'other'));
