-- migrate:up transaction:false
-- Review R11: see patients_phone_alt.
CREATE INDEX CONCURRENTLY IF NOT EXISTS patients_guardian_phone ON patients (tenant_id, guardian_phone) WHERE guardian_phone IS NOT NULL;

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS patients_guardian_phone;
