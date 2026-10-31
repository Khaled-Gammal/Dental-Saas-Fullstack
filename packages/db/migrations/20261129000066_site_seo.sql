-- migrate:up
-- Phase 2C-3 (owner 2026-10-31): how a clinic's site appears in search results and when its link is shared.
--   * seo_title / seo_description: what Google and WhatsApp show (the site falls back to the clinic's name and about).
--   * share_file_id: the image shown when the link is shared (a 1200×630 JPEG is made from it by the API); without one,
--     the API makes it from the clinic's logo and brand colour.
ALTER TABLE sites
  ADD COLUMN seo_title text CONSTRAINT sites_seo_title CHECK (seo_title IS NULL OR char_length(btrim(seo_title)) BETWEEN 5 AND 70),
  ADD COLUMN seo_description text CONSTRAINT sites_seo_description CHECK (seo_description IS NULL OR char_length(btrim(seo_description)) BETWEEN 20 AND 200),
  ADD COLUMN share_file_id uuid,
  ADD CONSTRAINT sites_share_file_fk FOREIGN KEY (tenant_id, share_file_id) REFERENCES files(tenant_id, id) ON DELETE SET NULL (share_file_id);

-- the share image is in use (the nightly purge of unattached images keeps it)
CREATE OR REPLACE FUNCTION file_in_use(p_file uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM gallery_items g WHERE g.image_file_id = p_file OR g.before_file_id = p_file)
      OR EXISTS (SELECT 1 FROM tenants t  WHERE t.logo_file_id = p_file)
      OR EXISTS (SELECT 1 FROM doctors d  WHERE d.photo_file_id = p_file)
      OR EXISTS (SELECT 1 FROM services s WHERE s.image_file_id = p_file)
      OR EXISTS (SELECT 1 FROM branches b WHERE b.photo_file_id = p_file)
      OR EXISTS (SELECT 1 FROM sites x    WHERE x.favicon_file_id = p_file OR x.share_file_id = p_file)
      OR EXISTS (SELECT 1 FROM posts p    WHERE p.cover_file_id = p_file)
      OR EXISTS (SELECT 1 FROM patient_files pf WHERE pf.file_id = p_file)
      OR EXISTS (SELECT 1 FROM patient_consents c WHERE c.signature_file_id = p_file)
      OR EXISTS (SELECT 1 FROM expenses e WHERE e.file_id = p_file)
$$;

-- migrate:down
CREATE OR REPLACE FUNCTION file_in_use(p_file uuid) RETURNS boolean
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
ALTER TABLE sites
  DROP CONSTRAINT IF EXISTS sites_share_file_fk,
  DROP COLUMN IF EXISTS share_file_id, DROP COLUMN IF EXISTS seo_description, DROP COLUMN IF EXISTS seo_title;
