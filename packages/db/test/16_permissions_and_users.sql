-- Phase C: the permission catalogue (SRS B.1, ACCESS-004) and least privilege on user accounts (SEC-103)
\set ON_ERROR_STOP 1
BEGIN;
-- clinical and financial write rights never meet in a seeded role other than the owner
SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['doctor','receptionist','assistant','accountant']) r
  WHERE default_role_permissions(r) && ARRAY['clinical:write','treatments:write:own']
    AND default_role_permissions(r) && ARRAY['payments:write','payments:refund','payments:reverse','payments:adjust',
          'discounts:apply','discounts:approve','invoices:write','invoices:void','expenses:write','expenses:approve',
          'cash:operate','cash:reopen']), 'no seeded role holds both clinical and financial write rights');
SELECT test.ok(NOT ('payments:write' = ANY (default_role_permissions('doctor'))), 'a doctor cannot record payments');
SELECT test.ok(NOT (default_role_permissions('accountant') && ARRAY['clinical:read','clinical:write']), 'an accountant cannot read clinical data');
SELECT test.ok('payments:refund' = ANY (default_role_permissions('accountant')) AND NOT ('payments:refund' = ANY (default_role_permissions('receptionist'))),
  'refunds: accountant yes, receptionist no (CLR-05)');
SELECT test.ok('payments:reverse' = ANY (default_role_permissions('receptionist')), 'reception may reverse its own entries (CLR-05)');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM unnest(ARRAY['doctor','receptionist','assistant','accountant']) r
  WHERE default_role_permissions(r) && ARRAY['discounts:approve','expenses:approve','cash:reopen','payments:adjust']),
  'approving discounts and expenses, reopening a cash day and adjustments are the owner''s only (CLR-02/03/04/12)');
SELECT test.ok('cash:operate' = ANY (default_role_permissions('receptionist')) AND 'cash:operate' = ANY (default_role_permissions('accountant'))
  AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['doctor','receptionist','assistant']) r WHERE default_role_permissions(r) && ARRAY['expenses:read','expenses:write','expenses:write:cash']),
  'reception and the accountant run the cash box; expenses are the owner''s and the accountant''s only (CLR-04, owner 2026-10-20)');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM roles WHERE 'expenses:write:cash' = ANY (permissions)), 'no role keeps the retired reception expense right');
SELECT test.ok('patients:block' = ANY (default_role_permissions('receptionist')) AND NOT ('patients:block' = ANY (default_role_permissions('doctor'))),
  'blocking a patient is a reception right, not a doctor''s');
-- a new clinic starts with the owner role only (H4)
SET LOCAL app.tenant_id = '33333333-3333-3333-3333-333333333333';
SET LOCAL ROLE app_user;
INSERT INTO users (email, phone, full_name, password_hash) VALUES ('perm.owner@test.test', '+201234567890', 'Perm Owner', 'x');
SELECT * FROM provision_tenant('perm-clinic', 'عيادة', NULL, (SELECT id FROM users WHERE email = 'perm.owner@test.test'), 'lvh.me') \gset
SELECT test.ok((SELECT array_agg(key) = '{owner}' FROM roles), 'a new clinic has the owner role only');

-- password hashes are not readable by the API role
SELECT test.throws($$SELECT password_hash FROM users LIMIT 1$$, 'permission denied', 'the API role cannot read password hashes');
SELECT test.throws($$SELECT * FROM users LIMIT 1$$, 'permission denied', 'nor select every column');
SELECT test.lives($$SELECT id, email, phone, full_name, is_active, email_verified_at, phone_verified_at FROM users LIMIT 1$$,
  'the profile columns stay readable');
SELECT test.ok((SELECT password_hash LIKE 'scrypt$%' FROM login_candidate('owner.a@demo.test', NULL)), 'sign-in reads one hash through login_candidate');
SELECT test.ok((SELECT count(*) = 1 FROM login_candidate('nobody@demo.test', '+201000000112')), 'login_candidate also finds a user by phone');
SELECT test.ok((SELECT count(*) = 0 FROM login_candidate('nobody@demo.test', NULL)), 'and returns nothing for an unknown account');
ROLLBACK;
