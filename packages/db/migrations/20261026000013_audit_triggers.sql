-- migrate:up
-- Phase C, part 2: the database writes the audit trail for money and appointments (SRS AUDIT-001, AUDIT-003), in the
-- same transaction as the change, so no code path can skip it. The actor comes from the request settings the API sets
-- in every transaction (app.user_id, app.actor_type); jobs without them are recorded as 'system'.

-- One row per insert/update/delete. `changes` = {"column": [old, new]} for changed columns; columns named in the
-- trigger arguments after the entity name are personal free text and are recorded as `true` (changed), never their
-- value (SRS 6.9). An UPDATE that changes nothing but updated_at writes no row.
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_entity text := TG_ARGV[0];
  v_secret text[] := coalesce(TG_ARGV[1:], ARRAY[]::text[]);
  v_changes jsonb := '{}';
  v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  v_actor text := nullif(current_setting('app.actor_type', true), '');
  k text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(coalesce(n, o)) LOOP
    CONTINUE WHEN k IN ('id', 'tenant_id', 'updated_at', 'created_at');
    IF (o -> k) IS DISTINCT FROM (n -> k) THEN
      v_changes := v_changes || jsonb_build_object(k,
        CASE WHEN k = ANY (v_secret) THEN 'true'::jsonb ELSE jsonb_build_array(o -> k, n -> k) END);
    END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND v_changes = '{}' THEN RETURN NULL; END IF;
  INSERT INTO audit_log (tenant_id, actor_type, actor_user_id, action, entity_type, entity_id, changes)
  VALUES ((coalesce(n, o) ->> 'tenant_id')::uuid,
          coalesce(v_actor, CASE WHEN v_user IS NOT NULL THEN 'member' ELSE 'system' END),
          CASE WHEN coalesce(v_actor, 'member') = 'member' THEN v_user END,
          v_entity || '.' || CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,
          v_entity, (coalesce(n, o) ->> 'id')::uuid, v_changes);
  RETURN NULL;
END $$;

-- Money (AUDIT-001). Descriptions and notes may hold personal details: "changed", not the text.
CREATE TRIGGER audit_invoices AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('invoice', 'notes');
CREATE TRIGGER audit_invoice_items AFTER INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('invoice_item', 'description');
CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('payment', 'notes');
CREATE TRIGGER audit_refunds AFTER INSERT OR UPDATE OR DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('refund');
CREATE TRIGGER audit_payment_plans AFTER INSERT OR UPDATE OR DELETE ON payment_plans
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('payment_plan', 'notes');
CREATE TRIGGER audit_installments AFTER INSERT OR UPDATE OR DELETE ON installments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('installment');
CREATE TRIGGER audit_expenses AFTER INSERT OR UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('expense', 'description');

-- Appointments (AUDIT-003): bookings, moves and status changes. Website holds that are only reserved and then released
-- are not business events, so `held` inserts and `held -> expired` are left out; a hold that becomes a booking is kept.
-- Codes are hashes and notes are free text: recorded as changed only.
CREATE TRIGGER audit_appointments_insert AFTER INSERT ON appointments
  FOR EACH ROW WHEN (NEW.status <> 'held')
  EXECUTE FUNCTION audit_row_change('appointment', 'patient_notes', 'internal_notes', 'cancel_reason', 'check_in_note',
                                    'override_reason', 'check_in_code_hash', 'manage_token_hash');
CREATE TRIGGER audit_appointments_update AFTER UPDATE ON appointments
  FOR EACH ROW WHEN (NOT (OLD.status = 'held' AND NEW.status IN ('held', 'expired')))
  EXECUTE FUNCTION audit_row_change('appointment', 'patient_notes', 'internal_notes', 'cancel_reason', 'check_in_note',
                                    'override_reason', 'check_in_code_hash', 'manage_token_hash');
CREATE TRIGGER audit_appointments_delete AFTER DELETE ON appointments
  FOR EACH ROW WHEN (OLD.status <> 'held')
  EXECUTE FUNCTION audit_row_change('appointment', 'patient_notes', 'internal_notes', 'cancel_reason', 'check_in_note',
                                    'override_reason', 'check_in_code_hash', 'manage_token_hash');

-- the trail is read per record and per clinic over time (both indexes exist since 0001)

-- migrate:down
DROP TRIGGER IF EXISTS audit_appointments_delete ON appointments;
DROP TRIGGER IF EXISTS audit_appointments_update ON appointments;
DROP TRIGGER IF EXISTS audit_appointments_insert ON appointments;
DROP TRIGGER IF EXISTS audit_expenses ON expenses;
DROP TRIGGER IF EXISTS audit_installments ON installments;
DROP TRIGGER IF EXISTS audit_payment_plans ON payment_plans;
DROP TRIGGER IF EXISTS audit_refunds ON refunds;
DROP TRIGGER IF EXISTS audit_payments ON payments;
DROP TRIGGER IF EXISTS audit_invoice_items ON invoice_items;
DROP TRIGGER IF EXISTS audit_invoices ON invoices;
DROP FUNCTION IF EXISTS audit_row_change();
