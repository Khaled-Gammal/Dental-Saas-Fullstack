-- migrate:up transaction:false
-- Review R11: as visit_procedures_service, for treatment plan items.
CREATE INDEX CONCURRENTLY IF NOT EXISTS treatment_plan_items_service ON treatment_plan_items (service_id) WHERE service_id IS NOT NULL;

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS treatment_plan_items_service;
