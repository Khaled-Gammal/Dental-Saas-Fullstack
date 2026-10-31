-- migrate:up transaction:false
-- Review R11: a search by phone matches phone OR phone_alt OR guardian_phone. With an index on phone only, the OR
-- forced a scan of the clinic's patients; with these two the three are combined (bitmap OR).
CREATE INDEX CONCURRENTLY IF NOT EXISTS patients_phone_alt ON patients (tenant_id, phone_alt) WHERE phone_alt IS NOT NULL;

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS patients_phone_alt;
