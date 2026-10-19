-- migrate:up
-- Phase E1: invoices, payments, reversals, refunds (SRS BILLING-001…005, PAY-001…003, PAY-005; database design E-01…E-04).
-- Decisions applied (accepted 2026-10-17): CLR-05 (owner and accountant refund; reception reverses its own entry the
-- same day; the refund method is recorded and may differ), CLR-09 (currency chosen per clinic, default EGP, locked once
-- the first invoice is issued), CLR-17 (A4 invoice, A5 receipt, printed from the browser). Additive; the dev database
-- has no invoices, payments or refunds, so nothing is rewritten.

-- ---------------------------------------------------------------------
-- 1. Payments: reference, reversal (E-01, E-02)
-- ---------------------------------------------------------------------
ALTER TABLE payments
  ADD COLUMN reference       text,
  ADD COLUMN reversed_at     timestamptz,
  ADD COLUMN reversed_by     uuid,
  ADD COLUMN reversal_reason text,
  ADD CONSTRAINT payments_reversed_by_member_fk FOREIGN KEY (tenant_id, reversed_by) REFERENCES tenant_members(tenant_id, id),
  ADD CONSTRAINT payments_reference_length CHECK (char_length(reference) BETWEEN 1 AND 100),
  ADD CONSTRAINT payments_notes_length CHECK (char_length(notes) <= 500);
ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending','succeeded','failed','refunded','partially_refunded','reversed')) NOT VALID;
ALTER TABLE payments VALIDATE CONSTRAINT payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_reversal_complete
  CHECK ((status = 'reversed') = (reversed_at IS NOT NULL AND reversal_reason IS NOT NULL AND char_length(btrim(reversal_reason)) >= 3)) NOT VALID;
ALTER TABLE payments VALIDATE CONSTRAINT payments_reversal_complete;
-- a transfer, wallet or InstaPay payment carries its reference (PAY-001)
ALTER TABLE payments ADD CONSTRAINT payments_reference_required
  CHECK (method NOT IN ('bank_transfer','wallet','instapay') OR reference IS NOT NULL) NOT VALID;
ALTER TABLE payments VALIDATE CONSTRAINT payments_reference_required;
CREATE INDEX payments_tenant_branch_paid ON payments (tenant_id, branch_id, paid_at);

-- recorded money never changes; the one move a person makes is "entered in error" -> reversed (PAY-003, CLR-05)
CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND patient_merge_only(TG_RELID, to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF; -- PATIENT-003 merge moves the patient only
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
      NEW.currency, NEW.method, NEW.paid_at, NEW.received_by, NEW.provider, NEW.provider_ref, NEW.idempotency_key, NEW.created_at, NEW.reference)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.branch_id, OLD.patient_id, OLD.invoice_id, OLD.appointment_id, OLD.installment_id, OLD.amount_minor,
      OLD.currency, OLD.method, OLD.paid_at, OLD.received_by, OLD.provider, OLD.provider_ref, OLD.idempotency_key, OLD.created_at, OLD.reference) THEN
    RAISE EXCEPTION 'payment % is recorded and cannot be changed; refund it instead', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('failed', 'reversed') AND (NEW.status, NEW.refunded_minor) IS DISTINCT FROM (OLD.status, OLD.refunded_minor) THEN
    RAISE EXCEPTION 'a % payment cannot change', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'reversed' AND OLD.status <> 'reversed' THEN
    IF OLD.status <> 'succeeded' OR OLD.refunded_minor > 0 THEN
      RAISE EXCEPTION 'only a payment with no refunds can be reversed' USING ERRCODE = 'check_violation', CONSTRAINT = 'payments_not_reversible';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.reversed_at, NEW.reversed_by, NEW.reversal_reason) IS DISTINCT FROM (OLD.reversed_at, OLD.reversed_by, OLD.reversal_reason) THEN
    RAISE EXCEPTION 'the reversal fields are set only when reversing' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('succeeded','partially_refunded','refunded') AND NEW.status NOT IN ('succeeded','partially_refunded','refunded') THEN
    RAISE EXCEPTION 'payment % cannot go from % to %', OLD.id, OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 2. Refunds: method, branch, time, reference (E-03)
-- ---------------------------------------------------------------------
ALTER TABLE refunds
  ADD COLUMN method      text,
  ADD COLUMN branch_id   uuid,
  ADD COLUMN reference   text,
  ADD COLUMN refunded_at timestamptz NOT NULL DEFAULT now();
UPDATE refunds r SET method = p.method, branch_id = p.branch_id FROM payments p WHERE p.id = r.payment_id AND r.method IS NULL;
ALTER TABLE refunds
  ALTER COLUMN method SET NOT NULL,
  ALTER COLUMN branch_id SET NOT NULL,
  ADD CONSTRAINT refunds_method_check CHECK (method IN ('cash','card','wallet','bank_transfer','instapay','online','insurance')),
  ADD CONSTRAINT refunds_branch_fk FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  ADD CONSTRAINT refunds_reason_length CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500), -- the API asks for 3+
  ADD CONSTRAINT refunds_reference_length CHECK (char_length(reference) BETWEEN 1 AND 100);
CREATE INDEX refunds_tenant_branch_at ON refunds (tenant_id, branch_id, refunded_at);

CREATE OR REPLACE FUNCTION refunds_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record; v_inv uuid; v_other bigint;
BEGIN
  SELECT invoice_id INTO v_inv FROM payments WHERE id = NEW.payment_id;
  IF v_inv IS NOT NULL THEN PERFORM 1 FROM invoices WHERE id = v_inv FOR UPDATE; END IF;
  SELECT status, amount_minor, branch_id, method INTO p FROM payments WHERE id = NEW.payment_id FOR UPDATE;
  IF p.status NOT IN ('succeeded','partially_refunded') THEN
    RAISE EXCEPTION 'only a succeeded payment can be refunded (status %)', p.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'refunds_payment_not_refundable';
  END IF;
  SELECT coalesce(sum(amount_minor), 0) INTO v_other FROM refunds WHERE payment_id = NEW.payment_id AND id <> NEW.id;
  IF v_other + NEW.amount_minor > p.amount_minor THEN
    RAISE EXCEPTION 'refunds (% + %) exceed the payment %', v_other, NEW.amount_minor, p.amount_minor
      USING ERRCODE = 'check_violation', CONSTRAINT = 'refunds_exceed_payment';
  END IF;
  NEW.branch_id := p.branch_id; -- the money goes back where it was taken (cash days are per branch, CASH-*)
  NEW.method := coalesce(NEW.method, p.method); -- the API always names it (CLR-05: it may differ); older callers did not
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 3. Issuing: gap-free number per clinic and year, tax from the settings, lock (E-04, BILLING-002)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION issue_invoice(p_invoice uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE inv invoices; s tenant_settings; v_tz text; v_year text; v_seq bigint; v_number text; v_taxable bigint;
BEGIN
  SELECT * INTO inv FROM invoices WHERE id = p_invoice FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'invoice not found' USING ERRCODE = 'no_data_found'; END IF;
  IF inv.status <> 'draft' THEN
    RAISE EXCEPTION 'invoice % is already %', p_invoice, inv.status USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_locked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM invoice_items WHERE invoice_id = p_invoice) THEN
    RAISE EXCEPTION 'an invoice needs at least one line' USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_empty';
  END IF;
  SELECT * INTO s FROM tenant_settings WHERE tenant_id = inv.tenant_id;
  SELECT timezone INTO v_tz FROM tenants WHERE id = inv.tenant_id;
  v_year := to_char(now() AT TIME ZONE coalesce(v_tz, 'Africa/Cairo'), 'YYYY');
  -- the counter row is locked until this transaction ends: concurrent issues queue, and a rollback gives the number back
  v_seq := next_tenant_counter('invoice:' || v_year);
  v_number := coalesce(s.invoice_prefix, 'INV') || '-' || v_year || '-' || lpad(v_seq::text, 5, '0');
  v_taxable := inv.subtotal_minor - inv.discount_minor;
  UPDATE invoices SET
    status = 'issued', number = v_number, issue_date = (now() AT TIME ZONE coalesce(v_tz, 'Africa/Cairo'))::date,
    -- tax rounded half up to the piastre
    tax_minor = (v_taxable * coalesce(s.tax_rate_bp, 0) + 5000) / 10000
  WHERE id = p_invoice;
  RETURN v_number;
END $$;

-- number and issue date are part of the lock; an invoice is in the clinic's currency
CREATE OR REPLACE FUNCTION invoices_lock_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.currency <> (SELECT currency FROM tenants WHERE id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'an invoice is in the clinic currency' USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_clinic_currency';
    END IF;
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'an invoice starts as a draft' USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_locked';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'draft' AND (NEW.number, NEW.issue_date) IS DISTINCT FROM (OLD.number, OLD.issue_date) THEN
    RAISE EXCEPTION 'the number and date of an issued invoice do not change' USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_locked';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_lock_number BEFORE INSERT OR UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_lock_number();
ALTER TABLE invoices
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN voided_by uuid,
  ADD CONSTRAINT invoices_voided_by_member_fk FOREIGN KEY (tenant_id, voided_by) REFERENCES tenant_members(tenant_id, id),
  ADD CONSTRAINT invoices_notes_length CHECK (char_length(notes) <= 1000),
  ADD CONSTRAINT invoices_void_reason_length CHECK (void_reason IS NULL OR char_length(btrim(void_reason)) BETWEEN 3 AND 500);
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_description_length CHECK (char_length(btrim(description)) BETWEEN 1 AND 300);
CREATE INDEX invoices_tenant_branch_issue ON invoices (tenant_id, branch_id, issue_date) WHERE status <> 'draft';

-- ---------------------------------------------------------------------
-- 4. Currency (CLR-09): chosen by the clinic, locked once an invoice has been issued
-- ---------------------------------------------------------------------
ALTER TABLE tenants ADD CONSTRAINT tenants_currency_code CHECK (currency ~ '^[A-Z]{3}$') NOT VALID;
ALTER TABLE tenants VALIDATE CONSTRAINT tenants_currency_code;
CREATE OR REPLACE FUNCTION tenants_currency_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency AND EXISTS (SELECT 1 FROM invoices WHERE tenant_id = OLD.id AND status <> 'draft') THEN
    RAISE EXCEPTION 'the currency is fixed once an invoice is issued' USING ERRCODE = 'check_violation', CONSTRAINT = 'tenants_currency_locked';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenants_currency_lock BEFORE UPDATE OF currency ON tenants FOR EACH ROW EXECUTE FUNCTION tenants_currency_lock();
GRANT UPDATE (currency) ON tenants TO app_user;

-- migrate:down
REVOKE UPDATE (currency) ON tenants FROM app_user;
DROP TRIGGER IF EXISTS tenants_currency_lock ON tenants;
DROP FUNCTION IF EXISTS tenants_currency_lock();
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_currency_code;
DROP INDEX IF EXISTS invoices_tenant_branch_issue;
ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS invoice_items_description_length;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_void_reason_length, DROP CONSTRAINT IF EXISTS invoices_notes_length,
  DROP CONSTRAINT IF EXISTS invoices_voided_by_member_fk, DROP COLUMN IF EXISTS voided_by, DROP COLUMN IF EXISTS voided_at;
DROP TRIGGER IF EXISTS invoices_lock_number ON invoices;
DROP FUNCTION IF EXISTS invoices_lock_number();
DROP FUNCTION IF EXISTS issue_invoice(uuid);
CREATE OR REPLACE FUNCTION refunds_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record; v_inv uuid; v_other bigint;
BEGIN
  SELECT invoice_id INTO v_inv FROM payments WHERE id = NEW.payment_id;
  IF v_inv IS NOT NULL THEN PERFORM 1 FROM invoices WHERE id = v_inv FOR UPDATE; END IF;
  SELECT status, amount_minor INTO p FROM payments WHERE id = NEW.payment_id FOR UPDATE;
  IF p.status NOT IN ('succeeded','partially_refunded') THEN
    RAISE EXCEPTION 'only a succeeded payment can be refunded (status %)', p.status USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(amount_minor), 0) INTO v_other FROM refunds WHERE payment_id = NEW.payment_id AND id <> NEW.id;
  IF v_other + NEW.amount_minor > p.amount_minor THEN
    RAISE EXCEPTION 'refunds (% + %) exceed the payment %', v_other, NEW.amount_minor, p.amount_minor
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP INDEX IF EXISTS refunds_tenant_branch_at;
ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_reference_length, DROP CONSTRAINT IF EXISTS refunds_reason_length,
  DROP CONSTRAINT IF EXISTS refunds_branch_fk, DROP CONSTRAINT IF EXISTS refunds_method_check,
  DROP COLUMN IF EXISTS refunded_at, DROP COLUMN IF EXISTS reference, DROP COLUMN IF EXISTS branch_id, DROP COLUMN IF EXISTS method;
CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND patient_merge_only(TG_RELID, to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF; -- PATIENT-003 merge moves the patient only
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
DROP INDEX IF EXISTS payments_tenant_branch_paid;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_reference_required, DROP CONSTRAINT IF EXISTS payments_reversal_complete,
  DROP CONSTRAINT IF EXISTS payments_notes_length, DROP CONSTRAINT IF EXISTS payments_reference_length,
  DROP CONSTRAINT IF EXISTS payments_reversed_by_member_fk, DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('pending','succeeded','failed','refunded','partially_refunded'));
ALTER TABLE payments DROP COLUMN IF EXISTS reversal_reason, DROP COLUMN IF EXISTS reversed_by, DROP COLUMN IF EXISTS reversed_at, DROP COLUMN IF EXISTS reference;
