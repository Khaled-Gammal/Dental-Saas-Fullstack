-- Week 6: automatic no-show (SRS 4.10) and patient search index
\set ON_ERROR_STOP 1
BEGIN;

-- as the clinic: three appointments in the past for Dr. Ahmed (website bookings need no staff author)
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, status) VALUES
 ('a9000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
  '70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a1', now() - interval '4 hours', now() - interval '3 hours','website','confirmed'),
 ('a9000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
  '70000000-0000-0000-0000-0000000000a2','f0000000-0000-0000-0000-0000000000a1', now() - interval '90 minutes', now() - interval '1 hour','website','pending');
INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, status, check_in_method, check_in_note, checked_in_at) VALUES
 ('a9000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
  '70000000-0000-0000-0000-0000000000a2','f0000000-0000-0000-0000-0000000000a1', now() - interval '6 hours', now() - interval '5 hours','website','checked_in','manual','ID checked at the desk', now() - interval '6 hours');
SELECT test.throws($$SELECT mark_no_shows()$$, 'permission denied', 'the API role cannot run the cross-clinic sweep');
RESET ROLE;

-- the worker's sweep
SELECT test.ok(mark_no_shows() >= 1, 'the sweep marks something');
SELECT test.ok((SELECT status FROM appointments WHERE id = 'a9000000-0000-0000-0000-000000000001') = 'no_show', 'confirmed, ended 3 h ago, never arrived -> no_show');
SELECT test.ok((SELECT status FROM appointments WHERE id = 'a9000000-0000-0000-0000-000000000002') = 'pending', 'ended 1 h ago: still inside the 2 h grace');
SELECT test.ok((SELECT status FROM appointments WHERE id = 'a9000000-0000-0000-0000-000000000003') = 'checked_in', 'a patient who arrived is never a no-show');
SELECT test.ok(mark_no_shows() = 0, 'running it again changes nothing');

-- prefix search on the phone uses the new index
SET LOCAL enable_seqscan = off;
SELECT test.ok((SELECT count(*) FROM patients WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND phone LIKE '+20101%' AND deleted_at IS NULL) >= 1,
  'phone prefix search finds the seeded patient');

ROLLBACK;
