-- migrate:up transaction:false
-- Review R10: the visits list's "drafts" tab (redesign R5) lists every doctor's unfinalized visits newest first. The
-- doctor's own drafts have visits_doctor_open; across doctors, a few old forgotten drafts made the newest-first scan of
-- visits_tenant_visit_at walk most of the clinic's visits to find them. Drafts are few: a small partial index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS visits_tenant_drafts ON visits (tenant_id, visit_at DESC, id DESC) WHERE status = 'draft';

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS visits_tenant_drafts;
