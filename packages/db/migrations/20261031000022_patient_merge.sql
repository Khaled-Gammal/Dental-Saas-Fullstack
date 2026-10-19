-- migrate:up
-- Phase D5: merge duplicate patients (SRS PATIENT-003, CLR-15 default). Additive: two functions, a narrow exception in
-- four guards, and grants to app_definer (the existing BYPASSRLS role that owns the lookup functions).
--
-- merge_patients(survivor, merged) moves every row of the merged record to the survivor in one transaction:
-- appointments, invoices, installment plans, payments, visits, plans, prescriptions, chart entries, follow-ups, files,
-- consents, lab orders, reviews, waiting list, notifications and medical-history versions. Allergies, conditions and
-- medications are combined (an allergy is never lost); the survivor's other fields are kept. The merged record keeps
-- its own data, gets merged_into_id and leaves every list. It runs as app_definer, so it checks the clinic itself on
-- every statement (RLS does not apply to it), and it is the only way a recorded payment, an issued invoice, a final
-- visit or an accepted plan changes patient: the guards allow a change of patient_id alone, only for app_definer
-- inside this function (app.patient_merge), never for the API role.

-- true when the only change is the patient, made by the merge (generated columns are still empty in a BEFORE trigger)
CREATE OR REPLACE FUNCTION patient_merge_only(p_rel oid, o jsonb, n jsonb) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_user = 'app_definer' AND coalesce(current_setting('app.patient_merge', true), '') = 'on'
     AND (o - 'patient_id' - 'updated_at' - g) = (n - 'patient_id' - 'updated_at' - g)
  FROM (SELECT coalesce(array_agg(attname::text), '{}') AS g FROM pg_attribute WHERE attrelid = p_rel AND attgenerated = 's') x
$$;

-- two lists as one, first spelling kept, no repeats ignoring case and spaces
CREATE OR REPLACE FUNCTION text_array_union(a text[], b text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(x ORDER BY o), '{}') FROM (
    SELECT DISTINCT ON (lower(btrim(x))) x, o FROM unnest(coalesce(a, '{}') || coalesce(b, '{}')) WITH ORDINALITY u(x, o)
    ORDER BY lower(btrim(x)), o) d
$$;

CREATE OR REPLACE FUNCTION public.payments_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
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

CREATE OR REPLACE FUNCTION public.invoices_derive()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
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

CREATE OR REPLACE FUNCTION public.visits_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' THEN RETURN coalesce(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE' AND patient_merge_only(TG_RELID, to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF; -- PATIENT-003 merge moves the patient only
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinical visits are never deleted' USING ERRCODE = 'check_violation', CONSTRAINT = 'visits_never_deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'draft'; NEW.finalized_at := NULL; NEW.finalized_by := NULL;
    RETURN NEW;
  END IF;
  IF OLD.status = 'final' AND (
       NEW.status <> 'final'
    OR (NEW.chief_complaint, NEW.diagnosis, NEW.clinical_notes, NEW.next_visit_note, NEW.finalized_at, NEW.finalized_by,
        NEW.patient_id, NEW.doctor_id, NEW.branch_id, NEW.appointment_id, NEW.visit_at)
       IS DISTINCT FROM
       (OLD.chief_complaint, OLD.diagnosis, OLD.clinical_notes, OLD.next_visit_note, OLD.finalized_at, OLD.finalized_by,
        OLD.patient_id, OLD.doctor_id, OLD.branch_id, OLD.appointment_id, OLD.visit_at)) THEN
    RAISE EXCEPTION 'visit % is final; add an amendment instead', OLD.id USING ERRCODE = 'check_violation', CONSTRAINT = 'visits_finalized';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'final' THEN
    NEW.finalized_at := now();
    NEW.finalized_by := coalesce(NEW.finalized_by, current_member_id());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.treatment_plans_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND patient_merge_only(TG_RELID, to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF; -- PATIENT-003 merge moves the patient only
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'a plan starts as a draft' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plans_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('proposed', 'cancelled'))
    OR (OLD.status = 'proposed' AND NEW.status IN ('accepted', 'cancelled'))
    OR (OLD.status IN ('accepted', 'in_progress') AND NEW.status = 'cancelled')
    OR (OLD.status IN ('accepted', 'in_progress', 'completed') AND NEW.status IN ('accepted', 'in_progress', 'completed'))) THEN
    RAISE EXCEPTION 'a % plan cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plans_transition';
  END IF;
  IF OLD.status IN ('completed', 'cancelled') AND OLD.status = NEW.status
     AND (NEW.title, NEW.notes, NEW.doctor_id, NEW.accepted_at, NEW.accepted_by) IS DISTINCT FROM (OLD.title, OLD.notes, OLD.doctor_id, OLD.accepted_at, OLD.accepted_by) THEN
    RAISE EXCEPTION 'a % plan is closed', OLD.status USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plans_closed';
  END IF;
  IF OLD.status NOT IN ('draft', 'proposed') AND (NEW.accepted_at, NEW.accepted_by, NEW.patient_id) IS DISTINCT FROM (OLD.accepted_at, OLD.accepted_by, OLD.patient_id) THEN
    RAISE EXCEPTION 'the acceptance of a plan is not changed' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plans_locked';
  END IF;
  RETURN NEW;
END $$;

-- What a merge would move, per table (for the confirmation screen). Clinic-checked like the merge.
CREATE OR REPLACE FUNCTION patient_merge_counts(p_patient uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := current_tenant_id(); v jsonb := '{}'; n int; t text;
BEGIN
  IF v_tenant IS NULL OR NOT EXISTS (SELECT 1 FROM patients WHERE id = p_patient AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'patient not found' USING ERRCODE = 'no_data_found';
  END IF;
  FOREACH t IN ARRAY ARRAY['appointments', 'invoices', 'payment_plans', 'payments', 'visits', 'treatment_plans', 'prescriptions', 'tooth_records', 'recalls', 'patient_files', 'patient_consents', 'lab_orders', 'reviews', 'waitlist_entries', 'notifications', 'patient_medical_history_versions'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = $1 AND patient_id = $2', t) INTO n USING v_tenant, p_patient;
    IF n > 0 THEN v := v || jsonb_build_object(t, n); END IF;
  END LOOP;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION merge_patients(p_survivor uuid, p_merged uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_member uuid := current_member_id();
  s patients; m patients; hs patient_medical_history; hm patient_medical_history;
  v_moved jsonb := '{}'; n int; t text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no clinic for this request' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_survivor = p_merged THEN
    RAISE EXCEPTION 'a record cannot be merged into itself' USING ERRCODE = 'check_violation', CONSTRAINT = 'patients_merge_self';
  END IF;
  -- both rows locked in one order, so two merges of the same pair cannot cross
  PERFORM 1 FROM patients WHERE tenant_id = v_tenant AND id IN (p_survivor, p_merged) ORDER BY id FOR UPDATE;
  SELECT * INTO s FROM patients WHERE tenant_id = v_tenant AND id = p_survivor AND deleted_at IS NULL;
  SELECT * INTO m FROM patients WHERE tenant_id = v_tenant AND id = p_merged AND deleted_at IS NULL;
  IF s.id IS NULL OR m.id IS NULL THEN RAISE EXCEPTION 'patient not found' USING ERRCODE = 'no_data_found'; END IF;
  IF s.merged_into_id IS NOT NULL OR m.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'one of the records is already merged' USING ERRCODE = 'check_violation', CONSTRAINT = 'patients_already_merged';
  END IF;

  PERFORM set_config('app.patient_merge', 'on', true);
  -- in this order: a row moves after the rows it is checked against (payment -> invoice, visit -> appointment)
  FOREACH t IN ARRAY ARRAY['appointments', 'invoices', 'payment_plans', 'payments', 'visits', 'treatment_plans', 'prescriptions', 'tooth_records', 'recalls', 'patient_files', 'patient_consents', 'lab_orders', 'reviews', 'waitlist_entries', 'notifications', 'patient_medical_history_versions'] LOOP
    EXECUTE format('UPDATE %I SET patient_id = $1 WHERE tenant_id = $2 AND patient_id = $3', t) USING p_survivor, v_tenant, p_merged;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN v_moved := v_moved || jsonb_build_object(t, n); END IF;
  END LOOP;

  -- CLR-15: the lists are combined; the survivor's flags and notes are kept (the merged ones stay in its versions)
  SELECT * INTO hs FROM patient_medical_history WHERE tenant_id = v_tenant AND patient_id = p_survivor;
  SELECT * INTO hm FROM patient_medical_history WHERE tenant_id = v_tenant AND patient_id = p_merged;
  IF hm.patient_id IS NOT NULL THEN
    IF hs.patient_id IS NULL THEN
      INSERT INTO patient_medical_history (tenant_id, patient_id, allergies, conditions, medications, is_pregnant, is_smoker, notes, updated_by)
      VALUES (v_tenant, p_survivor, hm.allergies, hm.conditions, hm.medications, hm.is_pregnant, hm.is_smoker, hm.notes, v_member);
    ELSE
      UPDATE patient_medical_history SET
        allergies = text_array_union(hs.allergies, hm.allergies), conditions = text_array_union(hs.conditions, hm.conditions),
        medications = text_array_union(hs.medications, hm.medications), updated_by = v_member, updated_at = now()
      WHERE tenant_id = v_tenant AND patient_id = p_survivor;
    END IF;
    DELETE FROM patient_medical_history WHERE tenant_id = v_tenant AND patient_id = p_merged;
    v_moved := v_moved || jsonb_build_object('patient_medical_history', 1);
  END IF;

  -- family links and earlier merges follow the survivor; the merged record leaves every list
  UPDATE patients SET guardian_patient_id = CASE WHEN id = p_survivor THEN NULL ELSE p_survivor END
   WHERE tenant_id = v_tenant AND guardian_patient_id = p_merged;
  UPDATE patients SET merged_into_id = p_survivor WHERE tenant_id = v_tenant AND merged_into_id = p_merged;
  UPDATE patients SET merged_into_id = p_survivor, merged_at = now(), updated_at = now() WHERE tenant_id = v_tenant AND id = p_merged;
  PERFORM set_config('app.patient_merge', '', true);
  RETURN v_moved;
END $$;

ALTER FUNCTION patient_merge_counts(uuid) OWNER TO app_definer;
ALTER FUNCTION merge_patients(uuid, uuid) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION patient_merge_counts(uuid), merge_patients(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION patient_merge_counts(uuid), merge_patients(uuid, uuid) TO app_user;

-- what the merge (and the triggers it fires: audit, invoice totals, installments, plan estimate) needs
GRANT SELECT, UPDATE ON patients, appointments, invoices, payment_plans, payments, visits, treatment_plans, prescriptions, tooth_records, recalls, patient_files, patient_consents, lab_orders, reviews, waitlist_entries, notifications, patient_medical_history_versions, installments TO app_definer;
GRANT SELECT, INSERT, UPDATE, DELETE ON patient_medical_history TO app_definer;
GRANT INSERT ON patient_medical_history_versions, audit_log TO app_definer;
GRANT SELECT ON invoice_items, treatment_plan_items, doctor_branches, doctors, services, refunds TO app_definer;

-- migrate:down
REVOKE SELECT ON invoice_items, treatment_plan_items, doctor_branches, doctors, services, refunds FROM app_definer;
REVOKE INSERT ON patient_medical_history_versions, audit_log FROM app_definer;
REVOKE SELECT, INSERT, UPDATE, DELETE ON patient_medical_history FROM app_definer;
REVOKE SELECT, UPDATE ON patients, invoices, payment_plans, payments, visits, treatment_plans, prescriptions, tooth_records, recalls, patient_files, patient_consents, lab_orders, reviews, waitlist_entries, notifications, patient_medical_history_versions, installments FROM app_definer;
REVOKE UPDATE ON appointments FROM app_definer;
GRANT SELECT, UPDATE ON appointments TO app_definer; -- as 0002 left them
GRANT SELECT ON payments TO app_definer;
DROP FUNCTION IF EXISTS merge_patients(uuid, uuid);
DROP FUNCTION IF EXISTS patient_merge_counts(uuid);

CREATE OR REPLACE FUNCTION public.payments_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
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

CREATE OR REPLACE FUNCTION public.invoices_derive()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION public.visits_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' THEN RETURN coalesce(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinical visits are never deleted' USING ERRCODE = 'check_violation', CONSTRAINT = 'visits_never_deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'draft'; NEW.finalized_at := NULL; NEW.finalized_by := NULL;
    RETURN NEW;
  END IF;
  IF OLD.status = 'final' AND (
       NEW.status <> 'final'
    OR (NEW.chief_complaint, NEW.diagnosis, NEW.clinical_notes, NEW.next_visit_note, NEW.finalized_at, NEW.finalized_by,
        NEW.patient_id, NEW.doctor_id, NEW.branch_id, NEW.appointment_id, NEW.visit_at)
       IS DISTINCT FROM
       (OLD.chief_complaint, OLD.diagnosis, OLD.clinical_notes, OLD.next_visit_note, OLD.finalized_at, OLD.finalized_by,
        OLD.patient_id, OLD.doctor_id, OLD.branch_id, OLD.appointment_id, OLD.visit_at)) THEN
    RAISE EXCEPTION 'visit % is final; add an amendment instead', OLD.id USING ERRCODE = 'check_violation', CONSTRAINT = 'visits_finalized';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'final' THEN
    NEW.finalized_at := now();
    NEW.finalized_by := coalesce(NEW.finalized_by, current_member_id());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.treatment_plans_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'a plan starts as a draft' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plans_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('proposed', 'cancelled'))
    OR (OLD.status = 'proposed' AND NEW.status IN ('accepted', 'cancelled'))
    OR (OLD.status IN ('accepted', 'in_progress') AND NEW.status = 'cancelled')
    OR (OLD.status IN ('accepted', 'in_progress', 'completed') AND NEW.status IN ('accepted', 'in_progress', 'completed'))) THEN
    RAISE EXCEPTION 'a % plan cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plans_transition';
  END IF;
  IF OLD.status IN ('completed', 'cancelled') AND OLD.status = NEW.status
     AND (NEW.title, NEW.notes, NEW.doctor_id, NEW.accepted_at, NEW.accepted_by) IS DISTINCT FROM (OLD.title, OLD.notes, OLD.doctor_id, OLD.accepted_at, OLD.accepted_by) THEN
    RAISE EXCEPTION 'a % plan is closed', OLD.status USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plans_closed';
  END IF;
  IF OLD.status NOT IN ('draft', 'proposed') AND (NEW.accepted_at, NEW.accepted_by, NEW.patient_id) IS DISTINCT FROM (OLD.accepted_at, OLD.accepted_by, OLD.patient_id) THEN
    RAISE EXCEPTION 'the acceptance of a plan is not changed' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plans_locked';
  END IF;
  RETURN NEW;
END $$;

DROP FUNCTION IF EXISTS text_array_union(text[], text[]);
DROP FUNCTION IF EXISTS patient_merge_only(oid, jsonb, jsonb);
