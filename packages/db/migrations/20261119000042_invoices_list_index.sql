-- migrate:up transaction:false
-- Review R10: the clinic's invoice list pages newest first on (created_at, id) (BILLING-*, the search and totals of
-- redesign R7 filter the same rows). The existing indexes cover one patient's invoices only, so each page sorted every
-- invoice of the clinic.
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_tenant_created ON invoices (tenant_id, created_at DESC, id DESC);

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS invoices_tenant_created;
