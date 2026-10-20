-- Phase H5: the platform admin panel's database functions (ADM-01, ADM-02) and clinic suspension.
-- Functions are called as the API's role (app_user); results are checked as the admin role, which sees every clinic.
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
-- not a platform admin: the clinic owner gets nothing
SELECT test.throws($$SELECT * FROM platform_clinics('b0000000-0000-0000-0000-0000000000a1')$$, 'not a platform admin', 'a clinic owner is not a platform admin');
SELECT test.throws($$SELECT platform_suspend('b0000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'غير مدفوع')$$,
  'not a platform admin', 'nor can they suspend a clinic');

-- the admin sees every clinic with figures (counts, never records)
CREATE TEMP TABLE c AS SELECT * FROM platform_clinics('b0000000-0000-0000-0000-0000000000f1');
SELECT test.ok((SELECT count(*) >= 2 FROM c), 'the admin lists every clinic');
SELECT test.ok((SELECT members >= 4 AND patients > 0 AND plan_code IS NOT NULL AND owner_email = 'owner.a@demo.test' FROM c WHERE slug = 'clinic-a'),
  'with plan, member and patient counts and the owner''s email');

-- suspend clinic B: its staff are cut off at their next request and its website is offline
RESET ROLE;
SELECT status AS before, (SELECT access_version FROM tenant_members WHERE id = 'c0000000-0000-0000-0000-0000000000b1') AS v0
  FROM tenants WHERE id = '22222222-2222-2222-2222-222222222222' \gset
SET LOCAL ROLE app_user;
SELECT test.throws($$SELECT platform_suspend('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'x')$$,
  'tenants_suspension_reason', 'a suspension gives a reason (3 characters at least)');
SELECT platform_suspend('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'الاشتراك غير مدفوع');
SELECT test.ok((SELECT tenant_status = 'suspended' AND access_version = :v0 + 1 FROM member_access_state('c0000000-0000-0000-0000-0000000000b1')),
  'the access check sees the suspension and the owner''s token is stale');
SELECT test.ok(resolve_tenant_by_host('clinic-b.lvh.me') IS NULL, 'the clinic''s website is offline');
SELECT test.throws($$SELECT platform_suspend('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'مرة ثانية')$$,
  'already suspended', 'a suspended clinic is not suspended again');
SELECT platform_reactivate('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222');
RESET ROLE;
SELECT test.ok((SELECT status = :'before' AND suspended_at IS NULL AND suspension_reason IS NULL FROM tenants WHERE id = '22222222-2222-2222-2222-222222222222'),
  'reactivation gives the clinic back the status it had');
SET LOCAL ROLE app_user;
SELECT test.ok(resolve_tenant_by_host('clinic-b.lvh.me') IS NOT NULL, 'and its website is back');
SELECT test.throws($$SELECT platform_reactivate('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222')$$,
  'not suspended', 'only a suspended clinic is reactivated');

-- trial and plan
SELECT test.throws($$SELECT platform_extend_trial('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', now() - interval '1 day')$$,
  'after now and within a year', 'a trial is not moved into the past');
SELECT test.throws($$SELECT platform_extend_trial('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', now() + interval '2 years')$$,
  'after now and within a year', 'nor more than a year ahead');
SELECT platform_extend_trial('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', now() + interval '30 days');
RESET ROLE;
SELECT test.ok((SELECT trial_ends_at > now() + interval '29 days' FROM subscriptions WHERE tenant_id = '22222222-2222-2222-2222-222222222222' AND status = 'trialing'),
  'the trial is extended');
SELECT id AS other_plan FROM plans WHERE id <> (SELECT plan_id FROM subscriptions WHERE tenant_id = '22222222-2222-2222-2222-222222222222' AND status <> 'cancelled') LIMIT 1 \gset
SET LOCAL ROLE app_user;
SELECT platform_change_plan('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', :'other_plan');
RESET ROLE;
SELECT test.ok((SELECT plan_id = :'other_plan' FROM subscriptions WHERE tenant_id = '22222222-2222-2222-2222-222222222222' AND status <> 'cancelled'), 'the plan is changed');
SELECT test.ok((SELECT array_agg(action ORDER BY id) = '{tenant.suspended,tenant.reactivated,tenant.trial_extended,tenant.plan_changed}'
  FROM platform_audit_log WHERE tenant_id = '22222222-2222-2222-2222-222222222222' AND actor_user_id = 'b0000000-0000-0000-0000-0000000000f1'),
  'every action is in the platform audit log, with who did it');

-- notes and plans: only through the platform functions (since 0004 the API role writes no platform table)
SET LOCAL ROLE app_user;
SELECT test.throws($$SELECT * FROM platform_tenant_notes$$, 'permission denied', 'the API role does not read notes directly');
SELECT test.throws($$UPDATE plans SET trial_days = 1$$, 'permission denied', 'nor change a plan directly');
SELECT test.throws($$SELECT platform_add_note('b0000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'x')$$, 'not a platform admin', 'a clinic user adds no note');
SELECT platform_add_note('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', ' تمت المتابعة ');
SELECT test.ok((SELECT body = 'تمت المتابعة' AND author = 'Platform Admin' FROM platform_notes('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222')),
  'a note is kept as written, with its author');
SELECT id AS any_plan, limits->>'patients' AS patients_limit FROM plans ORDER BY code LIMIT 1 \gset
SELECT platform_update_plan('b0000000-0000-0000-0000-0000000000f1', :'any_plan', '{"trial_days": 21, "limits": {"staff": 99}}', NULL);
SELECT test.ok((SELECT trial_days = 21 AND limits->>'staff' = '99' AND limits->>'patients' = :'patients_limit' FROM plans WHERE id = :'any_plan'),
  'a plan edit changes what it names and keeps the other limits');
ROLLBACK;
