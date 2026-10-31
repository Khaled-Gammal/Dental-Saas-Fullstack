-- Phase 2D: reasons and notes people type are recorded in the audit trail as "changed", never their words.
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_worker;
SELECT test.ok(
  (SELECT bool_and(t.tgargs IS NOT NULL) FROM pg_trigger t WHERE t.tgname IN ('audit_invoices', 'audit_refunds', 'audit_expenses', 'audit_balance_adjustments', 'audit_payments', 'audit_installments', 'audit_invoice_items', 'audit_cash_session_reopenings')),
  'the money triggers exist');
SELECT test.ok(
  (SELECT count(*) FROM pg_trigger t, unnest(string_to_array(rtrim(encode(t.tgargs, 'escape'), E'\\000'), E'\\000')) a
    WHERE NOT t.tgisinternal AND (t.tgname, a) IN (('audit_invoices', 'void_reason'), ('audit_invoices', 'discount_reason'), ('audit_invoices', 'discount_note'),
      ('audit_invoice_items', 'discount_reason'), ('audit_payments', 'reversal_reason'), ('audit_refunds', 'reason'),
      ('audit_installments', 'waived_reason'), ('audit_expenses', 'decision_note'), ('audit_expenses', 'void_reason'),
      ('audit_balance_adjustments', 'reason'), ('audit_cash_session_reopenings', 'previous_note'))) = 11,
  'each typed reason is marked private');
-- the effect: a refund's reason is recorded as changed only
CREATE TEMP TABLE t_audit_probe (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, reason text, amount int);
CREATE TRIGGER audit_probe AFTER INSERT ON t_audit_probe FOR EACH ROW EXECUTE FUNCTION audit_row_change('probe', 'reason');
INSERT INTO t_audit_probe (tenant_id, reason, amount) VALUES ('11111111-1111-1111-1111-111111111111', 'المريض طلب الاسترداد لأسباب شخصية', 5);
SELECT test.ok((SELECT changes -> 'reason' = 'true'::jsonb AND changes -> 'amount' = '[null, 5]'::jsonb FROM audit_log WHERE entity_type = 'probe'),
  'the words are not stored; amounts are');
SELECT test.ok(EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'audit_log_tenant_actor_created'), 'the log has its by-member index');
ROLLBACK;
