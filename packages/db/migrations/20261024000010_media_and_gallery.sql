-- migrate:up
-- Phase 1 of the website-content roadmap: image uploads (media) and the clinic/branch gallery.
-- Additive only: no column is dropped or rewritten.

-- Images are stored as WebP renditions at a few widths; the row remembers the original size (for aspect ratios and
-- layout without shift) and which widths exist (for srcset).
ALTER TABLE files
  ADD COLUMN width          int CHECK (width > 0),
  ADD COLUMN height         int CHECK (height > 0),
  ADD COLUMN variant_widths int[] NOT NULL DEFAULT '{}';
-- storage use per clinic (plan limit) and the website's lookups by id stay within one clinic
CREATE INDEX IF NOT EXISTS files_tenant_kind ON files (tenant_id, kind);

-- Gallery: clinic-wide (branch_id NULL) or one branch. Alt text for screen readers, one featured photo per scope.
ALTER TABLE gallery_items
  ADD COLUMN branch_id   uuid,
  ADD COLUMN alt_ar      text CHECK (char_length(alt_ar) <= 200),
  ADD COLUMN alt_en      text CHECK (char_length(alt_en) <= 200),
  ADD COLUMN is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN updated_at  timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT gallery_items_branch_fk FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT gallery_items_tenant_id_key UNIQUE (tenant_id, id),
  -- a published photo is described for screen readers (alt or caption, in Arabic or English)
  ADD CONSTRAINT gallery_items_published_described CHECK (NOT is_published OR coalesce(alt_ar, alt_en, caption_ar, caption_en) IS NOT NULL),
  -- only a published photo can be the featured one
  ADD CONSTRAINT gallery_items_featured_published CHECK (NOT is_featured OR is_published);
-- at most one featured photo for the clinic and one per branch
CREATE UNIQUE INDEX gallery_items_one_featured ON gallery_items (tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_featured;
-- the dashboard and the website read a scope in display order
CREATE INDEX gallery_items_scope_order ON gallery_items (tenant_id, branch_id, sort_order, id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON gallery_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down
DROP TRIGGER IF EXISTS set_updated_at ON gallery_items;
DROP INDEX IF EXISTS gallery_items_scope_order;
DROP INDEX IF EXISTS gallery_items_one_featured;
ALTER TABLE gallery_items
  DROP CONSTRAINT IF EXISTS gallery_items_featured_published,
  DROP CONSTRAINT IF EXISTS gallery_items_published_described,
  DROP CONSTRAINT IF EXISTS gallery_items_tenant_id_key,
  DROP CONSTRAINT IF EXISTS gallery_items_branch_fk,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS is_featured,
  DROP COLUMN IF EXISTS alt_en,
  DROP COLUMN IF EXISTS alt_ar,
  DROP COLUMN IF EXISTS branch_id;
DROP INDEX IF EXISTS files_tenant_kind;
ALTER TABLE files DROP COLUMN IF EXISTS variant_widths, DROP COLUMN IF EXISTS height, DROP COLUMN IF EXISTS width;
