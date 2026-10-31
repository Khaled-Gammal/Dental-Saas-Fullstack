-- migrate:up
-- Review R10 (performance): the cash day picked its payments and refunds with business_date(paid_at, tenant) = day.
-- A function of the column cannot use an index, and business_date() reads the clinic's timezone for every row, so each
-- cash-day screen, close and figure walked every payment the branch ever took. The same day as a time range
-- [local midnight, next local midnight) uses payments_tenant_branch_paid / refunds_tenant_branch_at, and picks exactly
-- the same rows: (t AT TIME ZONE tz)::date = d  <=>  d::timestamp AT TIME ZONE tz <= t < (d + 1)::timestamp AT TIME ZONE tz.
-- The API's list of a day's movements (redesign R9) uses the same window through cash_day_window(), so every figure
-- stays the sum of its rows.
CREATE OR REPLACE FUNCTION cash_day_window(p_branch uuid, p_date date, OUT tenant_id uuid, OUT day_start timestamptz, OUT day_end timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT b.tenant_id,
         p_date::timestamp AT TIME ZONE coalesce(t.timezone, 'Africa/Cairo'),
         (p_date + 1)::timestamp AT TIME ZONE coalesce(t.timezone, 'Africa/Cairo')
    FROM branches b LEFT JOIN tenants t ON t.id = b.tenant_id
   WHERE b.id = p_branch
$$;

CREATE OR REPLACE FUNCTION cash_day_totals(p_branch uuid, p_date date) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH w AS (SELECT * FROM cash_day_window(p_branch, p_date)),
  pay AS (
    SELECT p.method, sum(p.amount_minor) AS amount FROM payments p, w
    WHERE p.tenant_id = w.tenant_id AND p.branch_id = p_branch AND p.status IN ('succeeded', 'partially_refunded', 'refunded')
      AND p.paid_at >= w.day_start AND p.paid_at < w.day_end GROUP BY p.method),
  ref AS (
    SELECT r.method, sum(r.amount_minor) AS amount FROM refunds r, w
    WHERE r.tenant_id = w.tenant_id AND r.branch_id = p_branch AND r.refunded_at >= w.day_start AND r.refunded_at < w.day_end GROUP BY r.method),
  exp AS (
    SELECT e.payment_method AS method, sum(e.amount_minor) AS amount FROM expenses e
    WHERE e.branch_id = p_branch AND e.spent_on = p_date AND e.status <> 'void' AND e.payment_method IS NOT NULL
    GROUP BY e.payment_method)
  SELECT jsonb_build_object(
    'payments', coalesce((SELECT jsonb_object_agg(method, amount) FROM pay), '{}'),
    'refunds', coalesce((SELECT jsonb_object_agg(method, amount) FROM ref), '{}'),
    'expenses', coalesce((SELECT jsonb_object_agg(method, amount) FROM exp), '{}'),
    'cash_in', coalesce((SELECT amount FROM pay WHERE method = 'cash'), 0),
    'cash_refunds', coalesce((SELECT amount FROM ref WHERE method = 'cash'), 0),
    'cash_expenses', coalesce((SELECT amount FROM exp WHERE method = 'cash'), 0))
$$;

-- migrate:down
CREATE OR REPLACE FUNCTION cash_day_totals(p_branch uuid, p_date date) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH t AS (SELECT tenant_id FROM branches WHERE id = p_branch),
  pay AS (
    SELECT p.method, sum(p.amount_minor) AS amount FROM payments p, t
    WHERE p.branch_id = p_branch AND p.status IN ('succeeded', 'partially_refunded', 'refunded')
      AND business_date(p.paid_at, t.tenant_id) = p_date GROUP BY p.method),
  ref AS (
    SELECT r.method, sum(r.amount_minor) AS amount FROM refunds r, t
    WHERE r.branch_id = p_branch AND business_date(r.refunded_at, t.tenant_id) = p_date GROUP BY r.method),
  exp AS (
    SELECT e.payment_method AS method, sum(e.amount_minor) AS amount FROM expenses e
    WHERE e.branch_id = p_branch AND e.spent_on = p_date AND e.status <> 'void' AND e.payment_method IS NOT NULL
    GROUP BY e.payment_method)
  SELECT jsonb_build_object(
    'payments', coalesce((SELECT jsonb_object_agg(method, amount) FROM pay), '{}'),
    'refunds', coalesce((SELECT jsonb_object_agg(method, amount) FROM ref), '{}'),
    'expenses', coalesce((SELECT jsonb_object_agg(method, amount) FROM exp), '{}'),
    'cash_in', coalesce((SELECT amount FROM pay WHERE method = 'cash'), 0),
    'cash_refunds', coalesce((SELECT amount FROM ref WHERE method = 'cash'), 0),
    'cash_expenses', coalesce((SELECT amount FROM exp WHERE method = 'cash'), 0))
$$;
DROP FUNCTION IF EXISTS cash_day_window(uuid, date);
