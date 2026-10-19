-- migrate:up
-- Phase E2: discounts with limits and approval, installment plans, waivers and write-offs
-- (SRS DISC-001…003, PAY-004, PAY-006; database design E-05…E-07). Decisions (accepted 2026-10-17):
-- CLR-02 — the owner sets each role's limit, starting at 10 % for receptionists and 20 % for accountants; a larger
--          discount waits for the owner's approval in the app; the accountant does not approve.
-- CLR-12 — waiver (an installment) and write-off (an invoice remainder) rows with a reason, owner only; no credit notes.
-- Additive. Invoices are few (dev demo data); redefining the generated balance rewrites the table once.

-- ---------------------------------------------------------------------
-- 1. Discount limits per role (E-06)
-- ---------------------------------------------------------------------
ALTER TABLE roles
  ADD COLUMN max_discount_bp    int NOT NULL DEFAULT 0 CONSTRAINT roles_max_discount_bp CHECK (max_discount_bp BETWEEN 0 AND 10000),
  ADD COLUMN max_discount_minor bigint CONSTRAINT roles_max_discount_minor CHECK (max_discount_minor IS NULL OR max_discount_minor >= 0);
-- CLR-02 starting limits for the seeded roles of every clinic, now and at sign-up
CREATE OR REPLACE FUNCTION default_role_discount_bp(p_role text) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role WHEN 'receptionist' THEN 1000 WHEN 'accountant' THEN 2000 ELSE 0 END
$$;
UPDATE roles SET max_discount_bp = default_role_discount_bp(key) WHERE is_system AND max_discount_bp = 0 AND default_role_discount_bp(key) > 0;
CREATE OR REPLACE FUNCTION roles_default_discount() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_system AND NEW.max_discount_bp = 0 THEN NEW.max_discount_bp := default_role_discount_bp(NEW.key); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER roles_default_discount BEFORE INSERT ON roles FOR EACH ROW EXECUTE FUNCTION roles_default_discount();

-- ---------------------------------------------------------------------
-- 2. Discounts on lines and invoices: amount or percent, reason, approval (E-05)
-- ---------------------------------------------------------------------
ALTER TABLE invoice_items
  ADD COLUMN discount_type   text CONSTRAINT invoice_items_discount_type CHECK (discount_type IN ('amount', 'percent')),
  ADD COLUMN discount_bp     int CONSTRAINT invoice_items_discount_bp CHECK (discount_bp BETWEEN 0 AND 10000),
  ADD COLUMN discount_reason text,
  ADD CONSTRAINT invoice_items_discount_reason CHECK (discount_minor = 0 OR coalesce(char_length(btrim(discount_reason)), 0) BETWEEN 3 AND 300) NOT VALID,
  ADD CONSTRAINT invoice_items_discount_percent CHECK ((discount_type = 'percent') = (discount_bp IS NOT NULL));
ALTER TABLE invoice_items VALIDATE CONSTRAINT invoice_items_discount_reason;

ALTER TABLE invoices
  ADD COLUMN discount_type         text CONSTRAINT invoices_discount_type CHECK (discount_type IN ('amount', 'percent')),
  ADD COLUMN discount_bp           int CONSTRAINT invoices_discount_bp CHECK (discount_bp BETWEEN 0 AND 10000),
  ADD COLUMN discount_reason       text,
  -- the approval covers every discount on the invoice (lines and whole), as it stands
  ADD COLUMN discount_status       text NOT NULL DEFAULT 'none'
    CONSTRAINT invoices_discount_status CHECK (discount_status IN ('none', 'within_limit', 'pending', 'approved', 'rejected')),
  ADD COLUMN discount_requested_by uuid,
  ADD COLUMN discount_decided_by   uuid,
  ADD COLUMN discount_decided_at   timestamptz,
  ADD COLUMN discount_note         text,
  ADD COLUMN adjusted_minor        bigint NOT NULL DEFAULT 0 CONSTRAINT invoices_adjusted_minor CHECK (adjusted_minor >= 0),
  ADD CONSTRAINT invoices_discount_requested_fk FOREIGN KEY (tenant_id, discount_requested_by) REFERENCES tenant_members(tenant_id, id),
  ADD CONSTRAINT invoices_discount_decided_fk FOREIGN KEY (tenant_id, discount_decided_by) REFERENCES tenant_members(tenant_id, id),
  -- DISC-003: nobody approves their own request
  ADD CONSTRAINT invoices_discount_self_approval CHECK (discount_decided_by IS NULL OR discount_decided_by IS DISTINCT FROM discount_requested_by),
  ADD CONSTRAINT invoices_discount_percent CHECK ((discount_type = 'percent') = (discount_bp IS NOT NULL)),
  ADD CONSTRAINT invoices_discount_reason CHECK (discount_minor = 0 OR coalesce(char_length(btrim(discount_reason)), 0) BETWEEN 3 AND 300) NOT VALID,
  ADD CONSTRAINT invoices_discount_le_subtotal CHECK (status = 'draft' OR discount_minor <= subtotal_minor) NOT VALID; -- a draft is built step by step
ALTER TABLE invoices VALIDATE CONSTRAINT invoices_discount_reason;
ALTER TABLE invoices VALIDATE CONSTRAINT invoices_discount_le_subtotal;
CREATE INDEX invoices_discount_pending ON invoices (tenant_id, updated_at) WHERE discount_status = 'pending';

-- balance = total − paid − waived/written off (PAY-006); the generated column is redefined, so it is recomputed
ALTER TABLE invoices DROP COLUMN balance_minor;
ALTER TABLE invoices ADD COLUMN balance_minor bigint GENERATED ALWAYS AS (total_minor - paid_minor - adjusted_minor) STORED;
ALTER TABLE invoices DROP CONSTRAINT invoices_check2;
ALTER TABLE invoices ADD CONSTRAINT invoices_check2 CHECK (status = 'draft' OR paid_minor + adjusted_minor <= total_minor) NOT VALID;
ALTER TABLE invoices VALIDATE CONSTRAINT invoices_check2;

-- a line's percent becomes an amount (half up), and its total follows
CREATE OR REPLACE FUNCTION invoice_items_derive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.discount_type = 'percent' THEN
    NEW.discount_minor := (NEW.quantity * NEW.unit_price_minor * NEW.discount_bp + 5000) / 10000;
  END IF;
  IF NEW.discount_minor = 0 THEN NEW.discount_type := NULL; NEW.discount_bp := NULL; NEW.discount_reason := NULL; END IF;
  NEW.line_total_minor := NEW.quantity * NEW.unit_price_minor - NEW.discount_minor;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_items_derive BEFORE INSERT OR UPDATE ON invoice_items FOR EACH ROW EXECUTE FUNCTION invoice_items_derive();

CREATE OR REPLACE FUNCTION invoices_derive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND patient_merge_only(TG_RELID, to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF; -- PATIENT-003 merge moves the patient only
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
      RAISE EXCEPTION 'invoice % cannot go back to draft', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'void' AND NEW.status <> 'void' THEN
      RAISE EXCEPTION 'a void invoice cannot be reopened' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'draft' AND (NEW.discount_minor <> OLD.discount_minor OR NEW.tax_minor <> OLD.tax_minor
        OR NEW.currency <> OLD.currency OR NEW.patient_id <> OLD.patient_id
        OR (NEW.discount_type, NEW.discount_bp, NEW.discount_reason, NEW.discount_status) IS DISTINCT FROM
           (OLD.discount_type, OLD.discount_bp, OLD.discount_reason, OLD.discount_status)) THEN
      RAISE EXCEPTION 'issued invoice % is locked (discount, tax, currency, patient)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.subtotal_minor := (SELECT coalesce(sum(line_total_minor), 0) FROM invoice_items WHERE invoice_id = NEW.id);
  IF NEW.status = 'draft' AND NEW.discount_type = 'percent' THEN
    NEW.discount_minor := (NEW.subtotal_minor * NEW.discount_bp + 5000) / 10000;  -- half up, follows the lines
  END IF;
  IF NEW.status = 'draft' AND NEW.discount_minor = 0 THEN NEW.discount_type := NULL; NEW.discount_bp := NULL; NEW.discount_reason := NULL; END IF;
  NEW.paid_minor     := (SELECT coalesce(sum(amount_minor - refunded_minor), 0) FROM payments
                         WHERE invoice_id = NEW.id AND status IN ('succeeded','partially_refunded','refunded'));
  NEW.adjusted_minor := (SELECT coalesce(sum(amount_minor), 0) FROM balance_adjustments WHERE invoice_id = NEW.id);
  NEW.total_minor    := NEW.subtotal_minor - NEW.discount_minor + NEW.tax_minor;
  IF NEW.status = 'void' AND (NEW.paid_minor > 0 OR NEW.adjusted_minor > 0) THEN
    RAISE EXCEPTION 'refund the % already paid before voiding invoice %', NEW.paid_minor, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status NOT IN ('draft','void') THEN
    NEW.status := CASE WHEN NEW.paid_minor + NEW.adjusted_minor >= NEW.total_minor THEN 'paid'   -- includes 100% discount and write-offs
                       WHEN NEW.paid_minor = 0 AND NEW.adjusted_minor = 0 THEN 'issued'
                       ELSE 'partially_paid' END;
  END IF;
  RETURN NEW;
END $$;

-- issuing refuses a discount still waiting for (or refused) approval (BILLING-002, DISC-003)
CREATE OR REPLACE FUNCTION invoices_discount_settled() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status <> 'draft' AND NEW.status <> 'void' AND NEW.discount_status IN ('pending', 'rejected') THEN
    RAISE EXCEPTION 'the discount on invoice % is %', NEW.id, NEW.discount_status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_discount_pending';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_discount_settled BEFORE UPDATE OF status ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_discount_settled();

-- ---------------------------------------------------------------------
-- 3. Installment plans on invoices (PAY-004)
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX payment_plans_one_active_per_invoice ON payment_plans (invoice_id) WHERE invoice_id IS NOT NULL AND status = 'active';
ALTER TABLE installments
  ADD COLUMN waived_at     timestamptz,
  ADD COLUMN waived_by     uuid,
  ADD COLUMN waived_reason text,
  ADD CONSTRAINT installments_waived_by_fk FOREIGN KEY (tenant_id, waived_by) REFERENCES tenant_members(tenant_id, id),
  ADD CONSTRAINT installments_waiver_complete CHECK ((status = 'waived') = (waived_at IS NOT NULL AND waived_reason IS NOT NULL));
CREATE INDEX installments_open_due ON installments (tenant_id, due_date) WHERE status IN ('due', 'partially_paid');

-- the plan follows its installments: completed when none is left to pay
CREATE OR REPLACE FUNCTION installments_plan_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE payment_plans pp SET status =
    CASE WHEN EXISTS (SELECT 1 FROM installments WHERE plan_id = pp.id AND status IN ('due','partially_paid')) THEN 'active' ELSE 'completed' END
  WHERE pp.id = NEW.plan_id AND pp.status IN ('active','completed');
  RETURN NULL;
END $$;
CREATE TRIGGER installments_plan_status AFTER UPDATE OF status ON installments FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION installments_plan_status();

-- ---------------------------------------------------------------------
-- 4. Waivers and write-offs (PAY-006, CLR-12, E-07): rows, never edits of money
-- ---------------------------------------------------------------------
CREATE TABLE balance_adjustments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id     uuid NOT NULL,
  installment_id uuid,
  kind           text NOT NULL CONSTRAINT balance_adjustments_kind CHECK (kind IN ('waiver', 'write_off')),
  amount_minor   bigint NOT NULL CONSTRAINT balance_adjustments_amount CHECK (amount_minor > 0),
  reason         text NOT NULL CONSTRAINT balance_adjustments_reason CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id),
  FOREIGN KEY (tenant_id, installment_id) REFERENCES installments(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES tenant_members(tenant_id, id),
  CONSTRAINT balance_adjustments_waiver_installment CHECK ((kind = 'waiver') = (installment_id IS NOT NULL))
);
CREATE INDEX balance_adjustments_invoice ON balance_adjustments (tenant_id, invoice_id);
ALTER TABLE balance_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_adjustments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON balance_adjustments USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY branch_access ON balance_adjustments AS RESTRICTIVE
  USING ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id))
  WITH CHECK ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id));
REVOKE UPDATE, DELETE ON balance_adjustments FROM app_user;

CREATE OR REPLACE FUNCTION balance_adjustments_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv record; ins record;
BEGIN
  SELECT status, total_minor, paid_minor, adjusted_minor INTO inv FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF inv.status NOT IN ('issued', 'partially_paid') THEN
    RAISE EXCEPTION 'only an open invoice is adjusted (this one is %)', inv.status USING ERRCODE = 'check_violation', CONSTRAINT = 'balance_adjustments_invoice_open';
  END IF;
  IF NEW.amount_minor > inv.total_minor - inv.paid_minor - inv.adjusted_minor THEN
    RAISE EXCEPTION 'the adjustment is more than what is owed' USING ERRCODE = 'check_violation', CONSTRAINT = 'balance_adjustments_exceeds_balance';
  END IF;
  IF NEW.installment_id IS NOT NULL THEN
    SELECT s.status, s.amount_minor, s.paid_minor, p.invoice_id INTO ins
      FROM installments s JOIN payment_plans p ON p.id = s.plan_id WHERE s.id = NEW.installment_id FOR UPDATE OF s;
    IF ins.invoice_id IS DISTINCT FROM NEW.invoice_id OR ins.status NOT IN ('due', 'partially_paid') THEN
      RAISE EXCEPTION 'only an unpaid installment of this invoice is waived' USING ERRCODE = 'check_violation', CONSTRAINT = 'balance_adjustments_installment';
    END IF;
    NEW.amount_minor := ins.amount_minor - ins.paid_minor; -- a waiver is what is left of the installment
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER balance_adjustments_validate BEFORE INSERT ON balance_adjustments FOR EACH ROW EXECUTE FUNCTION balance_adjustments_validate();

CREATE OR REPLACE FUNCTION balance_adjustments_apply() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.installment_id IS NOT NULL THEN
    UPDATE installments SET status = 'waived', waived_at = now(), waived_by = NEW.created_by, waived_reason = NEW.reason WHERE id = NEW.installment_id;
  END IF;
  PERFORM recalc_invoice(NEW.invoice_id);
  RETURN NULL;
END $$;
CREATE TRIGGER balance_adjustments_apply AFTER INSERT ON balance_adjustments FOR EACH ROW EXECUTE FUNCTION balance_adjustments_apply();
CREATE TRIGGER audit_balance_adjustments AFTER INSERT ON balance_adjustments FOR EACH ROW EXECUTE FUNCTION audit_row_change('balance_adjustment');

-- the merge (PATIENT-003) has nothing to move here: adjustments follow their invoice

-- migrate:down
DROP TRIGGER IF EXISTS audit_balance_adjustments ON balance_adjustments;
DROP TABLE IF EXISTS balance_adjustments;
DROP FUNCTION IF EXISTS balance_adjustments_apply();
DROP FUNCTION IF EXISTS balance_adjustments_validate();
DROP TRIGGER IF EXISTS installments_plan_status ON installments;
DROP FUNCTION IF EXISTS installments_plan_status();
DROP INDEX IF EXISTS installments_open_due;
ALTER TABLE installments DROP CONSTRAINT IF EXISTS installments_waiver_complete, DROP CONSTRAINT IF EXISTS installments_waived_by_fk,
  DROP COLUMN IF EXISTS waived_reason, DROP COLUMN IF EXISTS waived_by, DROP COLUMN IF EXISTS waived_at;
DROP INDEX IF EXISTS payment_plans_one_active_per_invoice;
DROP TRIGGER IF EXISTS invoices_discount_settled ON invoices;
DROP FUNCTION IF EXISTS invoices_discount_settled();
CREATE OR REPLACE FUNCTION invoices_derive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND patient_merge_only(TG_RELID, to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF; -- PATIENT-003 merge moves the patient only
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
      RAISE EXCEPTION 'invoice % cannot go back to draft', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'void' AND NEW.status <> 'void' THEN
      RAISE EXCEPTION 'a void invoice cannot be reopened' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'draft' AND (NEW.discount_minor <> OLD.discount_minor OR NEW.tax_minor <> OLD.tax_minor
        OR NEW.currency <> OLD.currency OR NEW.patient_id <> OLD.patient_id) THEN
      RAISE EXCEPTION 'issued invoice % is locked (discount, tax, currency, patient)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.subtotal_minor := (SELECT coalesce(sum(line_total_minor), 0) FROM invoice_items WHERE invoice_id = NEW.id);
  NEW.paid_minor     := (SELECT coalesce(sum(amount_minor - refunded_minor), 0) FROM payments
                         WHERE invoice_id = NEW.id AND status IN ('succeeded','partially_refunded','refunded'));
  NEW.total_minor    := NEW.subtotal_minor - NEW.discount_minor + NEW.tax_minor;
  IF NEW.status = 'void' AND NEW.paid_minor > 0 THEN
    RAISE EXCEPTION 'refund the % already paid before voiding invoice %', NEW.paid_minor, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status NOT IN ('draft','void') THEN
    NEW.status := CASE WHEN NEW.paid_minor >= NEW.total_minor THEN 'paid'      -- includes 100% discount
                       WHEN NEW.paid_minor = 0 THEN 'issued'
                       ELSE 'partially_paid' END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoice_items_derive ON invoice_items;
DROP FUNCTION IF EXISTS invoice_items_derive();
ALTER TABLE invoices DROP CONSTRAINT invoices_check2;
ALTER TABLE invoices ADD CONSTRAINT invoices_check2 CHECK (status = 'draft' OR paid_minor <= total_minor);
ALTER TABLE invoices DROP COLUMN balance_minor;
ALTER TABLE invoices ADD COLUMN balance_minor bigint GENERATED ALWAYS AS (total_minor - paid_minor) STORED;
DROP INDEX IF EXISTS invoices_discount_pending;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_discount_le_subtotal, DROP CONSTRAINT IF EXISTS invoices_discount_reason,
  DROP CONSTRAINT IF EXISTS invoices_discount_percent, DROP CONSTRAINT IF EXISTS invoices_discount_self_approval,
  DROP CONSTRAINT IF EXISTS invoices_discount_decided_fk, DROP CONSTRAINT IF EXISTS invoices_discount_requested_fk,
  DROP COLUMN IF EXISTS adjusted_minor, DROP COLUMN IF EXISTS discount_note, DROP COLUMN IF EXISTS discount_decided_at,
  DROP COLUMN IF EXISTS discount_decided_by, DROP COLUMN IF EXISTS discount_requested_by, DROP COLUMN IF EXISTS discount_status,
  DROP COLUMN IF EXISTS discount_reason, DROP COLUMN IF EXISTS discount_bp, DROP COLUMN IF EXISTS discount_type;
ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS invoice_items_discount_percent, DROP CONSTRAINT IF EXISTS invoice_items_discount_reason,
  DROP COLUMN IF EXISTS discount_reason, DROP COLUMN IF EXISTS discount_bp, DROP COLUMN IF EXISTS discount_type;
DROP TRIGGER IF EXISTS roles_default_discount ON roles;
DROP FUNCTION IF EXISTS roles_default_discount();
DROP FUNCTION IF EXISTS default_role_discount_bp(text);
ALTER TABLE roles DROP COLUMN IF EXISTS max_discount_minor, DROP COLUMN IF EXISTS max_discount_bp;
