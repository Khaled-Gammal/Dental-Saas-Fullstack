-- migrate:up transaction:false
-- Review R11 (cleanup): installments_open_due (0024) is an exact copy of installments_open (initial schema): same
-- columns, same condition. Every write to installments paid for both.
DROP INDEX CONCURRENTLY IF EXISTS installments_open_due;

-- migrate:down transaction:false
CREATE INDEX CONCURRENTLY IF NOT EXISTS installments_open_due ON installments (tenant_id, due_date) WHERE status IN ('due', 'partially_paid');
