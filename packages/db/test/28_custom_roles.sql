-- Phase H4: roles the owner creates (built-in roles fixed, catalogue permissions only, archived not deleted)
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-0000000000a1';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a1';

-- a custom role: catalogue permissions only, stored once each, in order
INSERT INTO roles (id, tenant_id, key, name_en, name_ar, permissions) VALUES
  ('a0000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'custom-c1', 'مدير الفرع', 'مدير الفرع',
   '{patients:write,patients:read,patients:read,appointments:read}');
SELECT test.ok((SELECT permissions = '{appointments:read,patients:read,patients:write}' FROM roles WHERE id = 'a0000000-0000-0000-0000-0000000000c1'),
  'a custom role keeps each permission once, in order');
SELECT test.throws($$INSERT INTO roles (tenant_id, key, name_en, name_ar, permissions) VALUES
  ('11111111-1111-1111-1111-111111111111', 'custom-x1', 'x', 'كل شيء', '{*}')$$, 'cannot be given', 'nobody but the owner holds every permission');
SELECT test.throws($$INSERT INTO roles (tenant_id, key, name_en, name_ar, permissions) VALUES
  ('11111111-1111-1111-1111-111111111111', 'custom-x2', 'x', 'مخزن', '{inventory:write}')$$, 'cannot be given', 'a permission outside the catalogue is refused');
SELECT test.throws($$INSERT INTO roles (tenant_id, key, name_en, name_ar, permissions) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner2', 'x', 'مالك ثان', '{patients:read}')$$, 'generated key', 'a custom role cannot take a built-in key');
SELECT test.throws($$INSERT INTO roles (tenant_id, key, name_en, name_ar, permissions) VALUES
  ('11111111-1111-1111-1111-111111111111', 'custom-x3', 'x', ' مدير الفرع ', '{patients:read}')$$, 'roles_tenant_name_ar', 'two roles in use do not share a name');
SELECT test.throws($$INSERT INTO roles (tenant_id, key, name_en, name_ar, is_system, permissions) VALUES
  ('11111111-1111-1111-1111-111111111111', 'assistant', 'x', 'مساعد ٢', true, '{*}')$$, 'default permissions', 'a built-in role is created with its defaults only');

-- built-in roles are fixed, except their discount limits
SELECT test.throws($$UPDATE roles SET permissions = permissions || '{payments:refund}' WHERE id = 'a0000000-0000-0000-0000-0000000000a2'$$,
  'built-in role is fixed', 'the receptionist''s permissions are not changed from the API');
SELECT test.throws($$UPDATE roles SET name_ar = 'استقبال' WHERE id = 'a0000000-0000-0000-0000-0000000000a2'$$, 'built-in role is fixed', 'nor its name');
SELECT test.lives($$UPDATE roles SET max_discount_bp = 1500 WHERE id = 'a0000000-0000-0000-0000-0000000000a2'$$, 'its discount limit still changes (DISC-002)');
SELECT test.throws($$DELETE FROM roles WHERE id = 'a0000000-0000-0000-0000-0000000000a4'$$, 'not deleted', 'a built-in role is not deleted');
SELECT test.throws($$UPDATE roles SET is_system = true WHERE id = 'a0000000-0000-0000-0000-0000000000c1'$$, 'built-in role is fixed', 'a custom role does not become built-in');

-- editing a role's permissions applies to its members on their next request (ACCESS-005)
UPDATE tenant_members SET role_id = 'a0000000-0000-0000-0000-0000000000c1' WHERE id = 'c0000000-0000-0000-0000-0000000000a5';
SELECT access_version AS v0 FROM tenant_members WHERE id = 'c0000000-0000-0000-0000-0000000000a5' \gset
UPDATE roles SET permissions = '{patients:read}' WHERE id = 'a0000000-0000-0000-0000-0000000000c1';
SELECT test.ok((SELECT access_version = :v0 + 1 FROM tenant_members WHERE id = 'c0000000-0000-0000-0000-0000000000a5'),
  'the role''s members get a new access version');
UPDATE roles SET name_ar = 'مدير فرع المعادي' WHERE id = 'a0000000-0000-0000-0000-0000000000c1';
SELECT test.ok((SELECT access_version = :v0 + 1 FROM tenant_members WHERE id = 'c0000000-0000-0000-0000-0000000000a5'), 'a new name alone changes nobody''s access');

-- a role in use is not deleted; an archived one is fixed and given to nobody new
SELECT test.throws($$DELETE FROM roles WHERE id = 'a0000000-0000-0000-0000-0000000000c1'$$, 'foreign key', 'a role a member holds is not deleted');
UPDATE tenant_members SET role_id = 'a0000000-0000-0000-0000-0000000000a4' WHERE id = 'c0000000-0000-0000-0000-0000000000a5';
UPDATE roles SET archived_at = now() WHERE id = 'a0000000-0000-0000-0000-0000000000c1';
SELECT test.throws($$UPDATE roles SET permissions = '{patients:write}' WHERE id = 'a0000000-0000-0000-0000-0000000000c1'$$, 'archived role is not changed', 'an archived role is fixed');
SELECT test.throws($$UPDATE tenant_members SET role_id = 'a0000000-0000-0000-0000-0000000000c1' WHERE id = 'c0000000-0000-0000-0000-0000000000a5'$$,
  'archived role is not given', 'an archived role is given to nobody');
SELECT test.lives($$INSERT INTO roles (tenant_id, key, name_en, name_ar, permissions) VALUES
  ('11111111-1111-1111-1111-111111111111', 'custom-c2', 'x', 'مدير فرع المعادي', '{patients:read}')$$, 'an archived role''s name can be used again');
SELECT test.lives($$DELETE FROM roles WHERE key = 'custom-c2'$$, 'a role nobody ever held is deleted');

-- another clinic's roles are invisible (RLS)
SELECT test.ok(NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id <> '11111111-1111-1111-1111-111111111111'), 'a clinic sees only its own roles');
ROLLBACK;
