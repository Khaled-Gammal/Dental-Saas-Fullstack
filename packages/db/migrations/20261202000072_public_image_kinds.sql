-- migrate:up
-- Schema v4 audit, SEC-05 (docs/database/schema-v3-audit.md): file_is_public() (0011) decides that a file may be served
-- on the clinic's website from what points at it, and nothing stopped a logo, photo or cover column from pointing at a
-- patient's file. An x-ray set as the clinic logo was public. The API checks the image's kind (media.service.ts); the
-- database now refuses it too, and file_is_public() never answers yes for a clinical file whatever points at it.

-- every column a visitor of the website can be shown an image through
CREATE FUNCTION public_image_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_col text; v_file uuid;
BEGIN
  FOREACH v_col IN ARRAY TG_ARGV LOOP
    v_file := (to_jsonb(NEW) ->> v_col)::uuid;
    IF v_file IS NOT NULL AND EXISTS (SELECT 1 FROM files
         WHERE id = v_file AND kind IN ('xray', 'clinical_photo', 'consent', 'document', 'invoice_pdf')) THEN
      RAISE EXCEPTION 'a patient''s file cannot be shown on the website (%.%)', TG_TABLE_NAME, v_col
        USING ERRCODE = 'check_violation', CONSTRAINT = 'public_image_kind';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- nothing is changed: a row that already points at a clinical file stops the migration, for a person to look at
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('tenants', 'logo_file_id'), ('doctors', 'photo_file_id'), ('services', 'image_file_id'),
      ('branches', 'photo_file_id'), ('sites', 'favicon_file_id'), ('sites', 'share_file_id'), ('posts', 'cover_file_id'),
      ('gallery_items', 'image_file_id'), ('gallery_items', 'before_file_id')) t(tbl, col)
  LOOP
    EXECUTE format('SELECT count(*) FROM %I x JOIN files f ON f.id = x.%I
                    WHERE f.kind IN (''xray'', ''clinical_photo'', ''consent'', ''document'', ''invoice_pdf'')', r.tbl, r.col) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '%.% points at % patient file(s); clear them before this migration', r.tbl, r.col, n;
    END IF;
  END LOOP;
END $$;

CREATE TRIGGER tenants_public_image  BEFORE INSERT OR UPDATE OF logo_file_id ON tenants
  FOR EACH ROW EXECUTE FUNCTION public_image_guard('logo_file_id');
CREATE TRIGGER doctors_public_image  BEFORE INSERT OR UPDATE OF photo_file_id ON doctors
  FOR EACH ROW EXECUTE FUNCTION public_image_guard('photo_file_id');
CREATE TRIGGER services_public_image BEFORE INSERT OR UPDATE OF image_file_id ON services
  FOR EACH ROW EXECUTE FUNCTION public_image_guard('image_file_id');
CREATE TRIGGER branches_public_image BEFORE INSERT OR UPDATE OF photo_file_id ON branches
  FOR EACH ROW EXECUTE FUNCTION public_image_guard('photo_file_id');
CREATE TRIGGER sites_public_image    BEFORE INSERT OR UPDATE OF favicon_file_id, share_file_id ON sites
  FOR EACH ROW EXECUTE FUNCTION public_image_guard('favicon_file_id', 'share_file_id');
CREATE TRIGGER posts_public_image    BEFORE INSERT OR UPDATE OF cover_file_id ON posts
  FOR EACH ROW EXECUTE FUNCTION public_image_guard('cover_file_id');
CREATE TRIGGER gallery_items_public_image BEFORE INSERT OR UPDATE OF image_file_id, before_file_id ON gallery_items
  FOR EACH ROW EXECUTE FUNCTION public_image_guard('image_file_id', 'before_file_id');

-- same answer as before, except that a clinical file is never public
CREATE OR REPLACE FUNCTION file_is_public(p_file uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (SELECT 1 FROM files f WHERE f.id = p_file AND f.kind IN ('xray', 'clinical_photo', 'consent', 'document', 'invoice_pdf'))
     AND (EXISTS (SELECT 1 FROM gallery_items g WHERE g.is_published AND (g.image_file_id = p_file OR g.before_file_id = p_file))
       OR EXISTS (SELECT 1 FROM tenants t  WHERE t.logo_file_id = p_file AND t.deleted_at IS NULL)
       OR EXISTS (SELECT 1 FROM doctors d  WHERE d.photo_file_id = p_file AND d.is_active AND d.show_on_website)
       OR EXISTS (SELECT 1 FROM services s WHERE s.image_file_id = p_file AND s.is_active AND s.show_on_website)
       OR EXISTS (SELECT 1 FROM branches b WHERE b.photo_file_id = p_file AND b.is_active))
$$;

-- migrate:down
CREATE OR REPLACE FUNCTION file_is_public(p_file uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM gallery_items g WHERE g.is_published AND (g.image_file_id = p_file OR g.before_file_id = p_file))
      OR EXISTS (SELECT 1 FROM tenants t  WHERE t.logo_file_id = p_file AND t.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM doctors d  WHERE d.photo_file_id = p_file AND d.is_active AND d.show_on_website)
      OR EXISTS (SELECT 1 FROM services s WHERE s.image_file_id = p_file AND s.is_active AND s.show_on_website)
      OR EXISTS (SELECT 1 FROM branches b WHERE b.photo_file_id = p_file AND b.is_active)
$$;
DROP TRIGGER IF EXISTS gallery_items_public_image ON gallery_items;
DROP TRIGGER IF EXISTS posts_public_image ON posts;
DROP TRIGGER IF EXISTS sites_public_image ON sites;
DROP TRIGGER IF EXISTS branches_public_image ON branches;
DROP TRIGGER IF EXISTS services_public_image ON services;
DROP TRIGGER IF EXISTS doctors_public_image ON doctors;
DROP TRIGGER IF EXISTS tenants_public_image ON tenants;
DROP FUNCTION IF EXISTS public_image_guard();
