-- migrate:up
-- Phase D4: clinical workflow (SRS VISIT-001…005, CHART-001, TPLAN-001…004, APPT-007, AUDIT-002). Additive; the
-- clinical tables have no rows yet. Decisions applied: CLR-06 (a visit is final when the doctor finalizes it or its
-- appointment is completed, whichever is first; amendments by the author or the owner, with a reason), CLR-11 (staff
-- record plan acceptance: member + time), CLR-16 (procedure price = the service price or within its range).
-- Every guard is silent during a tenant hard delete (app.allow_hard_delete), like the existing ones.

CREATE OR REPLACE FUNCTION current_member_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.member_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------
-- 1. Visits: draft -> final; a final note is never overwritten (VISIT-002, D-06)
-- ---------------------------------------------------------------------
ALTER TABLE visits
  ADD COLUMN status       text NOT NULL DEFAULT 'draft' CONSTRAINT visits_status CHECK (status IN ('draft', 'final')),
  ADD COLUMN finalized_at timestamptz,
  ADD COLUMN finalized_by uuid,
  ADD CONSTRAINT visits_finalized_complete CHECK ((status = 'final') = (finalized_at IS NOT NULL)),
  ADD CONSTRAINT visits_finalized_by_member_fk FOREIGN KEY (tenant_id, finalized_by) REFERENCES tenant_members(tenant_id, id),
  ADD CONSTRAINT visits_text_length CHECK (
    coalesce(char_length(chief_complaint), 0) <= 2000 AND coalesce(char_length(diagnosis), 0) <= 2000
    AND coalesce(char_length(clinical_notes), 0) <= 10000 AND coalesce(char_length(next_visit_note), 0) <= 2000);
CREATE INDEX visits_doctor_open ON visits (tenant_id, doctor_id, visit_at DESC) WHERE status = 'draft';

CREATE OR REPLACE FUNCTION visits_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER visits_guard BEFORE INSERT OR UPDATE OR DELETE ON visits FOR EACH ROW EXECUTE FUNCTION visits_guard();

-- opening the visit of a checked-in patient starts the appointment (VISIT-001)
CREATE OR REPLACE FUNCTION visits_start_appointment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.appointment_id IS NOT NULL THEN
    UPDATE appointments SET status = 'in_progress', updated_at = now() WHERE id = NEW.appointment_id AND status = 'checked_in';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER visits_start_appointment AFTER INSERT ON visits FOR EACH ROW EXECUTE FUNCTION visits_start_appointment();

-- Amendments: the original stays, each change is a new row (VISIT-002)
CREATE TABLE visit_amendments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  visit_id    uuid NOT NULL,
  field       text NOT NULL CONSTRAINT visit_amendments_field CHECK (field IN ('chief_complaint', 'diagnosis', 'clinical_notes', 'next_visit_note')),
  new_text    text NOT NULL CONSTRAINT visit_amendments_text_length CHECK (char_length(new_text) <= 10000),
  reason      text NOT NULL CONSTRAINT visit_amendments_reason CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  author_id   uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, author_id) REFERENCES tenant_members(tenant_id, id)
);
CREATE INDEX visit_amendments_visit ON visit_amendments (tenant_id, visit_id, created_at);
ALTER TABLE visit_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_amendments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON visit_amendments USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY branch_access ON visit_amendments AS RESTRICTIVE
  USING ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM visits v WHERE v.id = visit_id))
  WITH CHECK ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM visits v WHERE v.id = visit_id));
REVOKE UPDATE, DELETE ON visit_amendments FROM app_user;

CREATE OR REPLACE FUNCTION visit_amendments_validate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM visits WHERE id = NEW.visit_id AND status = 'final') THEN
    RAISE EXCEPTION 'only a final visit is amended; edit the draft instead' USING ERRCODE = 'check_violation', CONSTRAINT = 'visit_amendments_visit_final';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER visit_amendments_validate BEFORE INSERT ON visit_amendments FOR EACH ROW EXECUTE FUNCTION visit_amendments_validate();

-- completing the appointment finalizes its visit (CLR-06: whichever comes first)
CREATE OR REPLACE FUNCTION appointments_clinical_follow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    UPDATE visits SET status = 'final' WHERE appointment_id = NEW.id AND status = 'draft';
    UPDATE recalls SET status = 'done' WHERE appointment_id = NEW.id AND status = 'booked';
  ELSE -- cancelled or no-show
    -- the booked follow-up and the scheduled plan item are open again (APPT-007, VISIT-005)
    UPDATE recalls SET status = 'pending', appointment_id = NULL WHERE appointment_id = NEW.id AND status = 'booked';
    UPDATE treatment_plan_items SET status = 'planned', appointment_id = NULL WHERE appointment_id = NEW.id AND status = 'scheduled';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER appointments_clinical_follow AFTER UPDATE OF status ON appointments
  -- not on hold expiry: a hold never carries a follow-up or plan item (and the hold release runs as app_definer)
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('completed', 'cancelled', 'no_show'))
  EXECUTE FUNCTION appointments_clinical_follow();

-- ---------------------------------------------------------------------
-- 2. Treatment plans: status flow, acceptance, items frozen once accepted (TPLAN-001…003, D-07)
-- ---------------------------------------------------------------------
ALTER TABLE treatment_plans
  ADD COLUMN accepted_by uuid,
  ADD CONSTRAINT treatment_plans_accepted_by_member_fk FOREIGN KEY (tenant_id, accepted_by) REFERENCES tenant_members(tenant_id, id),
  ADD CONSTRAINT treatment_plans_accepted_recorded CHECK (status NOT IN ('accepted', 'in_progress', 'completed') OR accepted_at IS NOT NULL),
  ADD CONSTRAINT treatment_plans_title_length CHECK (char_length(btrim(title)) BETWEEN 1 AND 200);
ALTER TABLE treatment_plan_items
  ADD CONSTRAINT treatment_plan_items_tooth CHECK (tooth_code IS NULL OR
    (tooth_code / 10 BETWEEN 1 AND 4 AND tooth_code % 10 BETWEEN 1 AND 8) OR (tooth_code / 10 BETWEEN 5 AND 8 AND tooth_code % 10 BETWEEN 1 AND 5)),
  ADD CONSTRAINT treatment_plan_items_surfaces CHECK (surfaces <@ ARRAY['M','O','D','B','L','I','F','P']::text[]);
CREATE INDEX treatment_plan_items_appointment ON treatment_plan_items (appointment_id) WHERE appointment_id IS NOT NULL;

-- the plan's progress follows its items: any done -> in_progress; all done or cancelled -> completed
CREATE OR REPLACE FUNCTION treatment_plan_progress(p_plan uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL
              WHEN bool_and(status IN ('done', 'cancelled')) THEN 'completed'
              WHEN bool_or(status = 'done') THEN 'in_progress'
              ELSE 'accepted' END
  FROM treatment_plan_items WHERE plan_id = p_plan
$$;

CREATE OR REPLACE FUNCTION treatment_plans_derive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.total_estimate_minor := (SELECT coalesce(sum(price_minor - discount_minor), 0) FROM treatment_plan_items
                               WHERE plan_id = NEW.id AND status <> 'cancelled');
  IF NEW.status IN ('accepted', 'in_progress', 'completed') THEN
    NEW.status := coalesce(treatment_plan_progress(NEW.id), NEW.status);
  END IF;
  RETURN NEW;
END $$;

-- the edges a person may take; moves between accepted / in_progress / completed are derived above
CREATE OR REPLACE FUNCTION treatment_plans_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER treatment_plans_guard BEFORE INSERT OR UPDATE ON treatment_plans FOR EACH ROW EXECUTE FUNCTION treatment_plans_guard();

-- Items: free while the plan is a draft or proposal; afterwards only their status moves, and never back from cancelled
CREATE OR REPLACE FUNCTION treatment_plan_items_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_plan text; r treatment_plan_items;
BEGIN
  IF coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' THEN RETURN coalesce(NEW, OLD); END IF;
  r := coalesce(NEW, OLD);
  SELECT status INTO v_plan FROM treatment_plans WHERE id = r.plan_id;
  IF TG_OP IN ('INSERT', 'DELETE') THEN
    IF v_plan NOT IN ('draft', 'proposed') THEN
      RAISE EXCEPTION 'items of a % plan are not added or removed; cancel the item instead', v_plan
        USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plan_items_locked';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status NOT IN ('planned', 'scheduled') THEN
      RAISE EXCEPTION 'a new item is planned' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plan_items_status';
    END IF;
    RETURN r;
  END IF;
  IF v_plan NOT IN ('draft', 'proposed') AND (NEW.plan_id, NEW.service_id, NEW.tooth_code, NEW.surfaces, NEW.price_minor, NEW.discount_minor)
       IS DISTINCT FROM (OLD.plan_id, OLD.service_id, OLD.tooth_code, OLD.surfaces, OLD.price_minor, OLD.discount_minor) THEN
    RAISE EXCEPTION 'the items of a % plan are fixed', v_plan USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plan_items_locked';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF OLD.status = 'cancelled' THEN
      RAISE EXCEPTION 'a cancelled item stays cancelled' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plan_items_status';
    END IF;
    IF NEW.status = 'done' AND NOT EXISTS (SELECT 1 FROM visit_procedures WHERE plan_item_id = NEW.id) THEN
      RAISE EXCEPTION 'an item is done when a procedure records it' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plan_items_status';
    END IF;
    IF OLD.status = 'done' AND EXISTS (SELECT 1 FROM visit_procedures WHERE plan_item_id = NEW.id) THEN
      RAISE EXCEPTION 'a performed item stays done' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plan_items_status';
    END IF;
    IF NEW.status = 'scheduled' AND NEW.appointment_id IS NULL THEN
      RAISE EXCEPTION 'a scheduled item has its appointment' USING ERRCODE = 'check_violation', CONSTRAINT = 'treatment_plan_items_status';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER treatment_plan_items_guard BEFORE INSERT OR UPDATE OR DELETE ON treatment_plan_items
  FOR EACH ROW EXECUTE FUNCTION treatment_plan_items_guard();

-- ---------------------------------------------------------------------
-- 3. Procedures: price within the service's range, plan item marked done, fixed once the visit is final or billed
-- ---------------------------------------------------------------------
ALTER TABLE visit_procedures
  ADD CONSTRAINT visit_procedures_tooth CHECK (tooth_code IS NULL OR
    (tooth_code / 10 BETWEEN 1 AND 4 AND tooth_code % 10 BETWEEN 1 AND 8) OR (tooth_code / 10 BETWEEN 5 AND 8 AND tooth_code % 10 BETWEEN 1 AND 5)),
  ADD CONSTRAINT visit_procedures_surfaces CHECK (surfaces <@ ARRAY['M','O','D','B','L','I','F','P']::text[]),
  ADD COLUMN created_by uuid,
  ADD CONSTRAINT visit_procedures_created_by_member_fk FOREIGN KEY (tenant_id, created_by) REFERENCES tenant_members(tenant_id, id);
CREATE INDEX visit_procedures_plan_item ON visit_procedures (plan_item_id) WHERE plan_item_id IS NOT NULL;

CREATE OR REPLACE FUNCTION visit_procedures_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s record; v_visit text; v_plan text; v_item text;
BEGIN
  IF coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' THEN RETURN coalesce(NEW, OLD); END IF;
  IF TG_OP <> 'INSERT' THEN
    -- doctor payouts (deferred feature) only set payout_id; commission_minor is generated (still NULL in NEW here)
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'payout_id' - 'commission_minor') = (to_jsonb(OLD) - 'payout_id' - 'commission_minor') THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
               WHERE ii.visit_procedure_id = OLD.id AND i.status <> 'void') THEN
      RAISE EXCEPTION 'procedure % is billed', OLD.id USING ERRCODE = 'check_violation', CONSTRAINT = 'visit_procedures_billed';
    END IF;
    IF (SELECT status FROM visits WHERE id = OLD.visit_id) = 'final' THEN
      RAISE EXCEPTION 'the visit is final' USING ERRCODE = 'check_violation', CONSTRAINT = 'visits_finalized';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.plan_item_id, NEW.visit_id) IS DISTINCT FROM (OLD.plan_item_id, OLD.visit_id) THEN
      RAISE EXCEPTION 'record another procedure instead' USING ERRCODE = 'check_violation', CONSTRAINT = 'visit_procedures_fixed';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  -- CLR-16: the service price, or within its range; a service "priced on consultation" (0) takes the doctor's price
  SELECT price_minor, price_max_minor INTO s FROM services WHERE id = NEW.service_id;
  IF s.price_minor > 0 AND NOT (NEW.price_minor BETWEEN s.price_minor AND coalesce(s.price_max_minor, s.price_minor)) THEN
    RAISE EXCEPTION 'price % is outside the service price range', NEW.price_minor USING ERRCODE = 'check_violation', CONSTRAINT = 'visit_procedures_price_range';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.plan_item_id IS NOT NULL THEN
    SELECT i.status, p.status INTO v_item, v_plan FROM treatment_plan_items i JOIN treatment_plans p ON p.id = i.plan_id
     WHERE i.id = NEW.plan_item_id FOR UPDATE OF i;
    IF v_plan NOT IN ('accepted', 'in_progress', 'completed') THEN
      RAISE EXCEPTION 'the plan is not accepted' USING ERRCODE = 'check_violation', CONSTRAINT = 'visit_procedures_plan_not_accepted';
    END IF;
    IF v_item IN ('done', 'cancelled') THEN
      RAISE EXCEPTION 'the plan item is %', v_item USING ERRCODE = 'check_violation', CONSTRAINT = 'visit_procedures_plan_item_closed';
    END IF;
  END IF;
  RETURN NEW;
END $$;
-- named to fire after visit_procedures_payout_guard and visit_procedures_validate (same-patient check)
CREATE TRIGGER visit_procedures_workflow BEFORE INSERT OR UPDATE OR DELETE ON visit_procedures FOR EACH ROW EXECUTE FUNCTION visit_procedures_workflow();

-- the linked plan item follows its procedure (TPLAN-003), and the plan follows its items
CREATE OR REPLACE FUNCTION visit_procedures_plan_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' AND NEW.plan_item_id IS NOT NULL THEN
    UPDATE treatment_plan_items SET status = 'done' WHERE id = NEW.plan_item_id;
  ELSIF TG_OP = 'DELETE' AND OLD.plan_item_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM visit_procedures WHERE plan_item_id = OLD.plan_item_id) THEN
    UPDATE treatment_plan_items SET status = CASE WHEN appointment_id IS NULL THEN 'planned' ELSE 'scheduled' END
     WHERE id = OLD.plan_item_id AND status = 'done';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER visit_procedures_plan_item AFTER INSERT OR DELETE ON visit_procedures FOR EACH ROW EXECUTE FUNCTION visit_procedures_plan_item();

-- ---------------------------------------------------------------------
-- 4. Chart entries belong to the visit's patient (CHART-001)
-- ---------------------------------------------------------------------
ALTER TABLE tooth_records
  ADD CONSTRAINT tooth_records_recorded_by_member_fk FOREIGN KEY (tenant_id, recorded_by) REFERENCES tenant_members(tenant_id, id),
  ADD CONSTRAINT tooth_records_notes_length CHECK (coalesce(char_length(notes), 0) <= 1000);
CREATE OR REPLACE FUNCTION tooth_records_validate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.visit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM visits WHERE id = NEW.visit_id AND patient_id = NEW.patient_id) THEN
    RAISE EXCEPTION 'the visit belongs to another patient' USING ERRCODE = 'check_violation', CONSTRAINT = 'tooth_records_visit_patient';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tooth_records_validate BEFORE INSERT ON tooth_records FOR EACH ROW EXECUTE FUNCTION tooth_records_validate();

-- ---------------------------------------------------------------------
-- 5. Prescriptions: issued, never edited; a correction replaces one and the old one stays (VISIT-004)
-- ---------------------------------------------------------------------
ALTER TABLE prescriptions
  ADD COLUMN replaces_id uuid,
  ADD COLUMN issued_by uuid,
  ADD CONSTRAINT prescriptions_replaces_fk FOREIGN KEY (tenant_id, replaces_id) REFERENCES prescriptions(tenant_id, id),
  ADD CONSTRAINT prescriptions_replaced_once UNIQUE (replaces_id),
  ADD CONSTRAINT prescriptions_issued_by_member_fk FOREIGN KEY (tenant_id, issued_by) REFERENCES tenant_members(tenant_id, id),
  ADD CONSTRAINT prescriptions_notes_length CHECK (coalesce(char_length(notes), 0) <= 1000);
ALTER TABLE prescription_items
  ADD CONSTRAINT prescription_items_lengths CHECK (char_length(btrim(drug_name)) BETWEEN 1 AND 200
    AND coalesce(char_length(dose), 0) <= 100 AND coalesce(char_length(frequency), 0) <= 100
    AND coalesce(char_length(duration), 0) <= 100 AND coalesce(char_length(instructions), 0) <= 500);
CREATE INDEX prescriptions_patient ON prescriptions (tenant_id, patient_id, issued_at DESC);
REVOKE UPDATE, DELETE ON prescriptions, prescription_items FROM app_user;

CREATE OR REPLACE FUNCTION prescriptions_validate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM visits WHERE id = NEW.visit_id AND patient_id = NEW.patient_id AND doctor_id = NEW.doctor_id) THEN
    RAISE EXCEPTION 'prescription patient/doctor must match its visit' USING ERRCODE = 'check_violation', CONSTRAINT = 'prescriptions_visit_match';
  END IF;
  IF NEW.replaces_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prescriptions WHERE id = NEW.replaces_id AND patient_id = NEW.patient_id) THEN
    RAISE EXCEPTION 'a correction replaces a prescription of the same patient' USING ERRCODE = 'check_violation', CONSTRAINT = 'prescriptions_visit_match';
  END IF;
  NEW.issued_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER prescriptions_validate BEFORE INSERT ON prescriptions FOR EACH ROW EXECUTE FUNCTION prescriptions_validate();

-- lines are written with their prescription, in the same transaction, never added later
CREATE OR REPLACE FUNCTION prescription_items_validate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM prescriptions WHERE id = NEW.prescription_id AND issued_at = now()) THEN
    RAISE EXCEPTION 'prescription % is already issued', NEW.prescription_id USING ERRCODE = 'check_violation', CONSTRAINT = 'prescriptions_issued';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prescription_items_validate BEFORE INSERT ON prescription_items FOR EACH ROW EXECUTE FUNCTION prescription_items_validate();

-- ---------------------------------------------------------------------
-- 6. Follow-ups (VISIT-005, D-08): who added them; notes keep the call log
-- ---------------------------------------------------------------------
ALTER TABLE recalls
  ADD COLUMN created_by uuid,
  ADD CONSTRAINT recalls_created_by_member_fk FOREIGN KEY (tenant_id, created_by) REFERENCES tenant_members(tenant_id, id),
  ADD CONSTRAINT recalls_notes_length CHECK (coalesce(char_length(notes), 0) <= 4000);
CREATE INDEX recalls_patient ON recalls (tenant_id, patient_id, due_date);

-- ---------------------------------------------------------------------
-- 7. Clinical audit (AUDIT-002): what changed and who, never the clinical text (listed as secret: logged as `true`)
-- ---------------------------------------------------------------------
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('visits', 'visit', ARRAY['chief_complaint', 'diagnosis', 'clinical_notes', 'next_visit_note']),
      ('visit_amendments', 'visit_amendment', ARRAY['new_text', 'reason']),
      ('visit_procedures', 'visit_procedure', ARRAY['notes']),
      ('tooth_records', 'tooth_record', ARRAY['notes']),
      ('treatment_plans', 'treatment_plan', ARRAY['notes']),
      ('treatment_plan_items', 'treatment_plan_item', ARRAY[]::text[]),
      ('prescriptions', 'prescription', ARRAY['notes']),
      ('prescription_items', 'prescription_item', ARRAY['drug_name', 'dose', 'frequency', 'duration', 'instructions']),
      ('recalls', 'recall', ARRAY['notes'])) x(tbl, entity, secret)
  LOOP
    EXECUTE format('CREATE TRIGGER audit_%s AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change(%L%s)',
      t.tbl, t.tbl, t.entity, (SELECT coalesce(string_agg(format(', %L', s), ''), '') FROM unnest(t.secret) s));
  END LOOP;
END $$;

-- migrate:down
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['visits','visit_amendments','visit_procedures','tooth_records','treatment_plans','treatment_plan_items',
                           'prescriptions','prescription_items','recalls'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%s ON %I', t, t);
  END LOOP;
END $$;
ALTER TABLE recalls DROP CONSTRAINT IF EXISTS recalls_notes_length, DROP CONSTRAINT IF EXISTS recalls_created_by_member_fk, DROP COLUMN IF EXISTS created_by;
DROP INDEX IF EXISTS recalls_patient;
DROP TRIGGER IF EXISTS prescription_items_validate ON prescription_items;
DROP FUNCTION IF EXISTS prescription_items_validate();
DROP TRIGGER IF EXISTS prescriptions_validate ON prescriptions;
DROP FUNCTION IF EXISTS prescriptions_validate();
GRANT UPDATE, DELETE ON prescriptions, prescription_items TO app_user;
DROP INDEX IF EXISTS prescriptions_patient;
ALTER TABLE prescription_items DROP CONSTRAINT IF EXISTS prescription_items_lengths;
ALTER TABLE prescriptions DROP CONSTRAINT IF EXISTS prescriptions_notes_length, DROP CONSTRAINT IF EXISTS prescriptions_issued_by_member_fk,
  DROP CONSTRAINT IF EXISTS prescriptions_replaced_once, DROP CONSTRAINT IF EXISTS prescriptions_replaces_fk,
  DROP COLUMN IF EXISTS issued_by, DROP COLUMN IF EXISTS replaces_id;
DROP TRIGGER IF EXISTS tooth_records_validate ON tooth_records;
DROP FUNCTION IF EXISTS tooth_records_validate();
ALTER TABLE tooth_records DROP CONSTRAINT IF EXISTS tooth_records_notes_length, DROP CONSTRAINT IF EXISTS tooth_records_recorded_by_member_fk;
DROP TRIGGER IF EXISTS visit_procedures_plan_item ON visit_procedures;
DROP FUNCTION IF EXISTS visit_procedures_plan_item();
DROP TRIGGER IF EXISTS visit_procedures_workflow ON visit_procedures;
DROP FUNCTION IF EXISTS visit_procedures_workflow();
DROP INDEX IF EXISTS visit_procedures_plan_item;
ALTER TABLE visit_procedures DROP CONSTRAINT IF EXISTS visit_procedures_created_by_member_fk, DROP COLUMN IF EXISTS created_by,
  DROP CONSTRAINT IF EXISTS visit_procedures_surfaces, DROP CONSTRAINT IF EXISTS visit_procedures_tooth;
DROP TRIGGER IF EXISTS treatment_plan_items_guard ON treatment_plan_items;
DROP FUNCTION IF EXISTS treatment_plan_items_guard();
DROP TRIGGER IF EXISTS treatment_plans_guard ON treatment_plans;
DROP FUNCTION IF EXISTS treatment_plans_guard();
CREATE OR REPLACE FUNCTION treatment_plans_derive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.total_estimate_minor := (SELECT coalesce(sum(price_minor - discount_minor), 0) FROM treatment_plan_items
                               WHERE plan_id = NEW.id AND status <> 'cancelled');
  RETURN NEW;
END $$;
DROP FUNCTION IF EXISTS treatment_plan_progress(uuid);
DROP INDEX IF EXISTS treatment_plan_items_appointment;
ALTER TABLE treatment_plan_items DROP CONSTRAINT IF EXISTS treatment_plan_items_surfaces, DROP CONSTRAINT IF EXISTS treatment_plan_items_tooth;
ALTER TABLE treatment_plans DROP CONSTRAINT IF EXISTS treatment_plans_title_length, DROP CONSTRAINT IF EXISTS treatment_plans_accepted_recorded,
  DROP CONSTRAINT IF EXISTS treatment_plans_accepted_by_member_fk, DROP COLUMN IF EXISTS accepted_by;
DROP TRIGGER IF EXISTS appointments_clinical_follow ON appointments;
DROP FUNCTION IF EXISTS appointments_clinical_follow();
DROP TABLE IF EXISTS visit_amendments;
DROP FUNCTION IF EXISTS visit_amendments_validate();
DROP TRIGGER IF EXISTS visits_start_appointment ON visits;
DROP FUNCTION IF EXISTS visits_start_appointment();
DROP TRIGGER IF EXISTS visits_guard ON visits;
DROP FUNCTION IF EXISTS visits_guard();
DROP INDEX IF EXISTS visits_doctor_open;
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_text_length, DROP CONSTRAINT IF EXISTS visits_finalized_by_member_fk,
  DROP CONSTRAINT IF EXISTS visits_finalized_complete, DROP COLUMN IF EXISTS finalized_by, DROP COLUMN IF EXISTS finalized_at,
  DROP COLUMN IF EXISTS status;
DROP FUNCTION IF EXISTS current_member_id();
