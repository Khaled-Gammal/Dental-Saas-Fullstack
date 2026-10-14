-- Booking: holds, double booking, statuses, staff bookings (SRS 4.5, 4.10, BOOK-09/10/18-22)
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';

-- website hold (no patient yet) blocks the slot
INSERT INTO appointments (id, tenant_id, branch_id, doctor_id, starts_at, ends_at, source, status, hold_expires_at)
VALUES ('ad000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
        'f0000000-0000-0000-0000-0000000000a1','2030-01-05 17:00+02','2030-01-05 17:30+02','website','held', now() + interval '10 minutes');
SELECT test.throws($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, booked_by)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-0000000000a1','2030-01-05 17:15+02','2030-01-05 17:45+02','phone','c0000000-0000-0000-0000-0000000000a2')$$,
  'appointments_no_doctor_overlap', 'a held slot blocks an overlapping booking');
SELECT test.throws($$INSERT INTO appointments (tenant_id, branch_id, doctor_id, starts_at, ends_at, source)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a2',
  '2030-01-05 18:00+02','2030-01-05 18:30+02','website')$$, 'check constraint', 'a pending booking needs a patient');

-- the hold expires and the slot frees up
UPDATE appointments SET hold_expires_at = now() - interval '1 minute' WHERE id = 'ad000000-0000-0000-0000-000000000001';
SELECT test.ok(release_expired_holds('f0000000-0000-0000-0000-0000000000a1') = 1, 'expired hold is released');
SELECT test.lives($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, status, booked_by)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-0000000000a1','2030-01-05 17:00+02','2030-01-05 17:30+02','phone','confirmed','c0000000-0000-0000-0000-0000000000a2')$$,
  'receptionist books the freed slot by phone');

-- staff bookings must name the staff member; website bookings must not
SELECT test.throws($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-0000000000a2','2030-01-06 17:00+02','2030-01-06 17:30+02','phone')$$, 'check constraint',
  'staff booking without booked_by is rejected');
SELECT test.throws($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, booked_by)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-0000000000a2','2030-01-06 17:00+02','2030-01-06 17:30+02','website','c0000000-0000-0000-0000-0000000000a2')$$,
  'check constraint', 'website booking cannot claim a staff author');

-- room must belong to the booking's branch
SELECT test.throws($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, room_id, starts_at, ends_at, source, booked_by)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-0000000000a2','e0000000-0000-0000-0000-0000000000a3','2030-01-06 17:00+02','2030-01-06 17:30+02','dashboard',
  'c0000000-0000-0000-0000-0000000000a2')$$, 'foreign key', 'a room from another branch is rejected');

-- walk-in: booked and checked in in one step; then the status machine
SELECT test.lives($$INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, status, booked_by,
  checked_in_at, check_in_method, checked_in_by)
  VALUES ('ad000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
  '70000000-0000-0000-0000-0000000000a2','f0000000-0000-0000-0000-0000000000a2','2030-01-06 19:00+02','2030-01-06 19:30+02','walk_in',
  'checked_in','c0000000-0000-0000-0000-0000000000a2', now(), 'walk_in','c0000000-0000-0000-0000-0000000000a2')$$, 'walk-in booked and checked in at once');
UPDATE appointments SET status = 'completed', completed_at = now() WHERE id = 'ad000000-0000-0000-0000-000000000002';
SELECT test.throws($$UPDATE appointments SET status = 'held', hold_expires_at = now() WHERE id = 'ad000000-0000-0000-0000-000000000002'$$,
  'cannot go from completed to held', 'completed booking cannot go back to held');

-- override outside hours needs staff + reason, and never allows double booking
SELECT test.throws($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, booked_by, override_reason)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a2',
  'f0000000-0000-0000-0000-0000000000a1','2030-01-05 17:10+02','2030-01-05 17:20+02','dashboard','c0000000-0000-0000-0000-0000000000a2','emergency')$$,
  'appointments_no_doctor_overlap', 'override never allows a double booking');
ROLLBACK;
