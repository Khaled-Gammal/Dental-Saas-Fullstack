-- migrate:up
-- Phase 2D: the clinic's activity log (DSH-15) shows the audit trail to whoever holds audit:read. Some free-text columns
-- added after the audit triggers (reasons and notes people type) were recorded word for word; they are personal free
-- text like the descriptions and notes already listed, so from now on they are recorded as `true` (changed), never
-- their value (SRS 6.9). Older rows are redacted by the API when it reads them.
DROP TRIGGER IF EXISTS audit_invoices ON invoices;
CREATE TRIGGER audit_invoices AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('invoice', 'notes', 'void_reason', 'discount_reason', 'discount_note');
DROP TRIGGER IF EXISTS audit_invoice_items ON invoice_items;
CREATE TRIGGER audit_invoice_items AFTER INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('invoice_item', 'description', 'discount_reason');
DROP TRIGGER IF EXISTS audit_payments ON payments;
CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('payment', 'notes', 'reversal_reason');
DROP TRIGGER IF EXISTS audit_refunds ON refunds;
CREATE TRIGGER audit_refunds AFTER INSERT OR UPDATE OR DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('refund', 'reason');
DROP TRIGGER IF EXISTS audit_installments ON installments;
CREATE TRIGGER audit_installments AFTER INSERT OR UPDATE OR DELETE ON installments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('installment', 'waived_reason');
DROP TRIGGER IF EXISTS audit_expenses ON expenses;
CREATE TRIGGER audit_expenses AFTER INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('expense', 'description', 'decision_note', 'void_reason');
DROP TRIGGER IF EXISTS audit_balance_adjustments ON balance_adjustments;
CREATE TRIGGER audit_balance_adjustments AFTER INSERT ON balance_adjustments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('balance_adjustment', 'reason');
-- a reopening keeps a copy of the day's closing note (private on the cash session itself)
DROP TRIGGER IF EXISTS audit_cash_session_reopenings ON cash_session_reopenings;
CREATE TRIGGER audit_cash_session_reopenings AFTER INSERT ON cash_session_reopenings
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('cash_session_reopening', 'reason', 'previous_note');

-- migrate:down
DROP TRIGGER IF EXISTS audit_invoices ON invoices;
CREATE TRIGGER audit_invoices AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('invoice', 'notes');
DROP TRIGGER IF EXISTS audit_invoice_items ON invoice_items;
CREATE TRIGGER audit_invoice_items AFTER INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('invoice_item', 'description');
DROP TRIGGER IF EXISTS audit_payments ON payments;
CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('payment', 'notes');
DROP TRIGGER IF EXISTS audit_refunds ON refunds;
CREATE TRIGGER audit_refunds AFTER INSERT OR UPDATE OR DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('refund');
DROP TRIGGER IF EXISTS audit_installments ON installments;
CREATE TRIGGER audit_installments AFTER INSERT OR UPDATE OR DELETE ON installments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('installment');
DROP TRIGGER IF EXISTS audit_expenses ON expenses;
CREATE TRIGGER audit_expenses AFTER INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('expense', 'description');
DROP TRIGGER IF EXISTS audit_balance_adjustments ON balance_adjustments;
CREATE TRIGGER audit_balance_adjustments AFTER INSERT ON balance_adjustments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('balance_adjustment');
DROP TRIGGER IF EXISTS audit_cash_session_reopenings ON cash_session_reopenings;
CREATE TRIGGER audit_cash_session_reopenings AFTER INSERT ON cash_session_reopenings
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('cash_session_reopening', 'reason');
