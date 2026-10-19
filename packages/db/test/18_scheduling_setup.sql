-- Phase D2: holidays, doctor time off, rooms, booking settings, slot search for a move (SRS APPT-001/005/006/009)
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';

-- holidays: one per date and scope
INSERT INTO holidays (tenant_id, branch_id, date, name, created_by) VALUES
 ('11111111-1111-1111-1111-111111111111', NULL, '2031-10-06', 'عيد القوات المسلحة', 'c0000000-0000-0000-0000-0000000000a1');
SELECT test.throws($$INSERT INTO holidays (tenant_id, branch_id, date, name) VALUES ('11111111-1111-1111-1111-111111111111', NULL, '2031-10-06', 'x')$$,
  'holidays_one_per_scope_date', 'the same clinic-wide holiday cannot be added twice');
SELECT test.lives($$INSERT INTO holidays (tenant_id, branch_id, date, name) VALUES ('11111111-1111-1111-1111-111111111111',
  'd0000000-0000-0000-0000-0000000000a2', '2031-10-06', 'صيانة')$$, 'a branch may also close on a clinic-wide holiday date');
SELECT test.throws($$INSERT INTO holidays (tenant_id, branch_id, date, name) VALUES ('11111111-1111-1111-1111-111111111111', NULL, '2031-10-07', '')$$,
  'holidays_name_length', 'a holiday needs a name');
SELECT test.throws($$INSERT INTO holidays (tenant_id, date, name, created_by) VALUES ('11111111-1111-1111-1111-111111111111', '2031-10-08', 'x',
  'c0000000-0000-0000-0000-0000000000b1')$$, 'holidays_created_by_member_fk', 'who added it is a member of this clinic');

-- doctor time off: a sane length
SELECT test.throws($$INSERT INTO doctor_time_off (tenant_id, doctor_id, starts_at, ends_at) VALUES ('11111111-1111-1111-1111-111111111111',
  'f0000000-0000-0000-0000-0000000000a1', '2031-01-01', '2041-01-01')$$, 'doctor_time_off_max_length', 'time off cannot last ten years');
SELECT test.lives($$INSERT INTO doctor_time_off (tenant_id, doctor_id, starts_at, ends_at, reason, created_by) VALUES ('11111111-1111-1111-1111-111111111111',
  'f0000000-0000-0000-0000-0000000000a1', '2031-08-01', '2031-08-15', 'إجازة سنوية', 'c0000000-0000-0000-0000-0000000000a1')$$, 'two weeks of leave is fine');

-- reminder times
SELECT test.throws($$UPDATE tenant_settings SET reminder_offsets_minutes = '{1440,120,60,30,15}'$$, 'tenant_settings_reminder_offsets', 'at most four reminders');
SELECT test.throws($$UPDATE tenant_settings SET reminder_offsets_minutes = '{5}'$$, 'tenant_settings_reminder_offsets', 'a reminder at least 15 minutes before');
SELECT test.lives($$UPDATE tenant_settings SET reminder_offsets_minutes = '{2880,60}'$$, 'two days and one hour before is fine');
SELECT test.lives($$UPDATE tenant_settings SET reminder_offsets_minutes = '{}'$$, 'no reminders is allowed');

-- a move does not count the appointment being moved as busy
INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, status, source, booked_by) VALUES
 ('af000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
  '70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a1','2031-05-03 18:00+02','2031-05-03 18:30+02','confirmed','phone','c0000000-0000-0000-0000-0000000000a2');
SELECT test.ok((SELECT count(*) = 1 FROM doctor_busy_intervals(ARRAY['f0000000-0000-0000-0000-0000000000a1']::uuid[], '2031-05-03', '2031-05-04')),
  'the booking keeps the doctor busy');
SELECT test.ok((SELECT count(*) = 0 FROM doctor_busy_intervals(ARRAY['f0000000-0000-0000-0000-0000000000a1']::uuid[], '2031-05-03', '2031-05-04',
  'af000000-0000-0000-0000-000000000001')), 'but not when that same booking is being moved');
SELECT test.lives($$UPDATE appointments SET starts_at = '2031-05-03 18:15+02', ends_at = '2031-05-03 18:45+02' WHERE id = 'af000000-0000-0000-0000-000000000001'$$,
  'a booking can be moved onto part of its own old time');

-- rooms: in the appointment's branch, never double-booked
SELECT test.throws($$UPDATE appointments SET room_id = 'e0000000-0000-0000-0000-0000000000a3' WHERE id = 'af000000-0000-0000-0000-000000000001'$$,
  'foreign key', 'a Maadi chair cannot be given to a Nasr City booking');
UPDATE appointments SET room_id = 'e0000000-0000-0000-0000-0000000000a1' WHERE id = 'af000000-0000-0000-0000-000000000001';
SELECT test.throws($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, room_id, starts_at, ends_at, status, source, booked_by) VALUES
  ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a2','f0000000-0000-0000-0000-0000000000a2',
  'e0000000-0000-0000-0000-0000000000a1','2031-05-03 18:30+02','2031-05-03 19:00+02','confirmed','phone','c0000000-0000-0000-0000-0000000000a2')$$,
  'appointments_no_room_overlap', 'the same chair cannot be booked twice at overlapping times');
ROLLBACK;
