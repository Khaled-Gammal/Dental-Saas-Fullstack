-- migrate:up transaction:false
-- Review R11 (performance): the day and week views for every branch, the reports and the home figures read a clinic's
-- appointments by time alone; the existing indexes all lead with branch, doctor or patient.
CREATE INDEX CONCURRENTLY IF NOT EXISTS appointments_tenant_starts ON appointments (tenant_id, starts_at);

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS appointments_tenant_starts;
