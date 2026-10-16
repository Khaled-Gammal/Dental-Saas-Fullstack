-- Website content phase 1b: images on the clinic, branches, doctors and services
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';

INSERT INTO files (id, tenant_id, bucket, object_key, mime_type, size_bytes, kind, width, height, variant_widths) VALUES
 ('fb000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','local','t/a/e1','image/webp',1000,'image',800,800,'{320,640,800}'),
 ('fb000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','local','t/a/e2','image/webp',1000,'image',800,800,'{320,640,800}'),
 ('fb000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','local','t/a/e3','image/webp',1000,'image',800,800,'{320,640,800}'),
 ('fb000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','local','t/a/e4','image/webp',1000,'logo',512,128,'{128,256,512}'),
 ('fb000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','local','t/a/e5','image/webp',1000,'image',800,800,'{320,640,800}');

UPDATE doctors  SET photo_file_id = 'fb000000-0000-0000-0000-000000000001' WHERE id = 'f0000000-0000-0000-0000-0000000000a1';
UPDATE services SET image_file_id = 'fb000000-0000-0000-0000-000000000002' WHERE id = '90000000-0000-0000-0000-0000000000a1';
UPDATE branches SET photo_file_id = 'fb000000-0000-0000-0000-000000000003' WHERE id = 'd0000000-0000-0000-0000-0000000000a2';
UPDATE tenants  SET logo_file_id  = 'fb000000-0000-0000-0000-000000000004';

SELECT test.ok(file_is_public('fb000000-0000-0000-0000-000000000001'), 'a shown doctor''s photo is public');
SELECT test.ok(file_is_public('fb000000-0000-0000-0000-000000000002'), 'a shown service''s image is public');
SELECT test.ok(file_is_public('fb000000-0000-0000-0000-000000000003'), 'an active branch''s photo is public');
SELECT test.ok(file_is_public('fb000000-0000-0000-0000-000000000004'), 'the clinic logo is public');
SELECT test.ok(NOT file_is_public('fb000000-0000-0000-0000-000000000005'), 'an unattached upload is private');
SELECT test.ok(NOT file_in_use('fb000000-0000-0000-0000-000000000005'), 'an unattached upload is not in use');

UPDATE doctors  SET show_on_website = false WHERE id = 'f0000000-0000-0000-0000-0000000000a1';
UPDATE services SET is_active = false      WHERE id = '90000000-0000-0000-0000-0000000000a1';
UPDATE branches SET is_active = false      WHERE id = 'd0000000-0000-0000-0000-0000000000a2';
SELECT test.ok(NOT file_is_public('fb000000-0000-0000-0000-000000000001'), 'hiding the doctor takes the photo off the site');
SELECT test.ok(NOT file_is_public('fb000000-0000-0000-0000-000000000002'), 'deactivating the service takes the image off the site');
SELECT test.ok(NOT file_is_public('fb000000-0000-0000-0000-000000000003'), 'closing the branch takes the photo off the site');
SELECT test.ok(file_in_use('fb000000-0000-0000-0000-000000000001') AND file_in_use('fb000000-0000-0000-0000-000000000003'),
  'hidden records still hold their images (no delete)');

SELECT test.throws($$UPDATE branches SET photo_file_id = 'fb000000-0000-0000-0000-0000000000ff' WHERE id = 'd0000000-0000-0000-0000-0000000000a1'$$,
  'branches_photo_fk', 'a branch photo must be an existing file of this clinic');

-- another clinic: cannot see clinic A's references, so nothing of A is public in B's context
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SELECT test.ok(NOT file_is_public('fb000000-0000-0000-0000-000000000004'), 'clinic A''s logo is not public on clinic B''s site');
SELECT test.throws($$UPDATE branches SET photo_file_id = 'fb000000-0000-0000-0000-000000000005' WHERE id = 'd0000000-0000-0000-0000-0000000000b1'$$,
  'branches_photo_fk', 'clinic B cannot use clinic A''s file');
ROLLBACK;

-- the nightly purge (worker role, all clinics): only old, unattached website images
BEGIN;
INSERT INTO files (id, tenant_id, bucket, object_key, mime_type, size_bytes, kind, width, height, variant_widths, created_at) VALUES
 ('fc000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','local','t/a/p1','image/webp',10,'image',800,800,'{320}', now() - interval '2 days'),
 ('fc000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','local','t/a/p2','image/webp',10,'image',800,800,'{320}', now()),
 ('fc000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','local','t/a/p3','image/webp',10,'image',800,800,'{320}', now() - interval '2 days'),
 ('fc000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','local','t/a/p4','image/jpeg',10,'xray',800,800,'{}', now() - interval '2 days');
UPDATE doctors SET photo_file_id = 'fc000000-0000-0000-0000-000000000003' WHERE id = 'f0000000-0000-0000-0000-0000000000a2';
SET LOCAL ROLE app_worker;
SELECT test.ok((SELECT array_agg(id ORDER BY id) FROM purge_orphan_images() WHERE id::text LIKE 'fc%') = ARRAY['fc000000-0000-0000-0000-000000000001'::uuid],
  'purge deletes only the old unattached image (not the fresh upload, the attached photo or a medical file)');
RESET ROLE;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SELECT test.throws($$SELECT * FROM purge_orphan_images()$$, 'permission denied', 'the app role cannot run the purge');
ROLLBACK;
