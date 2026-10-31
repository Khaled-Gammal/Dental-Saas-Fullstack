-- Phase D1: invitations, member management, access versions, staff/setup audit (SRS ACCESS-001/002/005, AUDIT-003)
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-0000000000a1';

-- the last active owner can be neither disabled nor demoted
SELECT test.throws($$UPDATE tenant_members SET status = 'disabled' WHERE id = 'c0000000-0000-0000-0000-0000000000a1'$$,
  'at least one active owner', 'the only owner cannot be disabled');
SELECT test.throws($$UPDATE tenant_members SET role_id = 'a0000000-0000-0000-0000-0000000000a2' WHERE id = 'c0000000-0000-0000-0000-0000000000a1'$$,
  'at least one active owner', 'the only owner cannot be demoted');
SELECT test.throws($$DELETE FROM tenant_members WHERE id = 'c0000000-0000-0000-0000-0000000000a1'$$,
  'permission denied', 'the only owner cannot be removed (members are disabled, never deleted by the API: review R11)');

-- access version: role, status and branch changes bump it; other edits do not
SELECT access_version AS v0 FROM tenant_members WHERE id = 'c0000000-0000-0000-0000-0000000000a2' \gset
UPDATE tenant_members SET job_title = 'Front desk' WHERE id = 'c0000000-0000-0000-0000-0000000000a2';
SELECT test.ok((SELECT access_version = :v0 FROM tenant_members WHERE id = 'c0000000-0000-0000-0000-0000000000a2'), 'a job title edit keeps the access version');
UPDATE tenant_members SET all_branches = false WHERE id = 'c0000000-0000-0000-0000-0000000000a2';
INSERT INTO member_branches (tenant_id, member_id, branch_id)
VALUES ('11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-0000000000a2','d0000000-0000-0000-0000-0000000000a1');
SELECT test.ok((SELECT access_version = :v0 + 2 FROM tenant_members WHERE id = 'c0000000-0000-0000-0000-0000000000a2'),
  'limiting to branches and adding a branch each bump the access version');
SELECT test.ok((SELECT access_version = :v0 + 2 AND status = 'active' AND tenant_id = '11111111-1111-1111-1111-111111111111'
  FROM member_access_state('c0000000-0000-0000-0000-0000000000a2')), 'member_access_state reports clinic, status and version');

-- a second owner makes it possible to step down
UPDATE tenant_members SET role_id = 'a0000000-0000-0000-0000-0000000000a1' WHERE id = 'c0000000-0000-0000-0000-0000000000a2';
SELECT test.lives($$UPDATE tenant_members SET status = 'disabled' WHERE id = 'c0000000-0000-0000-0000-0000000000a1'$$,
  'with another active owner, an owner can be disabled');

-- staff and setup changes are audited, without bookkeeping columns
SELECT test.ok((SELECT count(*) = 1 FROM audit_log WHERE entity_id = 'c0000000-0000-0000-0000-0000000000a2' AND action = 'member.update'
  AND changes ? 'role_id' AND NOT changes ? 'access_version' AND actor_user_id = 'b0000000-0000-0000-0000-0000000000a1'),
  'a role change is audited with who made it');
UPDATE tenants SET name_en = 'Smile Dental' WHERE id = '11111111-1111-1111-1111-111111111111';
SELECT test.ok((SELECT count(*) = 1 FROM audit_log WHERE action = 'clinic.update' AND entity_id = '11111111-1111-1111-1111-111111111111'
  AND tenant_id = '11111111-1111-1111-1111-111111111111' AND changes -> 'name_en' = '["Smile Dental Clinic", "Smile Dental"]'::jsonb),
  'a clinic profile change is audited');
UPDATE services SET price_minor = 31000 WHERE id = '90000000-0000-0000-0000-0000000000a1';
SELECT test.ok((SELECT count(*) = 1 FROM audit_log WHERE action = 'service.update' AND changes -> 'price_minor' = '[30000, 31000]'::jsonb),
  'a price change is audited');
ROLLBACK;

-- invitations
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO invitations (id, tenant_id, email, role_id, branch_ids, token_hash, invited_by, expires_at, job_title, doctor_id) VALUES
 ('1f000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','new.staff@test.test','a0000000-0000-0000-0000-0000000000a2',
  '{d0000000-0000-0000-0000-0000000000a2}','hash-open','c0000000-0000-0000-0000-0000000000a1', now() + interval '7 days','Reception', NULL),
 ('1f000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','old.staff@test.test','a0000000-0000-0000-0000-0000000000a2',
  '{}','hash-expired','c0000000-0000-0000-0000-0000000000a1', now() - interval '1 minute', NULL, NULL);
SELECT test.ok((SELECT clinic_slug = 'clinic-a' AND role_key = 'receptionist' AND branch_ids = '{d0000000-0000-0000-0000-0000000000a2}'
  AND job_title = 'Reception' FROM open_invitation('hash-open')), 'an open invitation link resolves to its clinic, role and branches');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM open_invitation('hash-expired')), 'an expired link resolves to nothing');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM open_invitation('no-such-hash')), 'an unknown link resolves to nothing');
SELECT test.throws($$INSERT INTO invitations (tenant_id, email, role_id, token_hash, invited_by, expires_at)
  VALUES ('11111111-1111-1111-1111-111111111111','NEW.STAFF@test.test','a0000000-0000-0000-0000-0000000000a2','hash-2',
  'c0000000-0000-0000-0000-0000000000a1', now() + interval '7 days')$$, 'invitations_one_open_per_email',
  'one open invitation per email (case-insensitive)');
UPDATE invitations SET revoked_at = now() WHERE id = '1f000000-0000-0000-0000-000000000001';
SELECT test.ok(NOT EXISTS (SELECT 1 FROM open_invitation('hash-open')), 'a revoked link resolves to nothing');
SELECT test.lives($$INSERT INTO invitations (tenant_id, email, role_id, token_hash, invited_by, expires_at)
  VALUES ('11111111-1111-1111-1111-111111111111','new.staff@test.test','a0000000-0000-0000-0000-0000000000a2','hash-3',
  'c0000000-0000-0000-0000-0000000000a1', now() + interval '7 days')$$, 'after revoking, the same email can be invited again');
SELECT test.ok((SELECT changes -> 'token_hash' = 'true'::jsonb FROM audit_log WHERE action = 'invitation.create' ORDER BY id DESC LIMIT 1),
  'the token hash never appears in the audit trail');
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SELECT test.ok((SELECT count(*) FROM invitations) = 0, 'another clinic cannot see these invitations');
ROLLBACK;
