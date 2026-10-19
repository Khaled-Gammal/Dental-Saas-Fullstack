-- migrate:up
-- Phase C (security and data integrity), part 1: recorded money cannot change silently, related records must agree,
-- and "who did it" columns point at real clinic members. SRS PAY-003, SEC-101, SEC-102, APPT-002.
-- Additive: new triggers, replaced function bodies, new constraints. No data is rewritten.

-- ---------------------------------------------------------------------
-- 1. Payments: once a payment has left `pending`, its facts never change, and payments are never deleted.
--    Mistakes are corrected by a refund (now) or a reversal (billing phase), both of which keep the original row.
--    status/refunded_minor stay writable: refunds_changed() maintains them.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('app.allow_hard_delete', true), '') <> 'on' THEN
      RAISE EXCEPTION 'payment % cannot be deleted; refund it instead', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'pending' THEN
    IF NEW.status = 'pending' OR NEW.status IN ('succeeded','failed') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'a pending payment can only succeed or fail (got %)', NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.tenant_id, NEW.branch_id, NEW.patient_id, NEW.invoice_id, NEW.appointment_id, NEW.installment_id, NEW.amount_minor,
      NEW.currency, NEW.method, NEW.paid_at, NEW.received_by, NEW.provider, NEW.provider_ref, NEW.idempotency_key, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.branch_id, OLD.patient_id, OLD.invoice_id, OLD.appointment_id, OLD.installment_id, OLD.amount_minor,
      OLD.currency, OLD.method, OLD.paid_at, OLD.received_by, OLD.provider, OLD.provider_ref, OLD.idempotency_key, OLD.created_at) THEN
    RAISE EXCEPTION 'payment % is recorded and cannot be changed; refund it instead', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'failed' AND NEW.status <> 'failed' THEN
    RAISE EXCEPTION 'a failed payment cannot change status' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('succeeded','partially_refunded','refunded') AND NEW.status NOT IN ('succeeded','partially_refunded','refunded') THEN
    RAISE EXCEPTION 'payment % cannot go from % to %', OLD.id, OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_guard BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_guard();

-- Refunds are facts too: the API may add them, never change or remove them (refunds_changed() writes payments only).
REVOKE UPDATE, DELETE ON refunds FROM app_user;

-- ---------------------------------------------------------------------
-- 2. Payments must agree with their invoice (now also its branch) and with their installment's plan.
--    Same checks as before, plus: branch = invoice branch; invoice = the installment plan's invoice.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION payments_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv record; pl record; v_appt_patient uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS NOT NULL AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM 1 FROM invoices WHERE id = OLD.invoice_id FOR UPDATE;
  END IF;
  IF NEW.invoice_id IS NOT NULL THEN
    SELECT currency, status, patient_id, branch_id INTO inv FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
    -- not visible to this caller (another branch): never pay an invoice the caller cannot see
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice % not found', NEW.invoice_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF inv.currency <> NEW.currency THEN
      RAISE EXCEPTION 'payment currency % differs from invoice currency %', NEW.currency, inv.currency
        USING ERRCODE = 'check_violation';
    END IF;
    IF inv.patient_id <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment patient does not match the invoice patient' USING ERRCODE = 'check_violation';
    END IF;
    IF inv.branch_id <> NEW.branch_id THEN
      RAISE EXCEPTION 'payment branch does not match the invoice branch' USING ERRCODE = 'check_violation';
    END IF;
    IF inv.status IN ('draft','void') AND NEW.status IN ('succeeded','partially_refunded')
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.invoice_id IS DISTINCT FROM NEW.invoice_id) THEN
      RAISE EXCEPTION 'cannot pay a % invoice', inv.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.installment_id IS NOT NULL THEN
    SELECT p.currency, p.patient_id, p.invoice_id INTO pl
    FROM installments s JOIN payment_plans p ON p.id = s.plan_id
    WHERE s.id = NEW.installment_id FOR UPDATE OF s;
    IF NOT FOUND THEN RAISE EXCEPTION 'installment % not found', NEW.installment_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF pl.currency <> NEW.currency OR pl.patient_id <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment currency/patient does not match the installment plan' USING ERRCODE = 'check_violation';
    END IF;
    IF pl.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
      RAISE EXCEPTION 'an installment payment must be made against its plan''s invoice' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.appointment_id IS NOT NULL THEN
    SELECT patient_id INTO v_appt_patient FROM appointments WHERE id = NEW.appointment_id;
    IF v_appt_patient IS NOT NULL AND v_appt_patient <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment patient does not match the appointment patient' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 3. Installment plans: a plan on an invoice needs an issued invoice of the same patient/currency and the same total;
--    down payment + installments = plan total, and the number of installments matches. Checked at COMMIT (deferred),
--    so a plan and its installments can be written in one transaction.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION payment_plans_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv record;
BEGIN
  IF NEW.invoice_id IS NOT NULL THEN
    SELECT currency, patient_id, status, total_minor INTO inv FROM invoices WHERE id = NEW.invoice_id;
    IF inv.currency <> NEW.currency OR inv.patient_id <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment plan currency/patient does not match the invoice' USING ERRCODE = 'check_violation';
    END IF;
    IF inv.status IN ('draft','void') THEN
      RAISE EXCEPTION 'an installment plan needs an issued invoice (this one is %)', inv.status USING ERRCODE = 'check_violation';
    END IF;
    IF inv.total_minor <> NEW.total_minor THEN
      RAISE EXCEPTION 'payment plan total % differs from the invoice total %', NEW.total_minor, inv.total_minor
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION payment_plans_check_totals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_plan uuid; p record; v_sum bigint; v_count int;
BEGIN
  -- one function for both tables; fields are read through jsonb because the two row types differ
  IF TG_TABLE_NAME = 'payment_plans' THEN v_plan := NEW.id;
  ELSE v_plan := coalesce(to_jsonb(NEW) ->> 'plan_id', to_jsonb(OLD) ->> 'plan_id')::uuid;
  END IF;
  SELECT total_minor, down_payment_minor, installments_count INTO p FROM payment_plans WHERE id = v_plan;
  IF NOT FOUND THEN RETURN NULL; END IF;  -- the plan itself was deleted in this transaction
  SELECT coalesce(sum(amount_minor), 0), count(*) INTO v_sum, v_count FROM installments WHERE plan_id = v_plan;
  IF p.down_payment_minor + v_sum <> p.total_minor OR v_count <> p.installments_count THEN
    RAISE EXCEPTION 'installments (% x %, sum %) plus down payment % do not add up to the plan total %',
      v_count, p.installments_count, v_sum, p.down_payment_minor, p.total_minor USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER payment_plans_totals AFTER INSERT OR UPDATE ON payment_plans
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payment_plans_check_totals();
CREATE CONSTRAINT TRIGGER installments_totals AFTER INSERT OR UPDATE OR DELETE ON installments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payment_plans_check_totals();

-- ---------------------------------------------------------------------
-- 4. Clinical records agree with each other.
-- ---------------------------------------------------------------------
-- a visit belongs to the same patient, doctor and branch as its appointment
CREATE OR REPLACE FUNCTION visits_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a record;
BEGIN
  IF NEW.appointment_id IS NOT NULL THEN
    SELECT patient_id, doctor_id, branch_id INTO a FROM appointments WHERE id = NEW.appointment_id;
    IF (a.patient_id, a.doctor_id, a.branch_id) IS DISTINCT FROM (NEW.patient_id, NEW.doctor_id, NEW.branch_id) THEN
      RAISE EXCEPTION 'visit patient/doctor/branch must match its appointment' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER visits_validate BEFORE INSERT OR UPDATE OF appointment_id, patient_id, doctor_id, branch_id ON visits
  FOR EACH ROW EXECUTE FUNCTION visits_validate();

-- a performed procedure can only complete a planned item of the same patient
CREATE OR REPLACE FUNCTION visit_procedures_validate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plan_item_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM treatment_plan_items i
       JOIN treatment_plans tp ON tp.id = i.plan_id
       JOIN visits v ON v.id = NEW.visit_id
       WHERE i.id = NEW.plan_item_id AND tp.patient_id = v.patient_id) THEN
    RAISE EXCEPTION 'the treatment plan item belongs to another patient' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER visit_procedures_validate BEFORE INSERT OR UPDATE OF plan_item_id, visit_id ON visit_procedures
  FOR EACH ROW EXECUTE FUNCTION visit_procedures_validate();

-- a plan's estimate is the sum of its (non-cancelled) items; a typed value is ignored, like invoice totals
CREATE OR REPLACE FUNCTION treatment_plans_derive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.total_estimate_minor := (SELECT coalesce(sum(price_minor - discount_minor), 0) FROM treatment_plan_items
                               WHERE plan_id = NEW.id AND status <> 'cancelled');
  RETURN NEW;
END $$;
CREATE TRIGGER treatment_plans_derive BEFORE INSERT OR UPDATE ON treatment_plans
  FOR EACH ROW EXECUTE FUNCTION treatment_plans_derive();

CREATE OR REPLACE FUNCTION treatment_plan_items_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE treatment_plans SET updated_at = now()
  WHERE id IN (CASE WHEN TG_OP <> 'DELETE' THEN NEW.plan_id END, CASE WHEN TG_OP <> 'INSERT' THEN OLD.plan_id END);
  RETURN NULL;
END $$;
CREATE TRIGGER treatment_plan_items_changed AFTER INSERT OR UPDATE OR DELETE ON treatment_plan_items
  FOR EACH ROW EXECUTE FUNCTION treatment_plan_items_changed();

-- ---------------------------------------------------------------------
-- 5. A booking (or a move) is for an active doctor who works at that branch. The API checks it first for a clear
--    message; this is the last guard (APPT-002). Status changes alone are not re-checked.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION appointments_validate_doctor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM doctors d JOIN doctor_branches db ON db.doctor_id = d.id AND db.branch_id = NEW.branch_id
                 WHERE d.id = NEW.doctor_id AND d.is_active) THEN
    RAISE EXCEPTION 'the doctor is not active at this branch' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointments_validate_doctor BEFORE INSERT OR UPDATE OF doctor_id, branch_id ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_validate_doctor();

-- ---------------------------------------------------------------------
-- 6. "Who did it" columns reference a member of the same clinic (SEC-102). Checked against existing rows first, so a
--    bad value stops the migration with a clear message instead of being changed.
-- ---------------------------------------------------------------------
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('payments','received_by'), ('refunds','created_by'), ('expenses','created_by'),
      ('invoices','created_by'), ('visits','created_by'), ('payment_plans','created_by'), ('patients','created_by'),
      ('patient_medical_history','updated_by'), ('files','uploaded_by')) t(tbl, col)
  LOOP
    EXECUTE format('SELECT count(*) FROM %I x WHERE x.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant_members m
                    WHERE m.tenant_id = x.tenant_id AND m.id = x.%I)', r.tbl, r.col, r.col) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '%.% has % value(s) that are not members of the clinic; fix them before this migration', r.tbl, r.col, n;
    END IF;
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, %I) REFERENCES tenant_members (tenant_id, id) NOT VALID',
                   r.tbl, r.tbl || '_' || r.col || '_member_fk', r.col);
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', r.tbl, r.tbl || '_' || r.col || '_member_fk');
  END LOOP;
END $$;

-- migrate:down
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_uploaded_by_member_fk;
ALTER TABLE patient_medical_history DROP CONSTRAINT IF EXISTS patient_medical_history_updated_by_member_fk;
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_created_by_member_fk;
ALTER TABLE payment_plans DROP CONSTRAINT IF EXISTS payment_plans_created_by_member_fk;
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_created_by_member_fk;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_created_by_member_fk;
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_created_by_member_fk;
ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_created_by_member_fk;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_received_by_member_fk;
DROP TRIGGER IF EXISTS appointments_validate_doctor ON appointments;
DROP FUNCTION IF EXISTS appointments_validate_doctor();
DROP TRIGGER IF EXISTS treatment_plan_items_changed ON treatment_plan_items;
DROP FUNCTION IF EXISTS treatment_plan_items_changed();
DROP TRIGGER IF EXISTS treatment_plans_derive ON treatment_plans;
DROP FUNCTION IF EXISTS treatment_plans_derive();
DROP TRIGGER IF EXISTS visit_procedures_validate ON visit_procedures;
DROP FUNCTION IF EXISTS visit_procedures_validate();
DROP TRIGGER IF EXISTS visits_validate ON visits;
DROP FUNCTION IF EXISTS visits_validate();
DROP TRIGGER IF EXISTS installments_totals ON installments;
DROP TRIGGER IF EXISTS payment_plans_totals ON payment_plans;
DROP FUNCTION IF EXISTS payment_plans_check_totals();
-- payment_plans_validate / payments_validate: back to the 0001 bodies
CREATE OR REPLACE FUNCTION payment_plans_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv record;
BEGIN
  IF NEW.invoice_id IS NOT NULL THEN
    SELECT currency, patient_id INTO inv FROM invoices WHERE id = NEW.invoice_id;
    IF inv.currency <> NEW.currency OR inv.patient_id <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment plan currency/patient does not match the invoice' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION payments_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv record; pl record; v_appt_patient uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS NOT NULL AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM 1 FROM invoices WHERE id = OLD.invoice_id FOR UPDATE;
  END IF;
  IF NEW.invoice_id IS NOT NULL THEN
    SELECT currency, status, patient_id INTO inv FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
    IF inv.currency <> NEW.currency THEN
      RAISE EXCEPTION 'payment currency % differs from invoice currency %', NEW.currency, inv.currency USING ERRCODE = 'check_violation';
    END IF;
    IF inv.patient_id <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment patient does not match the invoice patient' USING ERRCODE = 'check_violation';
    END IF;
    IF inv.status IN ('draft','void') AND NEW.status IN ('succeeded','partially_refunded')
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.invoice_id IS DISTINCT FROM NEW.invoice_id) THEN
      RAISE EXCEPTION 'cannot pay a % invoice', inv.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.installment_id IS NOT NULL THEN
    SELECT p.currency, p.patient_id INTO pl FROM installments s JOIN payment_plans p ON p.id = s.plan_id
    WHERE s.id = NEW.installment_id FOR UPDATE OF s;
    IF pl.currency <> NEW.currency OR pl.patient_id <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment currency/patient does not match the installment plan' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.appointment_id IS NOT NULL THEN
    SELECT patient_id INTO v_appt_patient FROM appointments WHERE id = NEW.appointment_id;
    IF v_appt_patient IS NOT NULL AND v_appt_patient <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment patient does not match the appointment patient' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
GRANT UPDATE, DELETE ON refunds TO app_user;
DROP TRIGGER IF EXISTS payments_guard ON payments;
DROP FUNCTION IF EXISTS payments_guard();
