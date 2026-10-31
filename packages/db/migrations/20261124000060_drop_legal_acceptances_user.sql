-- migrate:up transaction:false
-- Review R11 (cleanup): legal_acceptances_user (user_id) is the leading column of the unique legal_acceptances_once
-- (user_id, document_id, tenant_id), which already serves every lookup by person.
DROP INDEX CONCURRENTLY IF EXISTS legal_acceptances_user;

-- migrate:down transaction:false
CREATE INDEX CONCURRENTLY IF NOT EXISTS legal_acceptances_user ON legal_acceptances (user_id);
