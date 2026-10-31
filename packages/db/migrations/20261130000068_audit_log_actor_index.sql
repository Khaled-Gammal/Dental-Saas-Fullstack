-- migrate:up transaction:false
-- Phase 2D: the activity log filtered by who acted ("what did this member do this month") reads that member's rows in
-- time order instead of the whole clinic's range. Built without blocking writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_tenant_actor_created ON audit_log (tenant_id, actor_user_id, created_at DESC);

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS audit_log_tenant_actor_created;
