-- migrate:up
-- Phase E4: reports (SRS REPORT-001…005; database design E-11).
-- Read-only functions that run with the CALLER's rights (no SECURITY DEFINER): row-level security keeps them inside the
-- clinic, and the branch_access policies keep a branch-limited member to their own branches (ACCESS-003), so a report
-- can never add up another branch's rows. They return fine-grained rows (per branch and day, method, status…); the API
-- rolls them up, so every total is the sum of the rows it shows.
-- Days: money is dated like the cash box — the clinic's business day (business_date(), 0025; invoices' issue_date is
-- set the same way, 0023). Appointments and visits are dated like the calendar — the branch's zone, else the clinic's.
-- Additive: functions only. The report indexes of E-11 already exist (0023: payments, refunds, invoices; 0025: expenses).

CREATE OR REPLACE FUNCTION clinic_timezone() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT timezone FROM tenants WHERE id = current_tenant_id()), 'Africa/Cairo')
$$;

-- REPORT-001: invoiced (issued, not void), payments received (reversed ones were entered in error and never count),
-- refunds paid, and waivers/write-offs (PAY-006), per branch, business day and method. Ranges are turned into instants
-- so the (tenant, branch, time) indexes are used.
CREATE OR REPLACE FUNCTION report_money(p_from date, p_to date, p_branch uuid DEFAULT NULL)
RETURNS TABLE (branch_id uuid, day date, kind text, method text, amount bigint, n bigint)
LANGUAGE sql STABLE AS $$
  WITH w AS (SELECT tz, (p_from::timestamp AT TIME ZONE tz) AS t0, ((p_to + 1)::timestamp AT TIME ZONE tz) AS t1
             FROM (SELECT clinic_timezone() AS tz) z)
  SELECT i.branch_id, i.issue_date, 'invoiced', NULL::text, sum(i.total_minor)::bigint, count(*)
  FROM invoices i
  WHERE i.status IN ('issued', 'partially_paid', 'paid') AND i.issue_date BETWEEN p_from AND p_to
    AND (p_branch IS NULL OR i.branch_id = p_branch)
  GROUP BY i.branch_id, i.issue_date
  UNION ALL
  SELECT p.branch_id, (p.paid_at AT TIME ZONE w.tz)::date, 'payment', p.method, sum(p.amount_minor)::bigint, count(*)
  FROM payments p, w
  WHERE p.status IN ('succeeded', 'partially_refunded', 'refunded') AND p.paid_at >= w.t0 AND p.paid_at < w.t1
    AND (p_branch IS NULL OR p.branch_id = p_branch)
  GROUP BY p.branch_id, 2, p.method
  UNION ALL
  SELECT r.branch_id, (r.refunded_at AT TIME ZONE w.tz)::date, 'refund', r.method, sum(r.amount_minor)::bigint, count(*)
  FROM refunds r, w
  WHERE r.refunded_at >= w.t0 AND r.refunded_at < w.t1 AND (p_branch IS NULL OR r.branch_id = p_branch)
  GROUP BY r.branch_id, 2, r.method
  UNION ALL
  SELECT i.branch_id, (a.created_at AT TIME ZONE w.tz)::date, 'adjustment', a.kind, sum(a.amount_minor)::bigint, count(*)
  FROM balance_adjustments a JOIN invoices i ON i.id = a.invoice_id, w
  WHERE a.created_at >= w.t0 AND a.created_at < w.t1 AND (p_branch IS NULL OR i.branch_id = p_branch)
  GROUP BY i.branch_id, 2, a.kind
$$;

-- REPORT-002: expenses by branch, day, category, method and status. Voided ones were recorded in error and are left
-- out; rejected ones are returned so the screen can show them apart (the cash did leave the drawer, EXP-003).
CREATE OR REPLACE FUNCTION report_expenses(p_from date, p_to date, p_branch uuid DEFAULT NULL)
RETURNS TABLE (branch_id uuid, day date, category_id uuid, method text, status text, amount bigint, n bigint)
LANGUAGE sql STABLE AS $$
  SELECT e.branch_id, e.spent_on, e.category_id, e.payment_method, e.status, sum(e.amount_minor)::bigint, count(*)
  FROM expenses e
  WHERE e.spent_on BETWEEN p_from AND p_to AND e.status <> 'void' AND (p_branch IS NULL OR e.branch_id = p_branch)
  GROUP BY e.branch_id, e.spent_on, e.category_id, e.payment_method, e.status
$$;

-- REPORT-003 / REPORT-005: appointments by branch, doctor and status. Website holds that lapsed (held, expired) were
-- never appointments. A wide UTC window lets the (tenant, branch, starts_at) index narrow the rows first.
CREATE OR REPLACE FUNCTION report_attendance(p_from date, p_to date, p_branch uuid DEFAULT NULL, p_doctor uuid DEFAULT NULL)
RETURNS TABLE (branch_id uuid, doctor_id uuid, status text, n bigint)
LANGUAGE sql STABLE AS $$
  SELECT a.branch_id, a.doctor_id, a.status, count(*)
  FROM appointments a JOIN branches b ON b.id = a.branch_id
  WHERE a.status NOT IN ('held', 'expired')
    AND a.starts_at >= ((p_from - 1)::timestamp AT TIME ZONE 'UTC') AND a.starts_at < ((p_to + 2)::timestamp AT TIME ZONE 'UTC')
    AND (a.starts_at AT TIME ZONE coalesce(b.timezone, clinic_timezone()))::date BETWEEN p_from AND p_to
    AND (p_branch IS NULL OR a.branch_id = p_branch) AND (p_doctor IS NULL OR a.doctor_id = p_doctor)
  GROUP BY a.branch_id, a.doctor_id, a.status
$$;

-- REPORT-005: procedures performed (count and value at the performed price, before invoice discounts) by the visit's
-- branch and date and the doctor who performed them. No commissions (DSH-20 is deferred).
CREATE OR REPLACE FUNCTION report_procedures(p_from date, p_to date, p_branch uuid DEFAULT NULL, p_doctor uuid DEFAULT NULL)
RETURNS TABLE (branch_id uuid, doctor_id uuid, amount bigint, n bigint)
LANGUAGE sql STABLE AS $$
  SELECT v.branch_id, vp.doctor_id, sum(vp.price_minor)::bigint, count(*)
  FROM visit_procedures vp JOIN visits v ON v.id = vp.visit_id JOIN branches b ON b.id = v.branch_id
  WHERE v.visit_at >= ((p_from - 1)::timestamp AT TIME ZONE 'UTC') AND v.visit_at < ((p_to + 2)::timestamp AT TIME ZONE 'UTC')
    AND (v.visit_at AT TIME ZONE coalesce(b.timezone, clinic_timezone()))::date BETWEEN p_from AND p_to
    AND (p_branch IS NULL OR v.branch_id = p_branch) AND (p_doctor IS NULL OR vp.doctor_id = p_doctor)
  GROUP BY v.branch_id, vp.doctor_id
$$;

-- REPORT-004: what patients owe now — issued invoices with a balance, per patient and branch.
CREATE OR REPLACE FUNCTION report_outstanding(p_branch uuid DEFAULT NULL)
RETURNS TABLE (patient_id uuid, branch_id uuid, balance bigint, invoices bigint, oldest date)
LANGUAGE sql STABLE AS $$
  SELECT i.patient_id, i.branch_id, sum(i.balance_minor)::bigint, count(*), min(i.issue_date)
  FROM invoices i
  WHERE i.status IN ('issued', 'partially_paid') AND i.balance_minor > 0 AND (p_branch IS NULL OR i.branch_id = p_branch)
  GROUP BY i.patient_id, i.branch_id
$$;

-- REPORT-004: installments unpaid after their due date (the clinic's today), with what remains and the days overdue.
CREATE OR REPLACE FUNCTION report_overdue_installments(p_branch uuid DEFAULT NULL)
RETURNS TABLE (installment_id uuid, invoice_id uuid, branch_id uuid, patient_id uuid, seq int, due_date date, remaining bigint, days_overdue int)
LANGUAGE sql STABLE AS $$
  SELECT s.id, i.id, i.branch_id, i.patient_id, s.seq, s.due_date, (s.amount_minor - s.paid_minor)::bigint,
         business_date(now(), current_tenant_id()) - s.due_date
  FROM installments s JOIN payment_plans pp ON pp.id = s.plan_id JOIN invoices i ON i.id = pp.invoice_id
  WHERE s.status IN ('due', 'partially_paid') AND pp.status = 'active' AND s.due_date < business_date(now(), current_tenant_id())
    AND (p_branch IS NULL OR i.branch_id = p_branch)
$$;

REVOKE EXECUTE ON FUNCTION report_money(date, date, uuid), report_expenses(date, date, uuid), report_attendance(date, date, uuid, uuid),
  report_procedures(date, date, uuid, uuid), report_outstanding(uuid), report_overdue_installments(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_money(date, date, uuid), report_expenses(date, date, uuid), report_attendance(date, date, uuid, uuid),
  report_procedures(date, date, uuid, uuid), report_outstanding(uuid), report_overdue_installments(uuid) TO app_user;

-- B.1 report rights: a system role missing the report permissions of its default (reception: reports:read:daily,
-- doctor: reports:read:own, accountant: reports:read) gets them. Clinics made at sign-up have them already; roles
-- written by hand before (the dev seed) did not. Only reports:* permissions are added; nothing is removed.
UPDATE roles r SET permissions = r.permissions || ARRAY(
  SELECT p FROM unnest(default_role_permissions(r.key)) p WHERE p LIKE 'reports:%' AND NOT p = ANY (r.permissions))
WHERE r.is_system
  AND EXISTS (SELECT 1 FROM unnest(default_role_permissions(r.key)) p WHERE p LIKE 'reports:%' AND NOT p = ANY (r.permissions));

-- migrate:down
-- Report permissions granted to roles stay (removing rights on rollback could surprise people); the functions go.
DROP FUNCTION IF EXISTS report_overdue_installments(uuid);
DROP FUNCTION IF EXISTS report_outstanding(uuid);
DROP FUNCTION IF EXISTS report_procedures(date, date, uuid, uuid);
DROP FUNCTION IF EXISTS report_attendance(date, date, uuid, uuid);
DROP FUNCTION IF EXISTS report_expenses(date, date, uuid);
DROP FUNCTION IF EXISTS report_money(date, date, uuid);
DROP FUNCTION IF EXISTS clinic_timezone();
