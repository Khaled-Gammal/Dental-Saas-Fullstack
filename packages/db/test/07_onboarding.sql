-- Onboarding rules (week 3): branch hours, theme colour, profile writes, main branch
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';

-- hours: replace a day atomically, reject overlaps and inverted shifts, allow touching shifts
DELETE FROM branch_hours WHERE branch_id = 'd0000000-0000-0000-0000-0000000000a2' AND weekday = 5;
SELECT test.lives($$INSERT INTO branch_hours (tenant_id, branch_id, weekday, opens_at, closes_at) VALUES
  ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a2',5,'10:00','14:00'),
  ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a2',5,'14:00','18:00')$$, 'touching shifts are allowed');
SELECT test.throws($$INSERT INTO branch_hours (tenant_id, branch_id, weekday, opens_at, closes_at) VALUES
  ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a2',5,'13:00','15:00')$$,
  'branch_hours_no_overlap', 'overlapping shifts on the same day are rejected');
SELECT test.lives($$INSERT INTO branch_hours (tenant_id, branch_id, weekday, opens_at, closes_at) VALUES
  ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',5,'13:00','15:00')$$, 'same time at another branch is fine');
SELECT test.throws($$INSERT INTO branch_hours (tenant_id, branch_id, weekday, opens_at, closes_at) VALUES
  ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a2',3,'18:00','09:00')$$,
  'violates check constraint', 'closing before opening is rejected');
SELECT test.throws($$INSERT INTO branch_hours (tenant_id, branch_id, weekday, opens_at, closes_at) VALUES
  ('22222222-2222-2222-2222-222222222222','d0000000-0000-0000-0000-0000000000b1',2,'09:00','10:00')$$,
  'row-level security', 'cannot write hours for another clinic');

-- theme colour: only #rrggbb
SELECT test.lives($$UPDATE sites SET draft_theme = draft_theme || '{"primary":"#0e9aa7"}'$$, 'a hex brand colour is accepted');
SELECT test.throws($$UPDATE sites SET draft_theme = draft_theme || '{"primary":"red;background:url(x)"}'$$,
  'sites_theme_primary_hex', 'CSS injection through the brand colour is rejected');

-- profile: the app may edit profile columns, not status/slug
SELECT test.lives($$UPDATE tenants SET about_ar = 'نبذة', primary_phone = '+201000000999', updated_at = now()$$, 'profile columns are editable');
SELECT test.throws($$UPDATE tenants SET status = 'active'$$, 'permission denied', 'the app cannot change its own subscription status');
SELECT test.throws($$UPDATE tenants SET slug = 'stolen'$$, 'permission denied', 'the app cannot change the clinic address');

-- main branch: switching is two statements in one transaction; two mains at once are impossible
SELECT test.throws($$UPDATE branches SET is_main = true WHERE id = 'd0000000-0000-0000-0000-0000000000a2'$$,
  'branches_one_main', 'only one main branch');
UPDATE branches SET is_main = false WHERE is_main;
UPDATE branches SET is_main = true WHERE id = 'd0000000-0000-0000-0000-0000000000a2';
SELECT test.ok((SELECT count(*) = 1 AND bool_and(id = 'd0000000-0000-0000-0000-0000000000a2') FROM branches WHERE is_main), 'main branch switched');

SELECT test.throws($$UPDATE branches SET is_active = false WHERE is_main$$, 'branches_main_is_active', 'the main branch cannot be deactivated');
SELECT test.throws($$UPDATE sites SET published_theme = '{"primary":"url(javascript:x)"}'$$, 'sites_published_primary_hex', 'published colour is checked too');

ROLLBACK;
