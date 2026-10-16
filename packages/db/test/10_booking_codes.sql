-- Booking codes are cleared when the appointment can no longer use them (keeps appointments_open_code small)
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';

INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, status, check_in_code_hash, check_in_code_expires_at) VALUES
 ('ab100000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-0000000000a1', '2031-03-01 17:00+02', '2031-03-01 17:20+02','website','confirmed','code-a', '2031-03-01 23:59+02'),
 ('ab100000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a2',
  'f0000000-0000-0000-0000-0000000000a1', '2031-03-01 18:00+02', '2031-03-01 18:20+02','website','confirmed','code-b', '2031-03-01 23:59+02');

UPDATE appointments SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'clinic' WHERE id = 'ab100000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT check_in_code_hash IS NULL AND check_in_code_expires_at IS NULL FROM appointments WHERE id = 'ab100000-0000-0000-0000-000000000001'),
  'cancelling clears the booking code');
SELECT test.lives($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, status, check_in_code_hash, check_in_code_expires_at)
  VALUES ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a1',
  '2031-03-02 17:00+02','2031-03-02 17:20+02','website','confirmed','code-a','2031-03-02 23:59+02')$$, 'the freed code can be issued again');

UPDATE appointments SET status = 'no_show' WHERE id = 'ab100000-0000-0000-0000-000000000002';
SELECT test.ok((SELECT check_in_code_hash IS NULL FROM appointments WHERE id = 'ab100000-0000-0000-0000-000000000002'), 'a no-show clears the booking code');

-- a used code is history: it stays on the record even if the visit is cancelled afterwards
SELECT test.ok((SELECT count(*) FROM check_in_by_code('code-a','d0000000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-0000000000a2')) = 1,
  'the re-issued code checks the patient in');
UPDATE appointments SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'clinic', cancel_reason = 'left before treatment'
WHERE check_in_code_hash = 'code-a';
SELECT test.ok((SELECT check_in_code_used_at IS NOT NULL FROM appointments WHERE check_in_code_hash = 'code-a'), 'a used code is kept as history');
ROLLBACK;
