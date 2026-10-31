-- Phase 2E: a patient moving their booking from their link.
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SELECT set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true);
INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, status, confirmed_at, booked_by, manage_token_hash)
VALUES ('ae000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-0000000000a1',
        'f0000000-0000-0000-0000-0000000000a1', '2031-03-04 17:00+02', '2031-03-04 17:30+02', 'phone', 'confirmed', now(), 'c0000000-0000-0000-0000-0000000000a2', 'h-self-service-1');
SELECT test.ok((SELECT patient_reschedules = 0 FROM appointments WHERE id = 'ae000000-0000-0000-0000-000000000001'), 'a booking starts with no patient moves');
SELECT test.throws($$UPDATE appointments SET status = 'pending' WHERE id = 'ae000000-0000-0000-0000-000000000001'$$,
  'cannot go from confirmed to pending', 'nothing un-confirms a booking at the same time');
SELECT test.lives($$UPDATE appointments SET status = 'pending', starts_at = '2031-03-05 17:00+02', ends_at = '2031-03-05 17:30+02', patient_reschedules = patient_reschedules + 1
  WHERE id = 'ae000000-0000-0000-0000-000000000001'$$, 'a confirmed booking moved to a new time may wait for confirmation again');
SELECT test.ok((SELECT confirmed_at IS NULL AND patient_reschedules = 1 FROM appointments WHERE id = 'ae000000-0000-0000-0000-000000000001'),
  'its old confirmation is cleared, the move counted');
SELECT test.throws($$UPDATE appointments SET patient_reschedules = -1 WHERE id = 'ae000000-0000-0000-0000-000000000001'$$, 'appointments_patient_reschedules', 'never negative');
ROLLBACK;
