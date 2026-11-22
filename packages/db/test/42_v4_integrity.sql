-- Schema v4 audit, phase 2 (docs/database/schema-v3-audit.md): INT-01 (a schedule is at one of the doctor's branches),
-- SCH-02 (only an appointment not yet under way moves) and PERF-01 (the data_exports policy uses its index). Scenario 4
-- of the brief: a doctor cannot be put to work at a branch they are not assigned to. Every block is rolled back.
\set ON_ERROR_STOP 1

-- ---------------------------------------------------------------------------------------------------------------
-- INT-01 / scenario 4: Dr Ahmed works at Nasr City only; Dr Mona at Nasr City and Maadi
-- ---------------------------------------------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a1';
SET CONSTRAINTS doctor_schedules_doctor_branch_fk IMMEDIATE; -- the check normally waits for COMMIT: see it here
SELECT test.throws($$INSERT INTO doctor_schedules (tenant_id, doctor_id, branch_id, weekday, starts_at, ends_at)
  VALUES ('11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a2', 3, '09:00', '10:00')$$,
  'doctor_schedules_doctor_branch_fk', 'Dr Ahmed cannot be scheduled at Maadi, where he does not work');
SELECT test.lives($$INSERT INTO doctor_schedules (tenant_id, doctor_id, branch_id, weekday, starts_at, ends_at)
  VALUES ('11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-0000000000a2', 3, '09:00', '10:00')$$,
  'Dr Mona can, she works there');
SELECT test.throws($$UPDATE doctor_schedules SET doctor_id = 'f0000000-0000-0000-0000-0000000000a1'
  WHERE doctor_id = 'f0000000-0000-0000-0000-0000000000a2' AND branch_id = 'd0000000-0000-0000-0000-0000000000a2'$$,
  'doctor_schedules_doctor_branch_fk', 'nor is a Maadi schedule handed to Dr Ahmed');
SELECT test.throws($$DELETE FROM doctor_branches WHERE doctor_id = 'f0000000-0000-0000-0000-0000000000a2' AND branch_id = 'd0000000-0000-0000-0000-0000000000a2'$$,
  'doctor_schedules_doctor_branch_fk', 'taking Maadi from Dr Mona while her Maadi schedule stays is refused');
ROLLBACK;

-- what the API does (doctors.repository.ts replaceBranches): drop every link, drop the schedules of the removed
-- branches, link the kept ones again; checked at COMMIT, so it goes through
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a1';
INSERT INTO doctor_schedules (tenant_id, doctor_id, branch_id, weekday, starts_at, ends_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-0000000000a2', 3, '09:00', '10:00');
SELECT count(*) AS nasr_shifts FROM doctor_schedules
 WHERE doctor_id = 'f0000000-0000-0000-0000-0000000000a2' AND branch_id = 'd0000000-0000-0000-0000-0000000000a1' \gset
DELETE FROM doctor_branches WHERE doctor_id = 'f0000000-0000-0000-0000-0000000000a2';
DELETE FROM doctor_schedules WHERE doctor_id = 'f0000000-0000-0000-0000-0000000000a2' AND branch_id NOT IN ('d0000000-0000-0000-0000-0000000000a1');
INSERT INTO doctor_branches (tenant_id, doctor_id, branch_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-0000000000a1');
SELECT test.lives($$SET CONSTRAINTS doctor_schedules_doctor_branch_fk IMMEDIATE$$,
  'removing a branch the API''s way (links dropped and the kept ones linked again) passes the check');
SELECT test.ok((SELECT count(*) = :nasr_shifts FROM doctor_schedules
  WHERE doctor_id = 'f0000000-0000-0000-0000-0000000000a2' AND branch_id = 'd0000000-0000-0000-0000-0000000000a1'),
  'and keeps the schedule of the branch she still has');
ROLLBACK;

-- ---------------------------------------------------------------------------------------------------------------
-- SCH-02: an appointment under way, finished or closed keeps its time, doctor and branch
-- ---------------------------------------------------------------------------------------------------------------
BEGIN;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, status, source, booked_by,
                          check_in_method, checked_in_at, completed_at, cancelled_at, cancel_reason, cancelled_by) VALUES
  ('42a00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1',
   '70000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000a2', '2031-06-01 09:00+02', '2031-06-01 09:30+02',
   'pending', 'dashboard', 'c0000000-0000-0000-0000-0000000000a2', NULL, NULL, NULL, NULL, NULL, NULL),
  ('42a00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1',
   '70000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000a2', '2031-06-01 10:00+02', '2031-06-01 10:30+02',
   'completed', 'dashboard', 'c0000000-0000-0000-0000-0000000000a2', 'walk_in', now(), now(), NULL, NULL, NULL),
  ('42a00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1',
   '70000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000a2', '2031-06-01 11:00+02', '2031-06-01 11:30+02',
   'cancelled', 'dashboard', 'c0000000-0000-0000-0000-0000000000a2', NULL, NULL, NULL, now(), 'e2e', 'clinic'),
  ('42a00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1',
   '70000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000a2', '2031-06-01 12:00+02', '2031-06-01 12:30+02',
   'checked_in', 'dashboard', 'c0000000-0000-0000-0000-0000000000a2', 'walk_in', now(), NULL, NULL, NULL, NULL);
SET LOCAL ROLE app_user;
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a2';
SELECT test.lives($$UPDATE appointments SET starts_at = '2031-06-02 09:00+02', ends_at = '2031-06-02 09:30+02'
  WHERE id = '42a00000-0000-0000-0000-000000000001'$$, 'a pending appointment moves');
SELECT test.throws($$UPDATE appointments SET starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day'
  WHERE id = '42a00000-0000-0000-0000-000000000002'$$, 'keeps its time', 'a completed one does not');
SELECT test.throws($$UPDATE appointments SET starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day'
  WHERE id = '42a00000-0000-0000-0000-000000000003'$$, 'keeps its time', 'nor a cancelled one');
SELECT test.throws($$UPDATE appointments SET doctor_id = 'f0000000-0000-0000-0000-0000000000a1'
  WHERE id = '42a00000-0000-0000-0000-000000000004'$$, 'keeps its time', 'nor is a checked-in patient given another doctor');
SELECT test.lives($$UPDATE appointments SET status = 'in_progress' WHERE id = '42a00000-0000-0000-0000-000000000004'$$,
  'status changes go on as before');
SELECT test.lives($$UPDATE appointments SET internal_notes = 'x', room_id = NULL WHERE id = '42a00000-0000-0000-0000-000000000002'$$,
  'and so do notes and rooms on a finished one');
RESET ROLE;
SELECT test.throws($$UPDATE appointments SET starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour'
  WHERE id = '42a00000-0000-0000-0000-000000000002'$$, 'keeps its time', 'the rule holds for every role, not only the API');
ROLLBACK;

-- ---------------------------------------------------------------------------------------------------------------
-- PERF-01: the data_exports policy is the indexable form, and still isolates clinics
-- ---------------------------------------------------------------------------------------------------------------
BEGIN;
SELECT test.ok((SELECT pg_get_expr(polqual, polrelid) = '(tenant_id = current_tenant_id())' FROM pg_policy
  WHERE polrelid = 'data_exports'::regclass AND polname = 'tenant_isolation'), 'the data_exports policy compares with "="');
INSERT INTO data_exports (tenant_id, requested_by) VALUES ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SELECT test.ok(NOT EXISTS (SELECT 1 FROM data_exports), 'clinic B sees no export of clinic A');
SET LOCAL app.tenant_id = '';
SELECT test.ok(NOT EXISTS (SELECT 1 FROM data_exports), 'and with no clinic set nothing is visible');
ROLLBACK;
