-- migrate:up
-- Week 6: patient search and the automatic no-show rule.

-- Reception types the start of a mobile number ("0101…" -> "+20101…"): a prefix search on the clinic's patients.
-- text_pattern_ops lets `phone LIKE '+20101%'` use the index; tenant_id first keeps every lookup inside one clinic.
CREATE INDEX patients_phone_prefix ON patients (tenant_id, phone text_pattern_ops) WHERE deleted_at IS NULL;

-- Plan limit on patients (plans.limits.patients already exists: Basic 2 000, Pro 50 000); the API counts active ones.

-- SRS 4.10: a pending/confirmed appointment that was never checked in becomes `no_show` two hours after it ended.
-- Runs in the worker (app_worker crosses clinics); returns how many rows changed. The status trigger still applies.
CREATE OR REPLACE FUNCTION mark_no_shows(p_grace interval DEFAULT interval '2 hours') RETURNS int
LANGUAGE sql AS $$
  WITH x AS (
    UPDATE appointments SET status = 'no_show'
    WHERE status IN ('pending', 'confirmed') AND ends_at < now() - p_grace
    RETURNING 1)
  SELECT count(*)::int FROM x
$$;
REVOKE EXECUTE ON FUNCTION mark_no_shows(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_no_shows(interval) TO app_worker;
-- the sweep looks for old open appointments only
CREATE INDEX appointments_open_by_end ON appointments (ends_at) WHERE status IN ('pending', 'confirmed');

-- migrate:down
DROP INDEX IF EXISTS appointments_open_by_end;
DROP FUNCTION IF EXISTS mark_no_shows(interval);
DROP INDEX IF EXISTS patients_phone_prefix;
