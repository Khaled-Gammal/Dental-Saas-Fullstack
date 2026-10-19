-- migrate:up transaction:false
-- Phase D3 (PATIENT-001): the trigram index for the normalised name, built without blocking writes. It replaces the
-- raw-name trigram index for name search; that one is kept for now (other queries may rely on it) and can be dropped
-- once nothing uses it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS patients_name_norm_trgm ON patients USING gin (tenant_id, full_name_norm gin_trgm_ops);

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS patients_name_norm_trgm;
