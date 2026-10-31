-- migrate:up
-- Review R11 (performance): report_new_patients() found every patient's first visit over the clinic's whole history,
-- then kept those in the period — the cost grew with the years, not with the period asked for. Now only the visits
-- around the period are read (two days of slack each side for any branch time zone), and a patient counts when no
-- earlier visit exists (visits_tenant_id_patient_id_visit_at_idx). Same rows as before, same order of ties (visit_at,
-- then id), same row-level security (still not SECURITY DEFINER).
CREATE OR REPLACE FUNCTION report_new_patients(p_from date, p_to date, p_branch uuid DEFAULT NULL)
RETURNS TABLE (branch_id uuid, day date, n bigint)
LANGUAGE sql STABLE AS $$
  WITH first_in_window AS (
    SELECT DISTINCT ON (v.patient_id) v.id, v.patient_id, v.branch_id, v.visit_at,
      (v.visit_at AT TIME ZONE coalesce(b.timezone, clinic_timezone()))::date AS day
    FROM visits v JOIN branches b ON b.id = v.branch_id
    WHERE v.visit_at >= (p_from - 2)::timestamptz AND v.visit_at < (p_to + 3)::timestamptz
    ORDER BY v.patient_id, v.visit_at, v.id
  )
  SELECT f.branch_id, f.day, count(*)
  FROM first_in_window f
  WHERE f.day BETWEEN p_from AND p_to AND (p_branch IS NULL OR f.branch_id = p_branch)
    AND NOT EXISTS (SELECT 1 FROM visits e WHERE e.patient_id = f.patient_id
                      AND (e.visit_at < f.visit_at OR (e.visit_at = f.visit_at AND e.id < f.id)))
  GROUP BY f.branch_id, f.day
$$;

-- migrate:down
CREATE OR REPLACE FUNCTION report_new_patients(p_from date, p_to date, p_branch uuid DEFAULT NULL)
RETURNS TABLE (branch_id uuid, day date, n bigint)
LANGUAGE sql STABLE AS $$
  WITH first_visit AS (
    SELECT DISTINCT ON (v.patient_id) v.patient_id, v.branch_id,
      (v.visit_at AT TIME ZONE coalesce(b.timezone, clinic_timezone()))::date AS day
    FROM visits v JOIN branches b ON b.id = v.branch_id
    ORDER BY v.patient_id, v.visit_at, v.id
  )
  SELECT f.branch_id, f.day, count(*)
  FROM first_visit f
  WHERE f.day BETWEEN p_from AND p_to AND (p_branch IS NULL OR f.branch_id = p_branch)
  GROUP BY f.branch_id, f.day
$$;
