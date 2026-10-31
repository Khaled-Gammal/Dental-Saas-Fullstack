-- Phase 2C-1: the website's sections and the clinic's questions (faqs). Clinic A 1111…, clinic B 2222….
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SELECT set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true);

-- sections: a list, kept short
SELECT test.ok((SELECT sections = '[]'::jsonb FROM sites), 'no layout set: the default order');
SELECT test.lives($$UPDATE sites SET sections = '[{"key":"faq","visible":true},{"key":"services","visible":false}]'$$, 'the clinic sets its layout');
SELECT test.throws($$UPDATE sites SET sections = '{"key":"faq"}'$$, 'sites_sections_array', 'a layout is a list');

-- questions: Arabic required, sensible lengths; the clinic adds, edits and deletes its own
SELECT test.throws($$INSERT INTO faqs (tenant_id, question_ar, answer_ar) VALUES ('11111111-1111-1111-1111-111111111111', 'سؤال؟', null)$$,
  'faqs_answer_ar', 'an answer is required');
SELECT test.throws($$INSERT INTO faqs (tenant_id, question_ar, answer_ar) VALUES ('11111111-1111-1111-1111-111111111111', ' ؟ ', 'نعم')$$,
  'faqs_question_ar', 'a question is a real question');
INSERT INTO faqs (tenant_id, question_ar, answer_ar, sort_order) VALUES ('11111111-1111-1111-1111-111111111111', 'هل تقبلون التأمين الطبي؟', 'نعم، مع أغلب الشركات.', 0);
SELECT test.ok((SELECT count(*) = 1 FROM faqs), 'the question is saved');
UPDATE faqs SET answer_ar = 'نعم، مع شركات التأمين الكبرى.', updated_at = now() - interval '1 day';
SELECT test.ok((SELECT updated_at > now() - interval '1 minute' FROM faqs), 'an edit stamps updated_at');
SELECT test.throws($$INSERT INTO faqs (tenant_id, question_ar, answer_ar) VALUES ('22222222-2222-2222-2222-222222222222', 'سؤال عيادة أخرى؟', 'لا')$$,
  'row-level security', 'not for another clinic');
SELECT set_config('app.tenant_id', '22222222-2222-2222-2222-222222222222', true);
SELECT test.ok((SELECT count(*) = 0 FROM faqs), 'another clinic does not see them');
SELECT set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true);
SELECT test.lives($$DELETE FROM faqs$$, 'the clinic deletes its questions');
SELECT test.ok((SELECT count(*) = 0 FROM faqs), 'gone');
ROLLBACK;
