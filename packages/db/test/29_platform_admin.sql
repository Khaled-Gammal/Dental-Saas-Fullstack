-- Phase H5: the platform admin panel's database functions (ADM-01, ADM-02) and clinic suspension.
-- Functions are called as the platform panel's role (app_platform, review R11: the clinic API's app_user may not call
-- them at all); results are checked as the admin role, which sees every clinic.
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
-- review R11: the clinic API's role cannot call the panel's functions or read its audit log, whatever id it passes
SELECT test.throws($$SELECT * FROM platform_clinics('b0000000-0000-0000-0000-0000000000f1')$$, 'permission denied', 'the clinic API role lists no clinics');
SELECT test.throws($$SELECT platform_suspend('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'غير مدفوع')$$,
  'permission denied', 'nor suspends one, even with an admin''s id');
SELECT test.throws($$SELECT * FROM platform_audit_log$$, 'permission denied', 'nor reads the platform audit log');
SET LOCAL ROLE app_platform;
SELECT test.throws($$SELECT * FROM patients$$, 'permission denied', 'the platform role reads no clinic data');
SELECT test.throws($$SELECT password_hash FROM users$$, 'permission denied', 'nor password hashes');
-- not a platform admin: the clinic owner gets nothing
SELECT test.throws($$SELECT * FROM platform_clinics('b0000000-0000-0000-0000-0000000000a1')$$, 'not a platform admin', 'a clinic owner is not a platform admin');
SELECT test.throws($$SELECT platform_suspend('b0000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'غير مدفوع')$$,
  'not a platform admin', 'nor can they suspend a clinic');

-- the admin sees every clinic with figures (counts, never records)
CREATE TEMP TABLE c AS SELECT * FROM platform_clinics('b0000000-0000-0000-0000-0000000000f1');
SELECT test.ok((SELECT count(*) >= 2 FROM c), 'the admin lists every clinic');
SELECT test.ok((SELECT members >= 4 AND patients > 0 AND plan_code IS NOT NULL AND owner_email = 'owner.a@demo.test' FROM c WHERE slug = 'clinic-a'),
  'with plan, member and patient counts and the owner''s email');
-- clinics per plan (the plans page): counted past row-level security, for admins only
SELECT test.ok((SELECT coalesce(sum(clinics), 0) >= 2 FROM platform_plan_clinics('b0000000-0000-0000-0000-0000000000f1')),
  'the admin sees how many clinics each plan has');
SELECT test.throws($$SELECT * FROM platform_plan_clinics('b0000000-0000-0000-0000-0000000000a1')$$, 'not a platform admin', 'a clinic owner does not');

-- suspend clinic B: its staff are cut off at their next request and its website is offline
RESET ROLE;
SELECT status AS before, (SELECT access_version FROM tenant_members WHERE id = 'c0000000-0000-0000-0000-0000000000b1') AS v0
  FROM tenants WHERE id = '22222222-2222-2222-2222-222222222222' \gset
SET LOCAL ROLE app_platform;
SELECT test.throws($$SELECT platform_suspend('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'x')$$,
  'tenants_suspension_reason', 'a suspension gives a reason (3 characters at least)');
SELECT platform_suspend('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'الاشتراك غير مدفوع');
SET LOCAL ROLE app_user;
SELECT test.ok((SELECT tenant_status = 'suspended' AND access_version = :v0 + 1 FROM member_access_state('c0000000-0000-0000-0000-0000000000b1')),
  'the access check sees the suspension and the owner''s token is stale');
SELECT test.ok(resolve_tenant_by_host('clinic-b.lvh.me') IS NULL, 'the clinic''s website is offline');
SET LOCAL ROLE app_platform;
SELECT test.throws($$SELECT platform_suspend('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'مرة ثانية')$$,
  'already suspended', 'a suspended clinic is not suspended again');
SELECT platform_reactivate('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222');
RESET ROLE;
SELECT test.ok((SELECT status = :'before' AND suspended_at IS NULL AND suspension_reason IS NULL FROM tenants WHERE id = '22222222-2222-2222-2222-222222222222'),
  'reactivation gives the clinic back the status it had');
SET LOCAL ROLE app_user;
SELECT test.ok(resolve_tenant_by_host('clinic-b.lvh.me') IS NOT NULL, 'and its website is back');
SET LOCAL ROLE app_platform;
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
SET LOCAL ROLE app_platform;
SELECT platform_change_plan('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', :'other_plan');
RESET ROLE;
SELECT test.ok((SELECT plan_id = :'other_plan' FROM subscriptions WHERE tenant_id = '22222222-2222-2222-2222-222222222222' AND status <> 'cancelled'), 'the plan is changed');
SELECT test.ok((SELECT array_agg(action ORDER BY id) = '{tenant.suspended,tenant.reactivated,tenant.trial_extended,tenant.plan_changed}'
  FROM platform_audit_log WHERE tenant_id = '22222222-2222-2222-2222-222222222222' AND actor_user_id = 'b0000000-0000-0000-0000-0000000000f1'),
  'every action is in the platform audit log, with who did it');

-- trials (owner 2026-10-20): an ended trial suspends the clinic; extending or activating lifts it, a manual suspension stays
RESET ROLE;
UPDATE subscriptions SET trial_ends_at = now() - interval '1 hour' WHERE tenant_id = '22222222-2222-2222-2222-222222222222' AND status = 'trialing';
SET LOCAL ROLE app_worker;
SELECT test.ok(expire_trials() >= 1, 'the worker suspends a clinic whose trial ended');
SELECT test.ok(expire_trials() = 0, 'and only once');
RESET ROLE;
SELECT test.ok((SELECT status = 'suspended' AND suspension_kind = 'trial_ended' FROM tenants WHERE id = '22222222-2222-2222-2222-222222222222'), 'as "trial ended"');
SET LOCAL ROLE app_platform;
SELECT test.throws($$SELECT platform_reactivate('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222')$$,
  'trial has ended', 'reactivating would only suspend it again: extend or activate instead');
SELECT platform_extend_trial('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', now() + interval '7 days');
RESET ROLE;
SELECT test.ok((SELECT status <> 'suspended' AND suspension_kind IS NULL FROM tenants WHERE id = '22222222-2222-2222-2222-222222222222'), 'extending the trial opens the clinic again');
UPDATE subscriptions SET trial_ends_at = now() - interval '1 hour' WHERE tenant_id = '22222222-2222-2222-2222-222222222222' AND status = 'trialing';
SET LOCAL ROLE app_worker;
SELECT expire_trials();
SET LOCAL ROLE app_platform;
SELECT test.throws($$SELECT platform_activate('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'weekly')$$, 'monthly or yearly', 'a subscription is monthly or yearly');
SELECT platform_activate('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'yearly');
RESET ROLE;
SELECT test.ok((SELECT t.status = 'active' AND t.suspended_at IS NULL AND s.status = 'active' AND s.billing_cycle = 'yearly' AND s.current_period_end > now() + interval '364 days'
  FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id AND s.status <> 'cancelled' WHERE t.id = '22222222-2222-2222-2222-222222222222'),
  'activating after payment makes the clinic active for the year and lifts the trial suspension');
SET LOCAL ROLE app_worker;
SELECT test.ok(expire_trials() = 0, 'an active clinic is not touched by the trial job');
SET LOCAL ROLE app_platform;
SELECT test.throws($$SELECT platform_activate('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'monthly')$$, 'already active', 'an active subscription is not activated again');
SELECT test.throws($$SELECT expire_trials()$$, 'permission denied', 'only the worker runs the trial job');

-- notes and plans: only through the platform functions (since 0004 no API role writes a platform table)
SET LOCAL ROLE app_platform;
SELECT test.throws($$SELECT * FROM platform_tenant_notes$$, 'permission denied', 'the panel does not read notes directly');
SELECT test.throws($$UPDATE plans SET trial_days = 1$$, 'permission denied', 'nor change a plan directly');
SELECT test.throws($$SELECT platform_add_note('b0000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'x')$$, 'not a platform admin', 'a clinic user adds no note');
SELECT platform_add_note('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', ' تمت المتابعة ');
SELECT test.ok((SELECT body = 'تمت المتابعة' AND author = 'Platform Admin' FROM platform_notes('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222')),
  'a note is kept as written, with its author');
SELECT id AS any_plan, limits->>'patients' AS patients_limit FROM plans ORDER BY code LIMIT 1 \gset
SELECT platform_update_plan('b0000000-0000-0000-0000-0000000000f1', :'any_plan', '{"trial_days": 21, "limits": {"staff": 99}}', NULL);
SELECT test.ok((SELECT trial_days = 21 AND limits->>'staff' = '99' AND limits->>'patients' = :'patients_limit' FROM plans WHERE id = :'any_plan'),
  'a plan edit changes what it names and keeps the other limits');
-- a new plan (2026-10-24): admins only, a free Latin code, placed after the others
SELECT test.throws($$INSERT INTO plans (code, name_en, name_ar, price_monthly_minor, price_yearly_minor) VALUES ('x1', 'x', 'x', 0, 0)$$,
  'permission denied', 'the panel adds no plan directly');
SELECT test.throws($$SELECT platform_create_plan('b0000000-0000-0000-0000-0000000000a1', '{"code":"enterprise","name_ar":"المؤسسات","price_monthly_minor":1,"price_yearly_minor":1}', NULL)$$,
  'not a platform admin', 'a clinic user adds no plan');
SELECT test.throws($$SELECT platform_create_plan('b0000000-0000-0000-0000-0000000000f1', '{"code":"مؤسسات","name_ar":"المؤسسات","price_monthly_minor":1,"price_yearly_minor":1}', NULL)$$,
  'plan code is a Latin slug', 'a plan code is a Latin slug');
SELECT test.throws($$SELECT platform_create_plan('b0000000-0000-0000-0000-0000000000f1', '{"code":"basic","name_ar":"مكررة","price_monthly_minor":1,"price_yearly_minor":1}', NULL)$$,
  'plans_code_key', 'nor one another plan has');
SELECT platform_create_plan('b0000000-0000-0000-0000-0000000000f1',
  '{"code":"Enterprise","name_ar":" المؤسسات ","price_monthly_minor":250000,"price_yearly_minor":2500000,"trial_days":30,"limits":{"branches":null},"features":{"custom_domain":true}}', NULL) AS new_plan \gset
RESET ROLE;
SELECT test.ok((SELECT code = 'enterprise' AND name_ar = 'المؤسسات' AND trial_days = 30 AND is_public AND limits = '{"branches":null}' AND features->>'custom_domain' = 'true'
  AND sort_order > (SELECT max(sort_order) FROM plans WHERE id <> :'new_plan') FROM plans WHERE id = :'new_plan'),
  'a new plan keeps what it was given and goes after the others');
SELECT test.ok((SELECT details->>'plan' = 'enterprise' FROM platform_audit_log WHERE action = 'plan.created' ORDER BY id DESC LIMIT 1), 'and is in the platform audit log');
ROLLBACK;
