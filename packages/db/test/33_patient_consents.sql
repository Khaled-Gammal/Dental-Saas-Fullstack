-- Phase H9: patient consents (DSH-16) — the clinic's texts (drafts reviewed before use, versions kept), signed on
-- screen or on paper, the text signed copied by the database, never changed or deleted, withdrawn once with a reason
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SELECT set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true);

SELECT test.ok((SELECT array_agg(key ORDER BY key) = '{anesthesia,extraction,general,implant}' AND bool_and(reviewed_at IS NULL)
                FROM consent_templates), 'every clinic starts with the four drafts, not reviewed');

-- files the signatures point at (as the API stores them: private consent files)
INSERT INTO files (id, tenant_id, bucket, object_key, mime_type, size_bytes, kind, is_private) VALUES
  ('f9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'local', 't/11111111-1111-1111-1111-111111111111/consents/f9000000-0000-0000-0000-000000000001', 'image/png', 900, 'consent', true),
  ('f9000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'local', 't/11111111-1111-1111-1111-111111111111/consents/f9000000-0000-0000-0000-000000000002', 'application/pdf', 900, 'consent', true),
  ('f9000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'local', 't/11111111-1111-1111-1111-111111111111/clinical/f9000000-0000-0000-0000-000000000003', 'image/jpeg', 900, 'xray', true);

SELECT test.throws($$INSERT INTO patient_consents (tenant_id, patient_id, template_id, locale, body_snapshot, signer_name, signature_file_id)
  SELECT tenant_id, '70000000-0000-0000-0000-0000000000a1', id, 'ar', 'x', 'عمر خالد', 'f9000000-0000-0000-0000-000000000001' FROM consent_templates WHERE key = 'extraction'$$,
  'a draft is reviewed before it is signed', 'a draft cannot be signed');

-- the owner reviews it: a new version, marked reviewed
INSERT INTO consent_templates (tenant_id, key, version, title_ar, body_ar, reviewed_at, reviewed_by, created_by)
SELECT tenant_id, key, 2, title_ar, body_ar || E'\n\nراجعه الطبيب.', now(), 'c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1'
  FROM consent_templates WHERE key = 'extraction';
SELECT test.throws($$UPDATE consent_templates SET body_ar = body_ar || ' تعديل' WHERE key = 'extraction' AND version = 2$$,
  'never edited', 'a version is never edited');
SELECT test.throws($$DELETE FROM consent_templates WHERE key = 'general'$$, 'permission denied', 'nor deleted');
SELECT test.throws($$INSERT INTO consent_templates (tenant_id, key, version, title_ar, body_ar) VALUES ('11111111-1111-1111-1111-111111111111', 'Bad Key', 1, 'عنوان', 'نص طويل بما يكفي لنص موافقة تجريبي')$$,
  'consent_templates_key_format', 'a key is short lowercase letters');

-- signing on screen: the text comes from the database, whatever the client sends
INSERT INTO patient_consents (tenant_id, patient_id, template_id, locale, body_snapshot, signer_name, signature_file_id, recorded_by)
SELECT tenant_id, '70000000-0000-0000-0000-0000000000a1', id, 'en', 'نص مزوّر', ' عمر خالد ', 'f9000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a2'
  FROM consent_templates WHERE key = 'extraction' AND version = 2;
SELECT test.ok((SELECT c.body_snapshot = t.body_ar AND c.title_snapshot = 'موافقة على خلع سن' AND c.locale = 'ar' AND c.method = 'screen'
                FROM patient_consents c JOIN consent_templates t ON t.id = c.template_id), 'the exact reviewed text is kept, not the client''s');
SELECT test.throws($$INSERT INTO patient_consents (tenant_id, patient_id, template_id, locale, body_snapshot, signer_name, signature_file_id)
  SELECT tenant_id, '70000000-0000-0000-0000-0000000000a1', id, 'ar', 'x', 'عمر', 'f9000000-0000-0000-0000-000000000001' FROM consent_templates WHERE key = 'extraction' AND version = 1$$,
  'a draft is reviewed before it is signed', 'an older version is not signed either');
SELECT test.throws($$INSERT INTO patient_consents (tenant_id, patient_id, template_id, locale, body_snapshot, signer_name, signature_file_id)
  SELECT tenant_id, '70000000-0000-0000-0000-0000000000a1', id, 'ar', 'x', 'عمر', 'f9000000-0000-0000-0000-000000000003' FROM consent_templates WHERE key = 'extraction' AND version = 2$$,
  'private consent file', 'the signature must be a consent file (not an X-ray)');
SELECT test.throws($$INSERT INTO patient_consents (tenant_id, patient_id, template_id, locale, body_snapshot, signer_name, method, signature_file_id)
  SELECT tenant_id, '70000000-0000-0000-0000-0000000000a1', id, 'ar', 'x', 'عمر', 'paper', 'f9000000-0000-0000-0000-000000000001' FROM consent_templates WHERE key = 'extraction' AND version = 2$$,
  'patient_consents_method', 'a paper consent carries the scan, not a drawn signature');

-- on paper, signed by a guardian
INSERT INTO patient_consents (tenant_id, patient_id, template_id, locale, body_snapshot, signer_name, signer_relation, method, paper_file_id)
SELECT tenant_id, '70000000-0000-0000-0000-0000000000a2', id, 'ar', '', 'علي محمود', 'sibling', 'paper', 'f9000000-0000-0000-0000-000000000002'
  FROM consent_templates WHERE key = 'extraction' AND version = 2;
SELECT test.ok((SELECT count(*) = 2 FROM patient_consents), 'a guardian (a sibling too) signs on paper');

-- never changed nor deleted; withdrawn once, with a reason
SELECT test.throws($$UPDATE patient_consents SET signer_name = 'شخص آخر'$$, 'never changed', 'a signed consent is never changed');
SELECT test.throws($$DELETE FROM patient_consents$$, 'permission denied', 'nor deleted');
SELECT test.throws($$UPDATE patient_consents SET revoked_at = now(), revoked_by = 'c0000000-0000-0000-0000-0000000000a1' WHERE patient_id = '70000000-0000-0000-0000-0000000000a1'$$,
  'patient_consents_revoked', 'withdrawing it needs a reason');
UPDATE patient_consents SET revoked_at = now() - interval '1 year', revoked_by = 'c0000000-0000-0000-0000-0000000000a1', revoke_reason = 'طلب المريض'
 WHERE patient_id = '70000000-0000-0000-0000-0000000000a1';
SELECT test.ok((SELECT revoked_at > now() - interval '1 minute' FROM patient_consents WHERE patient_id = '70000000-0000-0000-0000-0000000000a1'),
  'withdrawn, at the time it really happened');
SELECT test.throws($$UPDATE patient_consents SET revoked_at = now(), revoked_by = 'c0000000-0000-0000-0000-0000000000a1', revoke_reason = 'مرة أخرى' WHERE patient_id = '70000000-0000-0000-0000-0000000000a1'$$,
  'never changed', 'withdrawn once');

-- an archived text is not signed
UPDATE consent_templates SET is_active = false WHERE key = 'extraction';
SELECT test.throws($$INSERT INTO patient_consents (tenant_id, patient_id, template_id, locale, body_snapshot, signer_name, signature_file_id)
  SELECT tenant_id, '70000000-0000-0000-0000-0000000000a1', id, 'ar', 'x', 'عمر', 'f9000000-0000-0000-0000-000000000001' FROM consent_templates WHERE key = 'extraction' AND version = 2$$,
  'archived', 'an archived text is not signed');

-- another clinic sees none of it
SELECT set_config('app.tenant_id', '22222222-2222-2222-2222-222222222222', true);
SELECT test.ok(NOT EXISTS (SELECT 1 FROM patient_consents) AND (SELECT count(*) = 4 FROM consent_templates), 'another clinic sees only its own');
ROLLBACK;
