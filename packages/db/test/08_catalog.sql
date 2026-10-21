-- Week 3 part 2: doctor schedules and the price list
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';

-- a doctor cannot be in two branches at once, but back-to-back slots are fine
DELETE FROM doctor_schedules WHERE doctor_id = 'f0000000-0000-0000-0000-0000000000a1' AND weekday = 2;
SELECT test.lives($$INSERT INTO doctor_schedules (tenant_id, doctor_id, branch_id, weekday, starts_at, ends_at) VALUES
  ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1',2,'10:00','14:00'),
  ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a2',2,'14:00','18:00')$$,
  'touching slots at two branches are allowed');
SELECT test.throws($$INSERT INTO doctor_schedules (tenant_id, doctor_id, branch_id, weekday, starts_at, ends_at) VALUES
  ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a2',2,'13:00','16:00')$$,
  'doctor_schedules_no_overlap', 'overlapping slots across branches are rejected (named constraint)');
SELECT test.lives($$INSERT INTO doctor_schedules (tenant_id, doctor_id, branch_id, weekday, starts_at, ends_at) VALUES
  ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-0000000000a2','d0000000-0000-0000-0000-0000000000a1',2,'13:00','16:00')$$,
  'another doctor at the same time is fine');

-- a catalogue service is on the price list once; custom services are free
DELETE FROM services WHERE catalog_code = 'rct';
SELECT test.lives($$INSERT INTO services (tenant_id, catalog_code, name_en, duration_minutes, price_minor) VALUES
  ('11111111-1111-1111-1111-111111111111','rct','Root canal',90,50000)$$, 'a catalogue service can be added');
SELECT test.throws($$INSERT INTO services (tenant_id, catalog_code, name_en, duration_minutes) VALUES
  ('11111111-1111-1111-1111-111111111111','rct','Root canal again',90)$$,
  'services_tenant_catalog_code', 'the same catalogue service twice is rejected');
SELECT test.lives($$INSERT INTO services (tenant_id, name_ar, duration_minutes) VALUES
  ('11111111-1111-1111-1111-111111111111','زراعة',60), ('11111111-1111-1111-1111-111111111111','زراعة فورية',60)$$,
  'custom services are not limited');
SELECT test.throws($$INSERT INTO services (tenant_id, duration_minutes) VALUES ('11111111-1111-1111-1111-111111111111',30)$$,
  'violates check constraint', 'a service needs a name');
SELECT test.throws($$UPDATE services SET price_max_minor = 100 WHERE catalog_code = 'rct'$$,
  'violates check constraint', 'a price range cannot end below its start');

-- the other clinic may add the same catalogue service
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
DELETE FROM services WHERE catalog_code = 'rct';
SELECT test.lives($$INSERT INTO services (tenant_id, catalog_code, name_en, duration_minutes) VALUES
  ('22222222-2222-2222-2222-222222222222','rct','Root canal',90)$$, 'the index is per clinic');

-- a deleted service (kept for history, owner 2026-10-21) is off everywhere
SELECT test.throws($$UPDATE services SET deleted_at = now() WHERE catalog_code = 'rct'$$,
  'services_deleted_is_off', 'a deleted service cannot stay active, on the website or bookable');
SELECT test.lives($$UPDATE services SET deleted_at = now(), is_active = false, show_on_website = false, bookable_online = false
  WHERE catalog_code = 'rct'$$, 'a deleted service is switched off');
SELECT test.throws($$UPDATE services SET is_active = true WHERE catalog_code = 'rct'$$,
  'services_deleted_is_off', 'nor switched back on while deleted');

ROLLBACK;
