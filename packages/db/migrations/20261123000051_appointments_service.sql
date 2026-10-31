-- migrate:up transaction:false
-- Review R11: deleting a service checked for its appointments with no index on
-- service_id, i.e. a scan of every appointment. Partial: walk-ins often have no service.
CREATE INDEX CONCURRENTLY IF NOT EXISTS appointments_service ON appointments (service_id) WHERE service_id IS NOT NULL;

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS appointments_service;
