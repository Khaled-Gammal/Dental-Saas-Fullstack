-- Self-service sign-up: provision_tenant builds a complete clinic (SRS AUTH-03, ONB)
\set ON_ERROR_STOP 1
BEGIN;
-- the users table has no RLS; the API inserts the owner in the same transaction
INSERT INTO users (id, email, phone, full_name, password_hash)
VALUES ('b0000000-0000-0000-0000-0000000000c1','new.owner@demo.test','+201000000301','Dr. New Owner','x');
SET LOCAL ROLE app_user;
SELECT test.ok(slug_available('bright-smile'), 'free subdomain is available');
SELECT test.ok(NOT slug_available('clinic-a'), 'taken subdomain is not available (without seeing clinic A)');
SELECT test.ok(NOT slug_available('admin'), 'reserved subdomain is not available');
SELECT test.ok(NOT slug_available('Bad_Slug'), 'invalid subdomain is not available');

SELECT test.throws($$SELECT * FROM provision_tenant('bright-smile','عيادة','Clinic','b0000000-0000-0000-0000-0000000000c1','lvh.me')$$,
  'set app.tenant_id', 'provisioning needs the new clinic id set first');

SET LOCAL app.tenant_id = 'cccccccc-0000-0000-0000-000000000001';
SELECT test.throws($$SELECT * FROM provision_tenant('api','عيادة','Clinic','b0000000-0000-0000-0000-0000000000c1','lvh.me')$$,
  'reserved', 'reserved subdomain rejected');

CREATE TEMP TABLE p AS SELECT * FROM provision_tenant('bright-smile','عيادة الابتسامة المشرقة','Bright Smile',
  'b0000000-0000-0000-0000-0000000000c1','lvh.me');
SELECT test.ok((SELECT tenant_id = 'cccccccc-0000-0000-0000-000000000001' AND hostname = 'bright-smile.lvh.me' FROM p),
  'clinic created with its subdomain');
SELECT test.ok((SELECT count(*) FROM roles) = 5, 'five default roles');
SELECT test.ok((SELECT r.key FROM tenant_members m JOIN roles r ON r.id = m.role_id
  WHERE m.user_id = 'b0000000-0000-0000-0000-0000000000c1') = 'owner', 'signer is the owner');
SELECT test.ok((SELECT is_main AND slug = 'main' FROM branches), 'main branch created');
SELECT test.ok((SELECT status = 'trialing' AND trial_ends_at > now() + interval '13 days' FROM subscriptions), '14-day trial started');
SELECT test.ok((SELECT count(*) FROM sites) = 1 AND (SELECT count(*) FROM tenant_settings) = 1, 'site draft and settings created');
SELECT test.ok((SELECT count(*) FROM memberships_for_user('b0000000-0000-0000-0000-0000000000c1')) = 1, 'login now finds the new clinic');
SELECT test.ok((SELECT count(*) FROM patients) = 0 AND (SELECT count(*) FROM branches) = 1, 'new clinic sees none of the demo data');
ROLLBACK;

-- a second sign-up with a taken subdomain fails as a whole (nothing half-created)
BEGIN;
INSERT INTO users (id, email, phone, full_name, password_hash)
VALUES ('b0000000-0000-0000-0000-0000000000c2','dup@demo.test','+201000000302','Dup','x');
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = 'cccccccc-0000-0000-0000-000000000002';
SELECT test.throws($$SELECT * FROM provision_tenant('clinic-a','x','x','b0000000-0000-0000-0000-0000000000c2','lvh.me')$$,
  'duplicate key', 'taken subdomain rejected by the database');
ROLLBACK;
