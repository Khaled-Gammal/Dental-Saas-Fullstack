-- migrate:up
-- Phase C, part 4: branch-scoped access (SRS §2.3, ACCESS-003; design: docs/database-design.md C-07, option B).
-- A member with all_branches = false sees and changes only rows of their branches in the branch-scoped tables.
-- Enforced by RESTRICTIVE row-level security policies, which PostgreSQL ANDs with tenant_isolation, so a query that
-- forgets a branch filter still cannot reach another branch. Patients stay clinic-wide (they have no branch).
--
-- Who is restricted is read from app.member_id, set by the API for signed-in requests only. Without it (public
-- website, sign-in itself, worker jobs) there is no branch restriction; clinic isolation still applies.

-- NULL = no branch restriction; otherwise the member's branches (empty = none, e.g. a disabled or unknown member).
CREATE OR REPLACE FUNCTION member_branch_ids() RETURNS uuid[]
LANGUAGE plpgsql STABLE AS $$
DECLARE v_member uuid := nullif(current_setting('app.member_id', true), '')::uuid; m record;
BEGIN
  IF v_member IS NULL THEN RETURN NULL; END IF;
  SELECT all_branches, status INTO m FROM tenant_members WHERE id = v_member AND tenant_id = current_tenant_id();
  IF NOT FOUND OR m.status <> 'active' THEN RETURN ARRAY[]::uuid[]; END IF;
  IF m.all_branches THEN RETURN NULL; END IF;
  RETURN coalesce((SELECT array_agg(branch_id) FROM member_branches WHERE member_id = v_member), ARRAY[]::uuid[]);
END $$;

-- "may the current member work in this branch?" — for clear API errors before the policy would refuse a write
CREATE OR REPLACE FUNCTION branch_allowed(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT b IS NULL OR p_branch = ANY (b) FROM (SELECT member_branch_ids() AS b) x
$$;

-- Tables with their own branch_id. `(SELECT member_branch_ids())` is evaluated once per statement (an InitPlan).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['appointments','visits','invoices','payments','expenses','lab_orders','waitlist_entries',
                           'inventory_stock','inventory_movements'] LOOP
    EXECUTE format($p$CREATE POLICY branch_access ON %I AS RESTRICTIVE
      USING ((SELECT member_branch_ids()) IS NULL OR branch_id = ANY ((SELECT member_branch_ids())::uuid[]))
      WITH CHECK ((SELECT member_branch_ids()) IS NULL OR branch_id = ANY ((SELECT member_branch_ids())::uuid[]))$p$, t);
  END LOOP;
END $$;

-- Rows that take their branch from a parent: visible exactly when the parent is (the parent's own policies apply
-- inside the subquery, so the rule follows the chain).
CREATE POLICY branch_access ON invoice_items AS RESTRICTIVE
  USING ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id))
  WITH CHECK ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id));
CREATE POLICY branch_access ON refunds AS RESTRICTIVE
  USING ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_id))
  WITH CHECK ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_id));
-- a plan without an invoice (e.g. on a treatment plan) has no branch and stays clinic-wide
CREATE POLICY branch_access ON payment_plans AS RESTRICTIVE
  USING ((SELECT member_branch_ids()) IS NULL OR invoice_id IS NULL OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id))
  WITH CHECK ((SELECT member_branch_ids()) IS NULL OR invoice_id IS NULL OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id));
CREATE POLICY branch_access ON installments AS RESTRICTIVE
  USING ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM payment_plans p WHERE p.id = plan_id))
  WITH CHECK ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM payment_plans p WHERE p.id = plan_id));
CREATE POLICY branch_access ON visit_procedures AS RESTRICTIVE
  USING ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM visits v WHERE v.id = visit_id))
  WITH CHECK ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM visits v WHERE v.id = visit_id));
CREATE POLICY branch_access ON prescriptions AS RESTRICTIVE
  USING ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM visits v WHERE v.id = visit_id))
  WITH CHECK ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM visits v WHERE v.id = visit_id));
CREATE POLICY branch_access ON prescription_items AS RESTRICTIVE
  USING ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM prescriptions p WHERE p.id = prescription_id))
  WITH CHECK ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM prescriptions p WHERE p.id = prescription_id));

-- ---------------------------------------------------------------------
-- A doctor's time is busy in every branch. Slot search must see bookings a branch-limited receptionist may not read,
-- so it asks for busy intervals only (no patient, no details), for the current clinic. Runs as app_definer.
-- ---------------------------------------------------------------------
GRANT SELECT ON tenant_members, member_branches TO app_definer;  -- member_branch_ids() may run inside definer functions
CREATE OR REPLACE FUNCTION doctor_busy_intervals(p_doctors uuid[], p_from timestamptz, p_to timestamptz)
RETURNS TABLE (doctor_id uuid, starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.doctor_id, a.starts_at, a.ends_at FROM appointments a
  WHERE a.tenant_id = current_tenant_id()
    AND a.doctor_id = ANY (p_doctors) AND a.starts_at < p_to AND a.ends_at > p_from
    AND a.status IN ('held','pending','confirmed','checked_in','in_progress','completed')
    AND (a.status <> 'held' OR a.hold_expires_at > now())
$$;
ALTER FUNCTION doctor_busy_intervals(uuid[], timestamptz, timestamptz) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION doctor_busy_intervals(uuid[], timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION doctor_busy_intervals(uuid[], timestamptz, timestamptz) TO app_user;

-- Releasing a doctor's stale holds before a booking must reach every branch, or a stale hold elsewhere would block the
-- insert. Same body as before plus an explicit clinic filter, now as app_definer.
CREATE OR REPLACE FUNCTION release_expired_holds(p_doctor uuid DEFAULT NULL) RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH x AS (
    UPDATE appointments SET status = 'expired'
    WHERE tenant_id = current_tenant_id() AND status = 'held' AND hold_expires_at < now()
      AND (p_doctor IS NULL OR doctor_id = p_doctor)
    RETURNING 1)
  SELECT count(*)::int FROM x
$$;
ALTER FUNCTION release_expired_holds(uuid) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION release_expired_holds(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_expired_holds(uuid) TO app_user, app_worker;

-- migrate:down
CREATE OR REPLACE FUNCTION release_expired_holds(p_doctor uuid DEFAULT NULL) RETURNS int
LANGUAGE sql SECURITY INVOKER AS $$
  WITH x AS (
    UPDATE appointments SET status = 'expired'
    WHERE status = 'held' AND hold_expires_at < now()
      AND (p_doctor IS NULL OR doctor_id = p_doctor)
    RETURNING 1)
  SELECT count(*)::int FROM x
$$;
ALTER FUNCTION release_expired_holds(uuid) OWNER TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION release_expired_holds(uuid) TO PUBLIC;
DROP FUNCTION IF EXISTS doctor_busy_intervals(uuid[], timestamptz, timestamptz);
REVOKE SELECT ON tenant_members, member_branches FROM app_definer;
GRANT SELECT ON tenant_members TO app_definer;  -- held since 0002
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['appointments','visits','invoices','payments','expenses','lab_orders','waitlist_entries',
                           'inventory_stock','inventory_movements','invoice_items','refunds','payment_plans','installments',
                           'visit_procedures','prescriptions','prescription_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS branch_access ON %I', t);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS branch_allowed(uuid);
DROP FUNCTION IF EXISTS member_branch_ids();
