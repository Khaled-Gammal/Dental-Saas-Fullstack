-- Website content phase 1: the gallery's database rules
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';

INSERT INTO files (id, tenant_id, bucket, object_key, mime_type, size_bytes, kind, is_private, width, height, variant_widths) VALUES
 ('fa000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','local','t/a/1','image/webp',1000,'gallery',true,1200,800,'{480,960,1200}'),
 ('fa000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','local','t/a/2','image/webp',1000,'gallery',true,1200,800,'{480,960,1200}');
SELECT test.throws($$INSERT INTO files (tenant_id, bucket, object_key, mime_type, size_bytes, kind, width) VALUES
  ('11111111-1111-1111-1111-111111111111','local','t/a/3','image/webp',10,'gallery',0)$$, 'check constraint', 'a width must be positive');

SELECT test.throws($$INSERT INTO gallery_items (tenant_id, type, image_file_id, is_published) VALUES
  ('11111111-1111-1111-1111-111111111111','photo','fa000000-0000-0000-0000-000000000001', true)$$,
  'gallery_items_published_described', 'a published photo needs alt text or a caption');
SELECT test.throws($$INSERT INTO gallery_items (tenant_id, type, image_file_id, is_featured, alt_ar) VALUES
  ('11111111-1111-1111-1111-111111111111','photo','fa000000-0000-0000-0000-000000000001', true, 'وصف')$$,
  'gallery_items_featured_published', 'only a published photo can be featured');
SELECT test.lives($$INSERT INTO gallery_items (tenant_id, type, image_file_id, is_published, is_featured, alt_ar) VALUES
  ('11111111-1111-1111-1111-111111111111','photo','fa000000-0000-0000-0000-000000000001', true, true, 'وصف')$$, 'a featured clinic photo');
SELECT test.throws($$INSERT INTO gallery_items (tenant_id, type, image_file_id, is_published, is_featured, alt_ar) VALUES
  ('11111111-1111-1111-1111-111111111111','photo','fa000000-0000-0000-0000-000000000002', true, true, 'وصف')$$,
  'gallery_items_one_featured', 'a second featured clinic photo is refused');
SELECT test.lives($$INSERT INTO gallery_items (tenant_id, type, image_file_id, branch_id, is_published, is_featured, alt_ar) VALUES
  ('11111111-1111-1111-1111-111111111111','photo','fa000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-0000000000a1', true, true, 'وصف')$$,
  'each branch has its own featured photo');
SELECT test.throws($$INSERT INTO gallery_items (tenant_id, type, image_file_id, branch_id, alt_ar) VALUES
  ('11111111-1111-1111-1111-111111111111','photo','fa000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-0000000000b1','x')$$,
  'gallery_items_branch_fk', 'another clinic''s branch cannot be used');

-- another clinic sees none of it
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SELECT test.ok((SELECT count(*) FROM gallery_items WHERE image_file_id IN ('fa000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-000000000002')) = 0,
  'clinic B cannot read clinic A''s gallery');
SELECT test.ok((SELECT count(*) FROM files WHERE id = 'fa000000-0000-0000-0000-000000000001') = 0, 'clinic B cannot read clinic A''s files');
ROLLBACK;
