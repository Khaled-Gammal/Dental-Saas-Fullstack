-- migrate:up
-- Review R11: a refund sent twice (a double click, a retried request) recorded two refunds when the amount allowed it.
-- Like payments, a refund may carry an idempotency key; the same key twice in a clinic is one refund. Optional, so
-- older clients keep working. refunds is small and the column is new (all NULL): a plain index build is instant.
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS refunds_tenant_idempotency ON refunds (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS refunds_tenant_idempotency;
ALTER TABLE refunds DROP COLUMN IF EXISTS idempotency_key;
