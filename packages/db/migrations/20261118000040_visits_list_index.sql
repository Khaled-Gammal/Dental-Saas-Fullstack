-- migrate:up transaction:false
-- Redesign R5: the dashboard's visits list (today's visits, the open drafts, all) reads a clinic's visits newest first,
-- keyset-paged on (visit_at, id). The existing indexes cover one patient's visits and a doctor's drafts only.
CREATE INDEX CONCURRENTLY IF NOT EXISTS visits_tenant_visit_at ON visits (tenant_id, visit_at DESC, id DESC);

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS visits_tenant_visit_at;
