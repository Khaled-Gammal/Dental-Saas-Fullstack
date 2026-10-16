-- migrate:up
-- Images on the clinic's own records: clinic logo (tenants.logo_file_id), doctor photo, service image (columns exist
-- since the initial schema) and a new branch photo. Additive only.

ALTER TABLE branches
  ADD COLUMN photo_file_id uuid,
  ADD CONSTRAINT branches_photo_fk FOREIGN KEY (tenant_id, photo_file_id) REFERENCES files(tenant_id, id) ON DELETE SET NULL (photo_file_id);

-- "who uses this file?" is asked on every public image request and before every delete
CREATE INDEX IF NOT EXISTS tenants_logo_file      ON tenants (logo_file_id)        WHERE logo_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS doctors_photo_file     ON doctors (photo_file_id)       WHERE photo_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS services_image_file    ON services (image_file_id)      WHERE image_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS branches_photo_file    ON branches (photo_file_id)      WHERE photo_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS gallery_items_image_file  ON gallery_items (image_file_id);
CREATE INDEX IF NOT EXISTS gallery_items_before_file ON gallery_items (before_file_id) WHERE before_file_id IS NOT NULL;

-- A file may be served on the clinic's website exactly while something visitors can see shows it. Decided live (no
-- flag to keep in sync), so hiding a doctor or closing a branch takes the image off the site at once. Runs with the
-- caller's rights: inside a clinic's context RLS limits it to that clinic's rows.
CREATE FUNCTION file_is_public(p_file uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM gallery_items g WHERE g.is_published AND (g.image_file_id = p_file OR g.before_file_id = p_file))
      OR EXISTS (SELECT 1 FROM tenants t  WHERE t.logo_file_id = p_file AND t.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM doctors d  WHERE d.photo_file_id = p_file AND d.is_active AND d.show_on_website)
      OR EXISTS (SELECT 1 FROM services s WHERE s.image_file_id = p_file AND s.is_active AND s.show_on_website)
      OR EXISTS (SELECT 1 FROM branches b WHERE b.photo_file_id = p_file AND b.is_active)
$$;

-- Whether anything at all still points at a file (published or not). Some of these foreign keys are ON DELETE SET NULL,
-- so "the delete succeeded" does not prove a file was unused: deletes check this first.
CREATE FUNCTION file_in_use(p_file uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM gallery_items g WHERE g.image_file_id = p_file OR g.before_file_id = p_file)
      OR EXISTS (SELECT 1 FROM tenants t  WHERE t.logo_file_id = p_file)
      OR EXISTS (SELECT 1 FROM doctors d  WHERE d.photo_file_id = p_file)
      OR EXISTS (SELECT 1 FROM services s WHERE s.image_file_id = p_file)
      OR EXISTS (SELECT 1 FROM branches b WHERE b.photo_file_id = p_file)
      OR EXISTS (SELECT 1 FROM sites x    WHERE x.favicon_file_id = p_file)
      OR EXISTS (SELECT 1 FROM posts p    WHERE p.cover_file_id = p_file)
      OR EXISTS (SELECT 1 FROM patient_files pf WHERE pf.file_id = p_file)
      OR EXISTS (SELECT 1 FROM patient_consents c WHERE c.signature_file_id = p_file)
      OR EXISTS (SELECT 1 FROM expenses e WHERE e.file_id = p_file)
$$;

-- Nightly: uploaded website images that were never attached (a form left without saving) or were let go of and are
-- older than p_age. Returns what was deleted so the worker can remove the stored renditions. Medical kinds are never touched.
CREATE FUNCTION purge_orphan_images(p_age interval DEFAULT interval '1 day')
RETURNS TABLE (tenant_id uuid, id uuid, variant_widths int[])
LANGUAGE sql AS $$
  DELETE FROM files f
  WHERE f.kind IN ('gallery', 'logo', 'image') AND f.created_at < now() - p_age AND NOT file_in_use(f.id)
  RETURNING f.tenant_id, f.id, f.variant_widths
$$;
REVOKE EXECUTE ON FUNCTION purge_orphan_images(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_orphan_images(interval) TO app_worker;

-- migrate:down
DROP FUNCTION IF EXISTS purge_orphan_images(interval);
DROP FUNCTION IF EXISTS file_in_use(uuid);
DROP FUNCTION IF EXISTS file_is_public(uuid);
DROP INDEX IF EXISTS gallery_items_before_file;
DROP INDEX IF EXISTS gallery_items_image_file;
DROP INDEX IF EXISTS branches_photo_file;
DROP INDEX IF EXISTS services_image_file;
DROP INDEX IF EXISTS doctors_photo_file;
DROP INDEX IF EXISTS tenants_logo_file;
ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_photo_fk, DROP COLUMN IF EXISTS photo_file_id;
