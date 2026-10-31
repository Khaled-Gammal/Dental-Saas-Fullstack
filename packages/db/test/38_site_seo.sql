-- Phase 2C-3: the site's search title and description, and its share image (kept by the nightly purge).
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SELECT set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true);
SELECT test.throws($$UPDATE sites SET seo_title = 'abc'$$, 'sites_seo_title', 'a title is at least 5 characters');
SELECT test.throws($$UPDATE sites SET seo_description = 'قصير'$$, 'sites_seo_description', 'a description says something');
SELECT test.lives($$UPDATE sites SET seo_title = 'عيادة الابتسامة لطب الأسنان', seo_description = 'تبييض وتقويم وزراعة أسنان في مدينة نصر، احجز موعدك أونلاين.'$$, 'the clinic sets both');
INSERT INTO files (id, tenant_id, bucket, object_key, mime_type, size_bytes, kind, is_private, width, height, variant_widths, created_at) VALUES
  ('f2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b', 't/share', 'image/webp', 10, 'image', true, 1280, 720, '{640,1280}', now() - interval '3 days');
UPDATE sites SET share_file_id = 'f2000000-0000-0000-0000-000000000001';
SELECT test.ok(file_in_use('f2000000-0000-0000-0000-000000000001'), 'the share image is in use');
RESET ROLE;
SET LOCAL ROLE app_worker;
SELECT test.ok(NOT EXISTS (SELECT 1 FROM purge_orphan_images() WHERE id = 'f2000000-0000-0000-0000-000000000001'), 'so the nightly purge keeps it');
ROLLBACK;
