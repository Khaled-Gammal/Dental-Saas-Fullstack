-- Phase 2B (BIL-02, manual): recording a clinic's payment, the renewal it buys, the payment instructions, and what
-- happens when a paid period runs out (past due, then suspended as unpaid after the grace days).
-- Admin b…f1; clinic B 2222… (seeded on a trial).
\set ON_ERROR_STOP 1
BEGIN;
\set admin '''b0000000-0000-0000-0000-0000000000f1'''
\set b '''22222222-2222-2222-2222-222222222222'''

-- who may do what
SET LOCAL ROLE app_user;
SELECT test.throws($$SELECT platform_record_payment('b0000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 50000, 'monthly', 'instapay', 'x', null, null, null)$$,
  'permission denied', 'the clinic API cannot record a payment, even with an admin''s id');
SELECT test.throws($$SELECT * FROM platform_settings$$, 'permission denied', 'nor read the platform settings directly');
SELECT test.lives($$SELECT billing_instructions()$$, 'but reads the payment instructions');
SET LOCAL ROLE app_platform;
SELECT test.throws($$SELECT platform_record_payment('b0000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 50000, 'monthly', 'instapay', 'x', null, null, null)$$,
  'not a platform admin', 'a clinic owner is not a platform admin');

-- payment instructions: set by the platform, read by the clinics and the worker
SELECT platform_set_billing_instructions(:admin, '  InstaPay: clinic@instapay  ', null);
SET LOCAL ROLE app_worker;
SELECT test.ok(billing_instructions() = 'InstaPay: clinic@instapay', 'the worker reads the instructions (trimmed)');
SET LOCAL ROLE app_platform;

-- clinic B on its trial pays a month: active from now, a paid invoice, a trial-ended suspension would be lifted
SELECT test.throws(format($$SELECT platform_record_payment(%L, %L, 0, 'monthly', 'cash', null, null, null, null)$$, :admin, :b), 'positive', 'an amount is positive');
SELECT test.throws(format($$SELECT platform_record_payment(%L, %L, 100, 'weekly', 'cash', null, null, null, null)$$, :admin, :b), 'monthly or yearly', 'a month or a year');
SELECT test.throws(format($$SELECT platform_record_payment(%L, %L, 100, 'monthly', 'cheque', null, null, null, null)$$, :admin, :b), 'platform_invoices_method', 'a known method');
SELECT platform_record_payment(:admin, :b, 50000, 'monthly', 'instapay', 'TX-1001', 'أول دفعة', 'aaaaaaaa-0000-4000-8000-000000000001', null) AS inv1 \gset
RESET ROLE;
SELECT test.ok((SELECT s.status = 'active' AND s.billing_cycle = 'monthly' AND s.current_period_end BETWEEN now() + interval '27 days' AND now() + interval '32 days'
  FROM subscriptions s WHERE s.tenant_id = :b AND s.status <> 'cancelled'), 'the subscription is active for a month from now');
SELECT test.ok((SELECT status = 'active' FROM tenants WHERE id = :b), 'and the clinic is active');
SELECT test.ok((SELECT number ~ '^P\d{4}-\d{6}$' AND status = 'paid' AND amount_minor = 50000 AND provider = 'instapay' AND provider_ref = 'TX-1001' AND note = 'أول دفعة'
  AND recorded_by = :admin FROM platform_invoices WHERE id = :'inv1'), 'a paid invoice with its number, method, reference and note');
SELECT current_period_end AS end1 FROM subscriptions WHERE tenant_id = :b AND status <> 'cancelled' \gset

-- the same form sent twice (a double click) records one payment
SET LOCAL ROLE app_platform;
SELECT test.ok(platform_record_payment(:admin, :b, 50000, 'monthly', 'instapay', 'TX-1001', null, 'aaaaaaaa-0000-4000-8000-000000000001', null) = :'inv1',
  'a repeated form returns the same invoice');
RESET ROLE;
SELECT test.ok((SELECT current_period_end = :'end1' FROM subscriptions WHERE tenant_id = :b AND status <> 'cancelled'), 'without extending twice');
SET LOCAL ROLE app_platform;
SELECT test.throws(format($$SELECT platform_record_payment(%L, '11111111-1111-1111-1111-111111111111', 50000, 'monthly', 'cash', null, null, 'aaaaaaaa-0000-4000-8000-000000000001', null)$$, :admin),
  'platform_invoices_idempotency', 'one form''s key is not reused for another clinic');
SELECT test.throws(format($$SELECT platform_record_payment(%L, %L, 50000, 'monthly', 'instapay', 'tx-1001', null, null, null)$$, :admin, :b),
  'platform_invoices_reference', 'the same transfer reference twice is refused');

-- renewing early: a year added to the end of the paid month, not from today
SELECT platform_record_payment(:admin, :b, 500000, 'yearly', 'bank_transfer', 'BANK-77', null, null, null) AS inv2 \gset
RESET ROLE;
SELECT test.ok((SELECT current_period_end = :'end1'::timestamptz + interval '1 year' FROM subscriptions WHERE tenant_id = :b AND status <> 'cancelled'),
  'an early renewal extends from the end of the paid period');
SELECT test.ok((SELECT period_start = (:'end1'::timestamptz AT TIME ZONE 'Africa/Cairo')::date FROM platform_invoices WHERE id = :'inv2'), 'and its invoice covers that year');
SET LOCAL ROLE app_platform;
SELECT test.ok((SELECT count(*) = 2 AND bool_and(recorded_by_name IS NOT NULL) FROM platform_payments(:admin, :b)), 'the panel lists the clinic''s payments');
SET LOCAL ROLE app_user;
SELECT set_config('app.tenant_id', '22222222-2222-2222-2222-222222222222', true);
SELECT test.ok((SELECT count(*) = 2 FROM (SELECT id, number, amount_minor, provider, billing_cycle, paid_at FROM platform_invoices) x), 'the clinic reads its own payments');
SELECT test.throws($$SELECT note FROM platform_invoices$$, 'permission denied', 'but not the platform''s note');
SELECT test.throws($$SELECT recorded_by FROM platform_invoices$$, 'permission denied', 'nor who recorded it');
SELECT set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true);
SELECT test.ok((SELECT count(*) = 0 FROM platform_invoices WHERE tenant_id = '22222222-2222-2222-2222-222222222222'), 'another clinic does not');
RESET ROLE;

-- the paid period runs out: past due at once (still working), suspended as unpaid after the grace days. A period
-- that ended long ago (a clinic activated before this phase) gets its full grace from now, not an instant suspension.
UPDATE subscriptions SET current_period_end = now() - interval '40 days' WHERE tenant_id = :b AND status <> 'cancelled';
SET LOCAL ROLE app_worker;
SELECT test.ok((SELECT past_due >= 1 AND suspended = 0 FROM expire_subscriptions(7)), 'a period that ran out makes the subscription past due, even long after');
RESET ROLE;
SELECT test.ok((SELECT s.status = 'past_due' AND t.status = 'past_due' AND s.grace_ends_at BETWEEN now() + interval '6 days 23 hours' AND now() + interval '7 days 1 hour'
  FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE s.tenant_id = :b AND s.status <> 'cancelled'),
  'the clinic shows past due, keeps working, and has 7 days from now');
SELECT access_version AS v0 FROM tenant_members WHERE id = 'c0000000-0000-0000-0000-0000000000b1' \gset
UPDATE subscriptions SET grace_ends_at = now() - interval '1 minute' WHERE tenant_id = :b AND status <> 'cancelled';
SET LOCAL ROLE app_worker;
SELECT test.ok((SELECT suspended >= 1 FROM expire_subscriptions(7)), 'after the grace days the clinic is suspended');
RESET ROLE;
SELECT test.ok((SELECT status = 'suspended' AND suspension_kind = 'unpaid' AND status_before_suspension = 'past_due' FROM tenants WHERE id = :b), 'as unpaid');
SELECT test.ok((SELECT access_version = :v0 + 1 FROM tenant_members WHERE id = 'c0000000-0000-0000-0000-0000000000b1'), 'its staff are cut off at their next request');
SELECT test.ok((SELECT count(*) = 2 FROM platform_audit_log WHERE tenant_id = :b AND action IN ('tenant.subscription_past_due', 'tenant.unpaid_suspended')),
  'both steps are in the platform audit log');
SET LOCAL ROLE app_worker;
SELECT test.ok((SELECT past_due = 0 AND suspended = 0 FROM expire_subscriptions(7)), 'running again changes nothing');
SET LOCAL ROLE app_platform;
SELECT test.throws(format($$SELECT platform_reactivate(%L, %L)$$, :admin, :b), 'subscription is unpaid', 'an unpaid clinic is not reactivated: its payment is recorded');
SELECT platform_record_payment(:admin, :b, 50000, 'monthly', 'vodafone_cash', null, null, null, null);
RESET ROLE;
SELECT test.ok((SELECT t.status = 'active' AND t.suspension_kind IS NULL AND s.status = 'active' AND s.current_period_end > now() + interval '27 days' AND s.grace_ends_at IS NULL
  FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id AND s.status <> 'cancelled' WHERE t.id = :b), 'paying lifts the suspension, a month from now');

-- an unpaid suspension whose subscription is paid again another way (activated without a payment) can be reactivated
UPDATE tenants SET status = 'suspended', suspension_kind = 'unpaid', suspended_at = now(), suspension_reason = 'x x x', status_before_suspension = 'past_due' WHERE id = :b;
SET LOCAL ROLE app_platform;
SELECT test.lives(format($$SELECT platform_reactivate(%L, %L)$$, :admin, :b), 'an unpaid suspension with a paid subscription is reactivated');
RESET ROLE;
SELECT test.ok((SELECT status = 'active' FROM tenants WHERE id = :b), 'and comes back active');

-- suspended by hand while past due, then reactivated: a fresh grace, not an instant unpaid suspension
UPDATE subscriptions SET status = 'past_due', current_period_end = now() - interval '20 days', grace_ends_at = now() - interval '13 days' WHERE tenant_id = :b AND status <> 'cancelled';
UPDATE tenants SET status = 'past_due' WHERE id = :b;
SET LOCAL ROLE app_platform;
SELECT platform_suspend(:admin, :b, 'مراجعة الحساب');
SELECT platform_reactivate(:admin, :b);
SET LOCAL ROLE app_worker;
SELECT test.ok((SELECT suspended = 0 FROM expire_subscriptions(7)), 'a clinic reactivated while past due is not suspended at once');
RESET ROLE;
SELECT test.ok((SELECT t.status = 'past_due' AND s.grace_ends_at > now() + interval '6 days' FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id AND s.status <> 'cancelled' WHERE t.id = :b),
  'it is past due with a fresh grace');
SET LOCAL ROLE app_platform;
SELECT test.ok(platform_grace(:admin, :b) > now() + interval '6 days', 'the panel reads the day it would be suspended');
SELECT platform_record_payment(:admin, :b, 50000, 'monthly', 'cash', null, null, null, null);
RESET ROLE;

-- a clinic suspended by hand stays suspended when it pays, and comes back active when reactivated
SET LOCAL ROLE app_platform;
SELECT platform_suspend(:admin, :b, 'مخالفة شروط الاستخدام');
SELECT platform_record_payment(:admin, :b, 50000, 'monthly', 'cash', null, null, null, null);
RESET ROLE;
SELECT test.ok((SELECT status = 'suspended' AND suspension_kind = 'manual' AND status_before_suspension = 'active' FROM tenants WHERE id = :b),
  'a manual suspension is not lifted by a payment');
SET LOCAL ROLE app_platform;
SELECT platform_reactivate(:admin, :b);
RESET ROLE;
SELECT test.ok((SELECT status = 'active' FROM tenants WHERE id = :b), 'reactivated, it is active');

-- a deleted clinic takes no payment
SET LOCAL ROLE app_platform;
SELECT test.throws(format($$SELECT platform_record_payment(%L, %L, 100, 'monthly', 'cash', null, null, null, null)$$, :admin, '33333333-3333-3333-3333-333333333333'),
  'clinic not found', 'a clinic that does not exist takes no payment');
-- clearing the instructions
SELECT platform_set_billing_instructions(:admin, '   ', null);
RESET ROLE;
SELECT test.ok(billing_instructions() IS NULL, 'blank instructions clear them');
ROLLBACK;
