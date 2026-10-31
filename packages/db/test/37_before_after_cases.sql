-- Phase 2C-2: before/after cases. Consent is required to publish, recorded with who confirmed it and when (the acting
-- member, set by the database); cases are clinic-wide, never featured, with two different images. Clinic A 1111….
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SELECT set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true);
SELECT set_config('app.member_id', 'c0000000-0000-0000-0000-0000000000a1', true);
INSERT INTO files (id, tenant_id, bucket, object_key, mime_type, size_bytes, kind, is_private, width, height, variant_widths) VALUES
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b', 't/before', 'image/webp', 10, 'case', true, 800, 600, '{320,640}'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'b', 't/after', 'image/webp', 10, 'case', true, 800, 600, '{320,640}'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'b', 't/photo', 'image/webp', 10, 'gallery', true, 800, 600, '{320,640}'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'b', 't/after2', 'image/webp', 10, 'case', true, 800, 600, '{320,640}');

-- a case shows case images; a case image is never a photo
SELECT test.throws($$INSERT INTO gallery_items (tenant_id, type, image_file_id, before_file_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'before_after', 'f1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000001')$$,
  'a case shows case images', 'a website photo is not a case image');
SELECT test.throws($$INSERT INTO gallery_items (tenant_id, type, image_file_id, alt_ar) VALUES
  ('11111111-1111-1111-1111-111111111111', 'photo', 'f1000000-0000-0000-0000-000000000001', 'صورة')$$,
  'a case image is not a photo', 'a case image is never published as a photo');

SELECT test.throws($$INSERT INTO gallery_items (tenant_id, type, image_file_id, before_file_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'before_after', 'f1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001')$$,
  'gallery_items_case_images', 'a case shows two different images');
SELECT test.throws($$INSERT INTO gallery_items (tenant_id, type, image_file_id, before_file_id, caption_ar, is_published) VALUES
  ('11111111-1111-1111-1111-111111111111', 'before_after', 'f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', 'تبييض', true)$$,
  'gallery_items_check', 'no consent: not published');
INSERT INTO gallery_items (id, tenant_id, type, image_file_id, before_file_id, caption_ar) VALUES
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'before_after', 'f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', 'تبييض الأسنان');
SELECT test.ok((SELECT consent_confirmed_at IS NULL AND consent_confirmed_by IS NULL FROM gallery_items WHERE id = 'a1000000-0000-0000-0000-000000000001'), 'a draft without consent');
SELECT test.throws($$INSERT INTO gallery_items (tenant_id, type, image_file_id, before_file_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'before_after', 'f1000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000001')$$,
  'a case image belongs to one case', 'a case image belongs to one case');

-- the client cannot choose who confirmed: the acting member is recorded
UPDATE gallery_items SET consent_confirmed = true, consent_confirmed_by = 'c0000000-0000-0000-0000-0000000000a2', consent_confirmed_at = '2020-01-01'
 WHERE id = 'a1000000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT consent_confirmed_by = 'c0000000-0000-0000-0000-0000000000a1' AND consent_confirmed_at > now() - interval '1 minute'
  FROM gallery_items WHERE id = 'a1000000-0000-0000-0000-000000000001'), 'consent is stamped with the acting member and now');
UPDATE gallery_items SET is_published = true WHERE id = 'a1000000-0000-0000-0000-000000000001';
SELECT test.ok(file_is_public('f1000000-0000-0000-0000-000000000001') AND file_is_public('f1000000-0000-0000-0000-000000000002'),
  'a published case makes both images public');
SELECT test.throws($$UPDATE gallery_items SET consent_confirmed = false WHERE id = 'a1000000-0000-0000-0000-000000000001'$$,
  'gallery_items_check', 'a published case keeps its consent (unpublish first)');
SELECT test.throws($$UPDATE gallery_items SET is_featured = true WHERE id = 'a1000000-0000-0000-0000-000000000001'$$,
  'gallery_items_case_not_featured', 'a case is never featured');
SELECT test.throws($$UPDATE gallery_items SET branch_id = (SELECT id FROM branches LIMIT 1) WHERE id = 'a1000000-0000-0000-0000-000000000001'$$,
  'gallery_items_case_clinic_wide', 'cases are clinic-wide');
UPDATE gallery_items SET caption_ar = 'تبييض بالليزر', consent_confirmed_at = consent_confirmed_at - interval '1 hour' WHERE id = 'a1000000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT consent_confirmed_by = 'c0000000-0000-0000-0000-0000000000a1' AND consent_confirmed_at > now() - interval '1 minute'
  FROM gallery_items WHERE id = 'a1000000-0000-0000-0000-000000000001'), 'an unrelated edit keeps the consent record (and cannot change it)');
-- new images: the confirmation is stamped again, by whoever confirms these images
SELECT set_config('app.member_id', 'c0000000-0000-0000-0000-0000000000a2', true);
UPDATE gallery_items SET image_file_id = 'f1000000-0000-0000-0000-000000000004' WHERE id = 'a1000000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT consent_confirmed_by = 'c0000000-0000-0000-0000-0000000000a2' FROM gallery_items WHERE id = 'a1000000-0000-0000-0000-000000000001'),
  'replaced images are confirmed again, by the acting member');
UPDATE gallery_items SET is_published = false, consent_confirmed = false WHERE id = 'a1000000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT consent_confirmed_at IS NULL AND consent_confirmed_by IS NULL FROM gallery_items WHERE id = 'a1000000-0000-0000-0000-000000000001'),
  'withdrawing consent clears its record');
SELECT test.ok(NOT file_is_public('f1000000-0000-0000-0000-000000000001'), 'and the images are no longer public');
ROLLBACK;
