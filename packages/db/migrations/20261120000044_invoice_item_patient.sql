-- migrate:up
-- Review R11: an invoice line could bill a visit procedure of a different patient (the API checked only that the
-- procedure was unbilled), so one patient's work could be charged to another. The line trigger now also requires the
-- procedure's visit to belong to the invoice's patient; a procedure the member cannot see (another branch) is refused.
-- The "already billed" check moves to a definer helper: under the branch policies a branch-limited member could not see
-- another branch's invoice line, and so could bill the same procedure twice.
CREATE OR REPLACE FUNCTION visit_procedure_billed_elsewhere(p_procedure uuid, p_item uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON i.id = ii.invoice_id
     WHERE ii.tenant_id = public.current_tenant_id() AND i.tenant_id = public.current_tenant_id()
       AND ii.visit_procedure_id = p_procedure AND ii.id IS DISTINCT FROM p_item AND i.status <> 'void')
$$;
GRANT SELECT ON invoice_items, invoices TO app_definer; -- already held since patient merge (0022); stated for this helper
ALTER FUNCTION visit_procedure_billed_elsewhere(uuid, uuid) OWNER TO app_definer;
REVOKE ALL ON FUNCTION visit_procedure_billed_elsewhere(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION visit_procedure_billed_elsewhere(uuid, uuid) TO app_user;

CREATE OR REPLACE FUNCTION invoice_items_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_inv uuid; v_status text; v_inv_patient uuid; v_visit_patient uuid;
BEGIN
  FOR v_inv IN SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.invoice_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.invoice_id END]) AS x WHERE x IS NOT NULL
  LOOP
    SELECT status INTO v_status FROM invoices WHERE id = v_inv FOR UPDATE;
    IF FOUND AND v_status <> 'draft' THEN
      RAISE EXCEPTION 'invoice % is %, lines can only change on a draft', v_inv, v_status USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF TG_OP <> 'DELETE' AND NEW.visit_procedure_id IS NOT NULL THEN
    SELECT v.patient_id INTO v_visit_patient
      FROM visit_procedures vp JOIN visits v ON v.id = vp.visit_id
     WHERE vp.id = NEW.visit_procedure_id
       FOR UPDATE OF vp;
    SELECT patient_id INTO v_inv_patient FROM invoices WHERE id = NEW.invoice_id;
    IF v_visit_patient IS NULL OR v_visit_patient IS DISTINCT FROM v_inv_patient THEN
      RAISE EXCEPTION 'procedure % belongs to another patient (or is not visible), not to the invoice''s patient', NEW.visit_procedure_id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'invoice_item_patient';
    END IF;
    IF visit_procedure_billed_elsewhere(NEW.visit_procedure_id, NEW.id) THEN
      RAISE EXCEPTION 'procedure % is already billed', NEW.visit_procedure_id USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- migrate:down
CREATE OR REPLACE FUNCTION invoice_items_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_inv uuid; v_status text;
BEGIN
  FOR v_inv IN SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.invoice_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.invoice_id END]) AS x WHERE x IS NOT NULL
  LOOP
    SELECT status INTO v_status FROM invoices WHERE id = v_inv FOR UPDATE;
    IF FOUND AND v_status <> 'draft' THEN
      RAISE EXCEPTION 'invoice % is %, lines can only change on a draft', v_inv, v_status USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF TG_OP <> 'DELETE' AND NEW.visit_procedure_id IS NOT NULL THEN
    PERFORM 1 FROM visit_procedures WHERE id = NEW.visit_procedure_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
               WHERE ii.visit_procedure_id = NEW.visit_procedure_id AND ii.id <> NEW.id AND i.status <> 'void') THEN
      RAISE EXCEPTION 'procedure % is already billed', NEW.visit_procedure_id USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP FUNCTION IF EXISTS visit_procedure_billed_elsewhere(uuid, uuid);
