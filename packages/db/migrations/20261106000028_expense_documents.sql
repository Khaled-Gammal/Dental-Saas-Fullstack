-- migrate:up
-- Phase H2 (EXP-001): an expense's supporting document. `expenses.file_id` exists since 0001 and 0025 locked it with
-- the rest of a recorded expense. A receipt often arrives after the expense is recorded, so the document may be
-- attached later, once: NULL -> a private file of the clinic, while the expense is not void. It is never replaced or
-- removed (a wrong one is corrected like any other mistake: void the expense and record it again).
CREATE OR REPLACE FUNCTION expenses_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.file_id IS NOT NULL AND NEW.file_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.file_id END)
     AND NOT EXISTS (SELECT 1 FROM files WHERE id = NEW.file_id AND tenant_id = NEW.tenant_id AND is_private) THEN
    RAISE EXCEPTION 'an expense document is a private file of the clinic' USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_document_private';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.spent_on > business_date(now(), NEW.tenant_id) THEN
      RAISE EXCEPTION 'an expense is not dated in the future' USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_future';
    END IF;
    IF NEW.currency <> (SELECT currency FROM tenants WHERE id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'an expense is in the clinic currency' USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_clinic_currency';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.branch_id, NEW.category_id, NEW.amount_minor, NEW.currency, NEW.spent_on, NEW.payment_method, NEW.reference, NEW.supplier_name,
      NEW.description, NEW.created_by, NEW.created_at) IS DISTINCT FROM
     (OLD.branch_id, OLD.category_id, OLD.amount_minor, OLD.currency, OLD.spent_on, OLD.payment_method, OLD.reference, OLD.supplier_name,
      OLD.description, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a recorded expense is not edited; void it and record it again' USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_locked';
  END IF;
  IF NEW.file_id IS DISTINCT FROM OLD.file_id AND (OLD.file_id IS NOT NULL OR OLD.status = 'void') THEN
    RAISE EXCEPTION 'the document of an expense is attached once, while it is not void' USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_document_fixed';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'void'))
    OR (OLD.status IN ('approved', 'rejected') AND NEW.status = 'void')) THEN
    RAISE EXCEPTION 'an expense cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_locked';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE UNIQUE INDEX expenses_file ON expenses (file_id) WHERE file_id IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS expenses_file;
-- the 0025 guard: file_id fixed with the rest of a recorded expense (documents already attached stay)
CREATE OR REPLACE FUNCTION expenses_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.spent_on > business_date(now(), NEW.tenant_id) THEN
      RAISE EXCEPTION 'an expense is not dated in the future' USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_future';
    END IF;
    IF NEW.currency <> (SELECT currency FROM tenants WHERE id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'an expense is in the clinic currency' USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_clinic_currency';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.branch_id, NEW.category_id, NEW.amount_minor, NEW.currency, NEW.spent_on, NEW.payment_method, NEW.reference, NEW.supplier_name,
      NEW.description, NEW.created_by, NEW.created_at, NEW.file_id) IS DISTINCT FROM
     (OLD.branch_id, OLD.category_id, OLD.amount_minor, OLD.currency, OLD.spent_on, OLD.payment_method, OLD.reference, OLD.supplier_name,
      OLD.description, OLD.created_by, OLD.created_at, OLD.file_id) THEN
    RAISE EXCEPTION 'a recorded expense is not edited; void it and record it again' USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_locked';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'void'))
    OR (OLD.status IN ('approved', 'rejected') AND NEW.status = 'void')) THEN
    RAISE EXCEPTION 'an expense cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_locked';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
