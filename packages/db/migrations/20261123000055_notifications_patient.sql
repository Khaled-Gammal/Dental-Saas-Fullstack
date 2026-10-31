-- migrate:up transaction:false
-- Review R11: merging two patient files moves their notifications (patient_id = the merged file), and the foreign key
-- is checked when a patient row changes: both scanned the whole notifications table, which only grows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_patient ON notifications (patient_id) WHERE patient_id IS NOT NULL;

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS notifications_patient;
