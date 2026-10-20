-- Phase H7: the landing page's contact form (LND-04) — anyone adds a lead through the API; only platform admins read them
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
INSERT INTO leads (full_name, phone, email, clinic_name, city, message, source, plan_id, ip, user_agent)
VALUES ('د. سارة علي', '+201012345678', 'sara@example.test', 'عيادة الابتسامة', 'المنصورة', 'نريد عرضًا للنظام', 'landing',
        '00000000-0000-0000-0000-00000000a002', '203.0.113.7', 'test');
SELECT test.ok(true, 'the API role adds a lead');
SELECT test.throws($$SELECT count(*) FROM leads$$, 'permission denied', 'but never reads them back');
SELECT test.throws($$INSERT INTO leads (full_name, phone, status) VALUES ('سارة', '+201012345678', 'converted')$$,
  'permission denied', 'nor sets the status');
SELECT test.throws($$UPDATE leads SET status = 'lost'$$, 'permission denied', 'nor changes a lead');
SELECT test.throws($$DELETE FROM leads$$, 'permission denied', 'nor deletes one');
SELECT test.throws($$INSERT INTO leads (full_name, phone) VALUES ('سارة', '01012345678')$$, 'leads_phone', 'the phone is stored in international form');
SELECT test.throws($$INSERT INTO leads (full_name, phone) VALUES (' ', '+201012345678')$$, 'leads_full_name', 'a name is required');
SELECT test.throws($$INSERT INTO leads (full_name, phone, message) VALUES ('سارة', '+201012345678', repeat('x', 2001))$$,
  'leads_message', 'a message is at most 2000 characters');

-- «اشترك الآن»: a subscription request names the new clinic and the billing cycle; a call request has neither
INSERT INTO leads (kind, full_name, phone, clinic_name, source, plan_id, billing_cycle, clinic_id)
VALUES ('subscribe', 'سارة علي', '+201087654321', 'عيادة الابتسامة', 'signup', '00000000-0000-0000-0000-00000000a001', 'yearly',
        '22222222-2222-2222-2222-222222222222');
SELECT test.ok(true, 'a new clinic is recorded as a subscription request');
SELECT test.throws($$INSERT INTO leads (kind, full_name, phone, clinic_id) VALUES ('subscribe', 'سارة', '+201012345678', '22222222-2222-2222-2222-222222222222')$$,
  'leads_subscribe', 'a subscription request has a billing cycle');
SELECT test.throws($$INSERT INTO leads (full_name, phone, clinic_id) VALUES ('سارة', '+201012345678', '22222222-2222-2222-2222-222222222222')$$,
  'leads_subscribe', 'a call request is not linked to a clinic');
SELECT test.throws($$INSERT INTO leads (full_name, phone, billing_cycle) VALUES ('سارة', '+201012345678', 'monthly')$$,
  'leads_subscribe', 'a call request has no billing cycle');
SELECT test.throws($$INSERT INTO leads (kind, full_name, phone, billing_cycle, clinic_id) VALUES ('subscribe', 'سارة', '+201012345678', 'weekly', '22222222-2222-2222-2222-222222222222')$$,
  'leads_billing_cycle', 'monthly or yearly');

-- the panel
SELECT test.throws($$SELECT * FROM platform_leads('b0000000-0000-0000-0000-0000000000a1')$$, 'not a platform admin', 'a clinic owner does not list leads');
SELECT test.ok((SELECT plan_code = 'pro' AND status = 'new' FROM platform_leads('b0000000-0000-0000-0000-0000000000f1') WHERE phone = '+201012345678'),
  'an admin lists them, with the plan asked about');
SELECT test.ok((SELECT kind = 'subscribe' AND billing_cycle = 'yearly' AND clinic_id = '22222222-2222-2222-2222-222222222222' AND plan_code = 'basic'
                FROM platform_leads('b0000000-0000-0000-0000-0000000000f1') WHERE phone = '+201087654321'),
  'a subscription request shows its plan, cycle and clinic');
SELECT platform_set_lead_status('b0000000-0000-0000-0000-0000000000f1',
  (SELECT id FROM platform_leads('b0000000-0000-0000-0000-0000000000f1') WHERE phone = '+201012345678'), 'contacted');
SELECT test.ok((SELECT status = 'contacted' AND updated_by_name IS NOT NULL FROM platform_leads('b0000000-0000-0000-0000-0000000000f1') WHERE phone = '+201012345678'),
  'an admin moves a lead along, and who did it is kept');
SELECT test.ok((SELECT count(*) = 1 FROM platform_audit_log WHERE action = 'lead.status' AND details->>'to' = 'contacted'), 'in the platform audit log');
SELECT test.throws($$SELECT platform_set_lead_status('b0000000-0000-0000-0000-0000000000f1',
  (SELECT id FROM platform_leads('b0000000-0000-0000-0000-0000000000f1') WHERE phone = '+201012345678'), 'archived')$$,
  'leads_status_check', 'only the known statuses');
SELECT test.throws($$SELECT platform_set_lead_status('b0000000-0000-0000-0000-0000000000f1', gen_random_uuid(), 'lost')$$,
  'lead not found', 'an unknown lead');
SELECT test.throws($$SELECT platform_set_lead_status('b0000000-0000-0000-0000-0000000000a1',
  (SELECT id FROM platform_leads('b0000000-0000-0000-0000-0000000000f1') WHERE phone = '+201012345678'), 'lost')$$,
  'not a platform admin', 'a clinic owner does not change one');
ROLLBACK;
