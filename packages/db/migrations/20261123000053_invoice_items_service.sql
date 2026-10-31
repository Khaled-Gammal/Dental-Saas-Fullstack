-- migrate:up transaction:false
-- Review R11: as visit_procedures_service, for invoice lines (free-text lines have no service).
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoice_items_service ON invoice_items (service_id) WHERE service_id IS NOT NULL;

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS invoice_items_service;
