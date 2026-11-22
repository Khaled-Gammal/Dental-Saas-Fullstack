-- Schema v4 audit, phase 1 (docs/database/schema-v3-audit.md): SEC-01…06, SEC-08, and the brief's scenarios 2, 3, 8,
-- 9 and 11. Everything runs as the API role (app_user) unless it says otherwise, and every block is rolled back.
\set ON_ERROR_STOP 1

-- ---------------------------------------------------------------------------------------------------------------
-- SEC-02 / scenario 8: nobody but an owner gives or takes the owner role, or widens their own access
-- ---------------------------------------------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-0000000000a2';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a2'; -- Rana, receptionist (not an owner)
SELECT test.throws($$UPDATE tenant_members SET role_id = 'a0000000-0000-0000-0000-0000000000a1' WHERE id = 'c0000000-0000-0000-0000-0000000000a2'$$,
  'only an owner', 'a receptionist cannot make herself owner');
SELECT test.throws($$UPDATE tenant_members SET role_id = 'a0000000-0000-0000-0000-0000000000a1' WHERE id = 'c0000000-0000-0000-0000-0000000000a5'$$,
  'only an owner', 'nor make someone else owner');
SELECT test.throws($$UPDATE tenant_members SET status = 'disabled' WHERE id = 'c0000000-0000-0000-0000-0000000000a2'$$,
  'own role, status or branches', 'nor change her own status');
SELECT test.throws($$UPDATE tenant_members SET all_branches = false WHERE id = 'c0000000-0000-0000-0000-0000000000a2'$$,
  'own role, status or branches', 'nor her own branches');
SELECT test.throws($$INSERT INTO invitations (tenant_id, email, role_id, token_hash, invited_by, expires_at)
  VALUES ('11111111-1111-1111-1111-111111111111', 'boss@test.test', 'a0000000-0000-0000-0000-0000000000a1', 'h-41-1',
  'c0000000-0000-0000-0000-0000000000a2', now() + interval '7 days')$$, 'only an owner', 'nor invite someone as owner');
SELECT test.throws($$UPDATE roles SET permissions = permissions || '{audit:read,payments:refund}' WHERE id = 'a0000000-0000-0000-0000-0000000000a2'$$,
  'does not change their own role', 'nor widen the role she holds');
SELECT test.lives($$UPDATE tenant_members SET role_id = 'a0000000-0000-0000-0000-0000000000a3' WHERE id = 'c0000000-0000-0000-0000-0000000000a5'$$,
  'a non-owner manager still changes another non-owner''s role (the API checks what she may give)');
SELECT test.lives($$UPDATE roles SET permissions = permissions || '{audit:read}' WHERE id = 'a0000000-0000-0000-0000-0000000000a4'$$,
  'and edits a role she does not hold');
SET LOCAL app.member_id = '';
SELECT test.throws($$UPDATE roles SET permissions = '{patients:read}' WHERE id = 'a0000000-0000-0000-0000-0000000000a4'$$,
  'only on a member', 'role permissions change only on a member''s request');
SELECT test.lives($$UPDATE roles SET max_discount_bp = 500 WHERE id = 'a0000000-0000-0000-0000-0000000000a2'$$,
  'other role columns are not affected');
ROLLBACK;

-- the owner still does all of it; a second owner can then be managed by an owner only
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-0000000000a1';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a1'; -- Dr Ahmed, owner
SELECT test.lives($$INSERT INTO invitations (tenant_id, email, role_id, token_hash, invited_by, expires_at)
  VALUES ('11111111-1111-1111-1111-111111111111', 'partner@test.test', 'a0000000-0000-0000-0000-0000000000a1', 'h-41-2',
  'c0000000-0000-0000-0000-0000000000a1', now() + interval '7 days')$$, 'an owner invites an owner');
SELECT test.lives($$UPDATE tenant_members SET role_id = 'a0000000-0000-0000-0000-0000000000a1' WHERE id = 'c0000000-0000-0000-0000-0000000000a5'$$,
  'an owner makes a member owner');
SELECT test.lives($$UPDATE roles SET permissions = permissions || '{reports:read}' WHERE id = 'a0000000-0000-0000-0000-0000000000a2'$$,
  'an owner edits any role');
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a2';
SELECT test.throws($$UPDATE tenant_members SET status = 'disabled' WHERE id = 'c0000000-0000-0000-0000-0000000000a5'$$,
  'only an owner', 'a non-owner cannot disable an owner, even with another owner left');
SELECT test.throws($$UPDATE tenant_members SET role_id = 'a0000000-0000-0000-0000-0000000000a3' WHERE id = 'c0000000-0000-0000-0000-0000000000a5'$$,
  'only an owner', 'nor take the owner role away');
ROLLBACK;

-- accepting an owner invitation (no member in the context yet) works; a bare insert of an owner does not
BEGIN;
INSERT INTO users (id, email, full_name, password_hash) VALUES
  ('b0000000-0000-0000-0000-000000000411', 'partner@test.test', 'Dr. Partner', 'x'),
  ('b0000000-0000-0000-0000-000000000412', 'intruder@test.test', 'Intruder', 'x');
INSERT INTO invitations (id, tenant_id, email, role_id, token_hash, invited_by, expires_at) VALUES
  ('41000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'partner@test.test', 'a0000000-0000-0000-0000-0000000000a1',
   'h-41-3', 'c0000000-0000-0000-0000-0000000000a1', now() + interval '7 days');
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-000000000412';
SELECT test.throws($$INSERT INTO tenant_members (tenant_id, user_id, role_id)
  VALUES ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000412', 'a0000000-0000-0000-0000-0000000000a1')$$,
  'only an owner', 'an owner is not added without an owner or an invitation');
UPDATE invitations SET accepted_at = now() WHERE id = '41000000-0000-0000-0000-000000000001'; -- claimInvitation
SELECT test.throws($$INSERT INTO tenant_members (tenant_id, user_id, role_id)
  VALUES ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000412', 'a0000000-0000-0000-0000-0000000000a1')$$,
  'only an owner', 'an invitation claimed for one email does not let another account in as owner');
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-000000000411';
SELECT test.lives($$INSERT INTO tenant_members (tenant_id, user_id, role_id)
  VALUES ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000411', 'a0000000-0000-0000-0000-0000000000a1')$$,
  'the invited partner joins as owner when the invitation is claimed in the same transaction');
ROLLBACK;

-- ---------------------------------------------------------------------------------------------------------------
-- SEC-03 / SEC-04 / SEC-08 / scenario 11: platform-controlled tables
-- ---------------------------------------------------------------------------------------------------------------
BEGIN;
INSERT INTO usage_counters (tenant_id, metric, period_start, value) VALUES ('11111111-1111-1111-1111-111111111111', 'sms', '2026-11-01', 7);
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SELECT test.throws($$INSERT INTO domains (tenant_id, hostname, type, status, verified_at)
  VALUES ('11111111-1111-1111-1111-111111111111', 'drahmed-41.com', 'custom', 'active', now())$$, 'own subdomain, at sign-up',
  'a clinic cannot add itself a live custom domain');
SELECT test.throws($$INSERT INTO domains (tenant_id, hostname, type, status)
  VALUES ('11111111-1111-1111-1111-111111111111', 'clinic-a.example.com', 'subdomain', 'active')$$, 'own subdomain, at sign-up',
  'nor a second subdomain once it has one');
SELECT test.ok(domain_allowed_for_tls('drahmed-41.com') IS FALSE, 'so no certificate is issued for it');
SELECT test.throws($$INSERT INTO subscriptions (tenant_id, plan_id, status) SELECT '11111111-1111-1111-1111-111111111111', id, 'cancelled' FROM plans WHERE code = 'pro'$$,
  'only the sign-up trial', 'a clinic cannot add itself a subscription');
SELECT test.throws($$INSERT INTO usage_counters (tenant_id, metric, period_start) VALUES ('11111111-1111-1111-1111-111111111111', 'sms', '2026-12-01')$$,
  'permission denied', 'nor write usage counters');
SELECT test.throws($$INSERT INTO schema_migrations (version) VALUES ('29991231000099')$$, 'permission denied',
  'the API role cannot touch the migration ledger');
SELECT test.throws($$SELECT count(*) FROM schema_migrations$$, 'permission denied', 'nor read it');
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SELECT test.ok(NOT EXISTS (SELECT 1 FROM usage_counters), 'clinic B sees no usage counter of clinic A');
SELECT test.throws($$UPDATE usage_counters SET value = 0$$, 'permission denied', 'and cannot change any');
RESET ROLE;
SET LOCAL ROLE app_worker;
SELECT test.throws($$INSERT INTO schema_migrations (version) VALUES ('29991231000099')$$, 'permission denied',
  'the worker role cannot touch the migration ledger either');
ROLLBACK;

-- ---------------------------------------------------------------------------------------------------------------
-- SEC-05 / scenario 9: patient files are never public, and never another clinic's
-- ---------------------------------------------------------------------------------------------------------------
BEGIN;
INSERT INTO files (id, tenant_id, bucket, object_key, mime_type, size_bytes, kind, is_private) VALUES
  ('41f00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'private', 'a/41/xray.png', 'image/png', 10, 'xray', true),
  ('41f00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'private', 'a/41/doc.pdf', 'application/pdf', 10, 'document', true);
INSERT INTO patient_files (tenant_id, patient_id, file_id) VALUES
  ('11111111-1111-1111-1111-111111111111', '70000000-0000-0000-0000-0000000000a1', '41f00000-0000-0000-0000-000000000001');
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SELECT test.throws($$UPDATE tenants SET logo_file_id = '41f00000-0000-0000-0000-000000000001' WHERE id = '11111111-1111-1111-1111-111111111111'$$,
  'cannot be shown on the website', 'an x-ray cannot become the clinic logo');
SELECT test.throws($$UPDATE doctors SET photo_file_id = '41f00000-0000-0000-0000-000000000002' WHERE id = 'f0000000-0000-0000-0000-0000000000a1'$$,
  'cannot be shown on the website', 'nor a document a doctor photo');
SELECT test.throws($$UPDATE services SET image_file_id = '41f00000-0000-0000-0000-000000000001' WHERE id = '90000000-0000-0000-0000-0000000000a1'$$,
  'cannot be shown on the website', 'nor a service image');
SELECT test.throws($$UPDATE branches SET photo_file_id = '41f00000-0000-0000-0000-000000000001' WHERE id = 'd0000000-0000-0000-0000-0000000000a1'$$,
  'cannot be shown on the website', 'nor a branch photo');
SELECT test.throws($$UPDATE sites SET share_file_id = '41f00000-0000-0000-0000-000000000001'$$, 'cannot be shown on the website', 'nor the share image of the site');
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SELECT test.ok(NOT EXISTS (SELECT 1 FROM files WHERE id IN ('41f00000-0000-0000-0000-000000000001', '41f00000-0000-0000-0000-000000000002')),
  'clinic B does not see clinic A''s files');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM patient_files), 'nor its patient files');
SELECT test.throws($$INSERT INTO patient_files (tenant_id, patient_id, file_id)
  VALUES ('22222222-2222-2222-2222-222222222222', '70000000-0000-0000-0000-0000000000b1', '41f00000-0000-0000-0000-000000000001')$$,
  'foreign key', 'nor attaches clinic A''s x-ray to its own patient');
SELECT test.ok(file_is_public('41f00000-0000-0000-0000-000000000001') IS FALSE, 'nor is it public to clinic B''s website');
RESET ROLE;
-- even with the guards switched off (a restore, a manual fix), file_is_public() never publishes a clinical file
SET LOCAL session_replication_role = replica;
UPDATE tenants SET logo_file_id = '41f00000-0000-0000-0000-000000000001' WHERE id = '11111111-1111-1111-1111-111111111111';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SELECT test.ok(file_is_public('41f00000-0000-0000-0000-000000000001') IS FALSE, 'an x-ray used as the logo is still not public');
ROLLBACK;

-- ---------------------------------------------------------------------------------------------------------------
-- SEC-01: a clinic is deleted only from inside its own request, by its signed-in owner
-- ---------------------------------------------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE app_user;
SELECT test.throws($$SELECT request_clinic_deletion('b0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222')$$,
  'only the clinic owner', 'no clinic context: refused, even with the right owner id');
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-0000000000a1';
SELECT test.throws($$SELECT request_clinic_deletion('b0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222')$$,
  'only the clinic owner', 'clinic A''s owner cannot delete clinic B');
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SELECT test.throws($$SELECT request_clinic_deletion('b0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222')$$,
  'only the clinic owner', 'nor by naming clinic B''s owner from clinic B''s context');
RESET ROLE;
SELECT test.ok((SELECT status <> 'cancelled' FROM tenants WHERE id = '22222222-2222-2222-2222-222222222222'), 'clinic B is untouched');
ROLLBACK;

-- ---------------------------------------------------------------------------------------------------------------
-- SEC-06: the per-request check knows when the account itself is deactivated
-- ---------------------------------------------------------------------------------------------------------------
BEGIN;
UPDATE users SET is_active = false WHERE id = 'b0000000-0000-0000-0000-0000000000a2';
SET LOCAL ROLE app_user;
SELECT test.ok((SELECT user_active IS FALSE AND status = 'active' FROM member_access_state('c0000000-0000-0000-0000-0000000000a2')),
  'member_access_state reports a deactivated account (the member row is still active)');
SELECT test.ok((SELECT user_active FROM member_access_state('c0000000-0000-0000-0000-0000000000a1')), 'and an active one');
ROLLBACK;

-- ---------------------------------------------------------------------------------------------------------------
-- Scenario 2: clinic B cannot read, change or remove clinic A's appointments
-- ---------------------------------------------------------------------------------------------------------------
BEGIN;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, booked_by)
VALUES ('41a00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1',
        '70000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000a1', '2031-04-01 09:00+02', '2031-04-01 09:30+02',
        'dashboard', 'c0000000-0000-0000-0000-0000000000a2');
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000b1';
SELECT test.ok(NOT EXISTS (SELECT 1 FROM appointments WHERE id = '41a00000-0000-0000-0000-000000000001'), 'clinic B does not see it');
UPDATE appointments SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'x' WHERE id = '41a00000-0000-0000-0000-000000000001';
SELECT test.throws($$DELETE FROM appointments WHERE id = '41a00000-0000-0000-0000-000000000001'$$, 'permission denied', 'nor deletes it');
SELECT test.throws($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, booked_by)
  VALUES ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-0000000000a1', '2031-04-02 09:00+02', '2031-04-02 09:30+02', 'dashboard', 'c0000000-0000-0000-0000-0000000000b1')$$,
  'not active at this branch', 'nor books into clinic A (from clinic B its doctor does not exist)');
SELECT test.throws($$INSERT INTO patients (tenant_id, file_no, full_name, phone) VALUES ('11111111-1111-1111-1111-111111111111', 99041, 'X', '+201000000041')$$,
  'row-level security', 'nor writes any row into clinic A');
RESET ROLE;
SELECT test.ok((SELECT status = 'pending' FROM appointments WHERE id = '41a00000-0000-0000-0000-000000000001'),
  'its update from clinic B changed nothing');
ROLLBACK;

-- ---------------------------------------------------------------------------------------------------------------
-- Scenario 3: one login works in two clinics, with a different role and only that clinic's data in each
-- ---------------------------------------------------------------------------------------------------------------
BEGIN;
INSERT INTO roles (id, tenant_id, key, name_en, name_ar, permissions)
VALUES ('a0000000-0000-0000-0000-0000000004b1', '22222222-2222-2222-2222-222222222222', 'custom-41', 'Visiting doctor', 'طبيب زائر', '{patients:read}');
INSERT INTO tenant_members (id, tenant_id, user_id, role_id)
VALUES ('c0000000-0000-0000-0000-0000000004b1', '22222222-2222-2222-2222-222222222222', 'b0000000-0000-0000-0000-0000000000a3',
        'a0000000-0000-0000-0000-0000000004b1');
SET LOCAL ROLE app_user;
SELECT test.ok((SELECT count(*) = 2 AND count(DISTINCT role_key) = 2 FROM memberships_for_user('b0000000-0000-0000-0000-0000000000a3')),
  'Dr Mona belongs to two clinics, with a role in each');
SELECT test.ok((SELECT tenant_id = '22222222-2222-2222-2222-222222222222' FROM member_access_state('c0000000-0000-0000-0000-0000000004b1'))
  AND (SELECT tenant_id = '11111111-1111-1111-1111-111111111111' FROM member_access_state('c0000000-0000-0000-0000-0000000000a3')),
  'each membership names its own clinic (the token''s clinic must match it)');
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000004b1';
SELECT test.ok((SELECT count(*) = 1 AND bool_and(tenant_id = '22222222-2222-2222-2222-222222222222') FROM patients),
  'in clinic B she sees clinic B''s patients only');
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a3';
SELECT test.ok((SELECT bool_and(tenant_id = '11111111-1111-1111-1111-111111111111') FROM patients) AND (SELECT count(*) > 0 FROM patients),
  'in clinic A, clinic A''s only');
ROLLBACK;
