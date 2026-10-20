-- Phase H6: legal documents (NFR-15) — published by the platform only, accepted once, re-accepted when a version asks
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
-- the placeholders are in, and the demo members accepted them (owners the DPA for their clinic)
SELECT test.ok((SELECT count(*) = 3 FROM legal_documents), 'one version of each document');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM legal_pending('b0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', true)),
  'the clinic owner has nothing to accept');
SELECT test.ok((SELECT array_agg(kind ORDER BY kind) = '{dpa,privacy,terms}' FROM legal_pending('b0000000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111', true)),
  'someone who never accepted owes every document (an owner: the DPA too)');
SELECT test.ok((SELECT array_agg(kind ORDER BY kind) = '{privacy,terms}' FROM legal_pending('b0000000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111', false)),
  'staff owe Terms and Privacy, not the DPA');
SELECT test.ok((SELECT array_agg(kind) = '{dpa}' FROM legal_pending('b0000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', true)),
  'the DPA is accepted per clinic');

-- only the platform publishes
SELECT test.throws($$INSERT INTO legal_documents (kind, version, title_ar, body_ar) VALUES ('terms', 9, 'شروط', 'نص طويل بما يكفي للاختبار هنا')$$,
  'permission denied', 'the API role does not write documents');
SELECT test.throws($$SELECT platform_publish_legal('b0000000-0000-0000-0000-0000000000a1', 'terms', 'شروط', 'نص طويل بما يكفي للاختبار هنا', true)$$,
  'not a platform admin', 'a clinic owner does not publish');
SELECT test.throws($$SELECT platform_publish_legal('b0000000-0000-0000-0000-0000000000f1', 'cookies', 'ملفات', 'نص طويل بما يكفي للاختبار هنا', false)$$,
  'legal_documents_kind', 'only the three documents');

-- a new version that asks to be accepted again: those who accepted an older one owe it; one that does not ask: nobody
SELECT platform_publish_legal('b0000000-0000-0000-0000-0000000000f1', 'terms', 'شروط الاستخدام', 'الإصدار الثاني من شروط الاستخدام للاختبار', true);
SELECT platform_publish_legal('b0000000-0000-0000-0000-0000000000f1', 'privacy', 'سياسة الخصوصية', 'الإصدار الثاني من سياسة الخصوصية للاختبار', false);
SELECT test.ok((SELECT array_agg(kind || version) = '{terms2}' FROM legal_pending('b0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', true)),
  'version 2 of the Terms is owed again; the new Privacy is not');
INSERT INTO legal_acceptances (user_id, document_id) SELECT 'b0000000-0000-0000-0000-0000000000a1', id FROM legal_documents WHERE kind = 'terms' AND version = 2;
SELECT test.ok(NOT EXISTS (SELECT 1 FROM legal_pending('b0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', true)),
  'accepting it clears it');
SELECT test.throws($$INSERT INTO legal_acceptances (user_id, document_id) SELECT 'b0000000-0000-0000-0000-0000000000a1', id FROM legal_documents WHERE kind = 'terms' AND version = 2$$,
  'legal_acceptances_once', 'an acceptance is recorded once');
SELECT test.throws($$UPDATE legal_acceptances SET accepted_at = now() - interval '1 year'$$, 'permission denied', 'an acceptance is never changed');
SELECT test.throws($$DELETE FROM legal_acceptances$$, 'permission denied', 'nor deleted');
SELECT test.ok((SELECT count(*) = 2 FROM platform_audit_log WHERE action = 'legal.published'), 'publishing is in the platform audit log');
ROLLBACK;
