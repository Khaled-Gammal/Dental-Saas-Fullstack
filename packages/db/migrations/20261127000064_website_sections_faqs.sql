-- migrate:up
-- Phase 2C-1 (owner 2026-10-31): the clinic website's sections and its questions.
--
--   * sites.sections: the order of the website's sections and which are shown, as the clinic set them
--     ([{"key":"services","visible":true}, ...]). Empty = the default order, all shown. The API checks the keys; the
--     site fills in any key a list does not name (a section added later appears in its default place).
--   * faqs (in the schema since the start, unused until now): the clinic's questions and answers, shown on its site
--     (and to search engines as FAQPage). Arabic is required (the site is Arabic); an optional link to a service is
--     kept for the service pages to come.

ALTER TABLE sites ADD COLUMN sections jsonb NOT NULL DEFAULT '[]'
  CONSTRAINT sites_sections_array CHECK (jsonb_typeof(sections) = 'array' AND jsonb_array_length(sections) <= 20);

ALTER TABLE faqs
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT faqs_question_ar CHECK (question_ar IS NOT NULL AND char_length(btrim(question_ar)) BETWEEN 5 AND 300),
  ADD CONSTRAINT faqs_answer_ar CHECK (answer_ar IS NOT NULL AND char_length(btrim(answer_ar)) BETWEEN 2 AND 3000),
  ADD CONSTRAINT faqs_question_en CHECK (question_en IS NULL OR char_length(question_en) <= 300),
  ADD CONSTRAINT faqs_answer_en CHECK (answer_en IS NULL OR char_length(answer_en) <= 3000);
CREATE TRIGGER faqs_set_updated_at BEFORE UPDATE ON faqs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- the clinic deletes its own questions (0046 left app_user DELETE only where the API deletes)
GRANT DELETE ON faqs TO app_user;

-- migrate:down
REVOKE DELETE ON faqs FROM app_user;
DROP TRIGGER IF EXISTS faqs_set_updated_at ON faqs;
ALTER TABLE faqs
  DROP CONSTRAINT IF EXISTS faqs_answer_en, DROP CONSTRAINT IF EXISTS faqs_question_en,
  DROP CONSTRAINT IF EXISTS faqs_answer_ar, DROP CONSTRAINT IF EXISTS faqs_question_ar,
  DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS created_at;
ALTER TABLE sites DROP COLUMN IF EXISTS sections;
