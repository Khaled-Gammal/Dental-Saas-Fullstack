-- Phase H2: an expense's supporting document (SRS EXP-001) — attached once, private, never replaced or removed
\set ON_ERROR_STOP 1
BEGIN;
-- a public website image of clinic A, and a private file of clinic B (made before acting as clinic A)
INSERT INTO files (id, tenant_id, bucket, object_key, mime_type, size_bytes, kind, is_private) VALUES
  ('fe000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'local', 't/b/expenses/x', 'application/pdf', 10, 'document', true),
  ('fe000000-0000-0000-0000-0000000000a9', '11111111-1111-1111-1111-111111111111', 'local', 't/a/gallery/x', 'image/webp', 10, 'image', false);
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-0000000000a2';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a2';
SELECT id AS supplies FROM expense_categories WHERE key = 'supplies' \gset
SELECT business_date(now(), '11111111-1111-1111-1111-111111111111') AS today \gset
INSERT INTO files (id, tenant_id, bucket, object_key, mime_type, size_bytes, kind, is_private) VALUES
  ('fe000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'local', 't/a/expenses/1', 'application/pdf', 10, 'document', true),
  ('fe000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'local', 't/a/expenses/2', 'image/jpeg', 10, 'document', true),
  ('fe000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'local', 't/a/expenses/3', 'image/png', 10, 'document', true);
INSERT INTO expenses (id, tenant_id, branch_id, category_id, amount_minor, currency, spent_on, payment_method, description, status, created_by) VALUES
  ('ee000000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', :'supplies', 1000, 'EGP', :'today', 'cash', 'h2 later', 'pending', 'c0000000-0000-0000-0000-0000000000a2'),
  ('ee000000-0000-0000-0000-0000000000d2', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', :'supplies', 1000, 'EGP', :'today', 'cash', 'h2 void', 'pending', 'c0000000-0000-0000-0000-0000000000a2');

-- recorded with its document, or attached later, once
INSERT INTO expenses (tenant_id, branch_id, category_id, amount_minor, currency, spent_on, payment_method, description, status, created_by, file_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', :'supplies', 1000, 'EGP', :'today', 'cash', 'h2 with', 'pending',
        'c0000000-0000-0000-0000-0000000000a2', 'fe000000-0000-0000-0000-0000000000a3');
SELECT test.ok(EXISTS (SELECT 1 FROM expenses WHERE description = 'h2 with' AND file_id IS NOT NULL), 'an expense can be recorded with its document');
UPDATE expenses SET file_id = 'fe000000-0000-0000-0000-0000000000a1' WHERE id = 'ee000000-0000-0000-0000-0000000000d1';
SELECT test.ok((SELECT file_id = 'fe000000-0000-0000-0000-0000000000a1' FROM expenses WHERE id = 'ee000000-0000-0000-0000-0000000000d1'),
  'a document can be attached to a recorded expense');
SELECT test.throws($$UPDATE expenses SET file_id = 'fe000000-0000-0000-0000-0000000000a2' WHERE id = 'ee000000-0000-0000-0000-0000000000d1'$$,
  'attached once', 'the document is not replaced');
SELECT test.throws($$UPDATE expenses SET file_id = NULL WHERE id = 'ee000000-0000-0000-0000-0000000000d1'$$,
  'attached once', 'the document is not removed');
SELECT test.throws($$UPDATE expenses SET amount_minor = 2000 WHERE id = 'ee000000-0000-0000-0000-0000000000d1'$$,
  'not edited', 'the rest of a recorded expense stays fixed');

-- not on a void expense; private files of this clinic only; one expense per file
UPDATE expenses SET status = 'void', void_reason = 'خطأ', voided_by = 'c0000000-0000-0000-0000-0000000000a2', voided_at = now()
 WHERE id = 'ee000000-0000-0000-0000-0000000000d2';
SELECT test.throws($$UPDATE expenses SET file_id = 'fe000000-0000-0000-0000-0000000000a2' WHERE id = 'ee000000-0000-0000-0000-0000000000d2'$$,
  'attached once', 'a void expense gets no document');
SELECT test.throws($$INSERT INTO expenses (tenant_id, branch_id, category_id, amount_minor, currency, spent_on, payment_method, status, created_by, file_id)
  VALUES ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', (SELECT id FROM expense_categories WHERE key = 'supplies'), 1000, 'EGP',
          business_date(now(), '11111111-1111-1111-1111-111111111111'), 'cash', 'pending', 'c0000000-0000-0000-0000-0000000000a2', 'fe000000-0000-0000-0000-0000000000a9')$$,
  'private file of the clinic', 'a public file is not an expense document');
SELECT test.throws($$INSERT INTO expenses (tenant_id, branch_id, category_id, amount_minor, currency, spent_on, payment_method, status, created_by, file_id)
  VALUES ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', (SELECT id FROM expense_categories WHERE key = 'supplies'), 1000, 'EGP',
          business_date(now(), '11111111-1111-1111-1111-111111111111'), 'cash', 'pending', 'c0000000-0000-0000-0000-0000000000a2', 'fe000000-0000-0000-0000-0000000000b1')$$,
  'private file of the clinic', 'another clinic''s file is not an expense document');
SELECT test.throws($$INSERT INTO expenses (tenant_id, branch_id, category_id, amount_minor, currency, spent_on, payment_method, status, created_by, file_id)
  VALUES ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', (SELECT id FROM expense_categories WHERE key = 'supplies'), 1000, 'EGP',
          business_date(now(), '11111111-1111-1111-1111-111111111111'), 'cash', 'pending', 'c0000000-0000-0000-0000-0000000000a2', 'fe000000-0000-0000-0000-0000000000a1')$$,
  'expenses_file', 'one file belongs to one expense');
ROLLBACK;
