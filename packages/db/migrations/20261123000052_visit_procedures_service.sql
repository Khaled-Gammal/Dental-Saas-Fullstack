-- migrate:up transaction:false
-- Review R11: the foreign-key check when a service is deleted, and "is this service used", scanned every procedure.
CREATE INDEX CONCURRENTLY IF NOT EXISTS visit_procedures_service ON visit_procedures (service_id);

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS visit_procedures_service;
