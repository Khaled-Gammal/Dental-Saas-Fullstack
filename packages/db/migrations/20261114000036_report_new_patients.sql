-- migrate:up
-- Statistics (owner 2026-10-21): "new patients" in a period = patients whose FIRST visit falls in it (not files opened:
-- a website booking that never came is not a new patient). Counted under that visit's branch, on its day in the
-- branch's zone, like report_procedures. It runs as the caller (no SECURITY DEFINER), under row-level security like
-- every report function: another clinic's visits are never read; for a member limited to some branches, "first visit"
-- is the first one they can see.
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
REVOKE EXECUTE ON FUNCTION report_new_patients(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_new_patients(date, date, uuid) TO app_user;

-- migrate:down
DROP FUNCTION IF EXISTS report_new_patients(date, date, uuid);
