-- Schema v4 audit, phase 3 (docs/database/schema-v3-audit.md): the brief's concurrency scenarios with two real sessions.
-- Scenario 5 (two requests cannot double-book a doctor), scenario 7 (an expired hold frees the slot for exactly one
-- booking) and FIN-02 (one idempotency key, one payment, even at the same moment). Scenario 6 (over-refund) and the
-- over-payment race are in 05_concurrency. dblink opens the second session as the API role; fixtures are committed
-- (the test database is rebuilt on every run) and use dates and ids of their own.
\set ON_ERROR_STOP 1
SELECT dblink_connect('other', 'host=127.0.0.1 port=' || current_setting('port') || ' dbname=' || current_database() || ' user=app_user password=app_user_dev');

-- ---------------------------------------------------------------------------------------------------------------
-- Scenario 5: two receptionists book Dr Ahmed for the same half hour at the same moment
-- ---------------------------------------------------------------------------------------------------------------
SELECT dblink_exec('other', 'BEGIN');
SELECT dblink_exec('other', $$SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111'$$);
SELECT dblink_exec('other', $$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, booked_by)
  VALUES ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-0000000000a1', '2032-01-10 18:00+02', '2032-01-10 18:30+02', 'phone', 'c0000000-0000-0000-0000-0000000000a2')$$);

BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL lock_timeout = '500ms';
SELECT test.throws($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, booked_by)
  VALUES ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-0000000000a2',
  'f0000000-0000-0000-0000-0000000000a1', '2032-01-10 18:15+02', '2032-01-10 18:45+02', 'phone', 'c0000000-0000-0000-0000-0000000000a1')$$,
  'lock timeout', 'the second booking waits for the first (its overlap is not yet decided)');
SELECT dblink_exec('other', 'COMMIT');
SELECT test.throws($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, booked_by)
  VALUES ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-0000000000a2',
  'f0000000-0000-0000-0000-0000000000a1', '2032-01-10 18:15+02', '2032-01-10 18:45+02', 'phone', 'c0000000-0000-0000-0000-0000000000a1')$$,
  'appointments_no_doctor_overlap', 'once the first commits, the second is a double booking and is refused');
SELECT test.ok((SELECT count(*) = 1 FROM appointments WHERE doctor_id = 'f0000000-0000-0000-0000-0000000000a1'
  AND starts_at < '2032-01-10 18:45+02' AND ends_at > '2032-01-10 18:15+02' AND status <> 'cancelled'), 'Dr Ahmed has exactly one booking then');
COMMIT;

-- ---------------------------------------------------------------------------------------------------------------
-- Scenario 7: a website hold ran out without being released; two bookings race for the freed slot
-- ---------------------------------------------------------------------------------------------------------------
SET app.tenant_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO appointments (id, tenant_id, branch_id, doctor_id, starts_at, ends_at, status, hold_expires_at, source)
VALUES ('43a00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1',
        'f0000000-0000-0000-0000-0000000000a1', '2032-01-11 18:00+02', '2032-01-11 18:30+02', 'held', now() - interval '1 minute', 'website');
RESET app.tenant_id;

-- session 2 books it the way the API does: release the doctor's stale holds, then insert (transaction left open)
SELECT dblink_exec('other', 'BEGIN');
SELECT dblink_exec('other', $$SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111'$$);
SELECT * FROM dblink('other', $$SELECT release_expired_holds('f0000000-0000-0000-0000-0000000000a1')$$) AS t(released int);
SELECT dblink_exec('other', $$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, booked_by)
  VALUES ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-0000000000a1',
  'f0000000-0000-0000-0000-0000000000a1', '2032-01-11 18:00+02', '2032-01-11 18:30+02', 'phone', 'c0000000-0000-0000-0000-0000000000a2')$$);

BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL lock_timeout = '500ms';
SELECT test.throws($$SELECT release_expired_holds('f0000000-0000-0000-0000-0000000000a1')$$, 'lock timeout',
  'the second booking waits while the first is releasing the same stale hold');
SELECT dblink_exec('other', 'COMMIT');
SELECT test.ok(release_expired_holds('f0000000-0000-0000-0000-0000000000a1') = 0, 'then finds it already released');
SELECT test.throws($$INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, source, booked_by)
  VALUES ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-0000000000a2',
  'f0000000-0000-0000-0000-0000000000a1', '2032-01-11 18:00+02', '2032-01-11 18:30+02', 'phone', 'c0000000-0000-0000-0000-0000000000a1')$$,
  'appointments_no_doctor_overlap', 'and loses the slot to the first booking, not to the dead hold');
SELECT test.ok((SELECT status = 'expired' FROM appointments WHERE id = '43a00000-0000-0000-0000-000000000001'), 'the hold is expired');
SELECT test.ok((SELECT count(*) = 1 FROM appointments WHERE doctor_id = 'f0000000-0000-0000-0000-0000000000a1'
  AND starts_at = '2032-01-11 18:00+02' AND status = 'pending'), 'and the slot has exactly one booking');
COMMIT;

-- ---------------------------------------------------------------------------------------------------------------
-- FIN-02: one idempotency key, one payment, even when the twin request arrives while the first is still open
-- ---------------------------------------------------------------------------------------------------------------
SET app.tenant_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency)
VALUES ('43c00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1',
        '70000000-0000-0000-0000-0000000000a1', 'EGP');
INSERT INTO invoice_items (tenant_id, invoice_id, description, unit_price_minor, line_total_minor)
VALUES ('11111111-1111-1111-1111-111111111111', '43c00000-0000-0000-0000-000000000001', 'Crown', 50000, 50000);
UPDATE invoices SET status = 'issued', number = 'SMA-V4-43' WHERE id = '43c00000-0000-0000-0000-000000000001';
RESET app.tenant_id;

SELECT dblink_exec('other', 'BEGIN');
SELECT dblink_exec('other', $$SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111'$$);
SELECT * FROM dblink('other', $$SELECT id FROM invoices WHERE id = '43c00000-0000-0000-0000-000000000001' FOR UPDATE$$) AS t(id uuid); -- billing.service pay(): lock first
SELECT dblink_exec('other', $$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at, idempotency_key)
  VALUES ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-0000000000a1',
  '43c00000-0000-0000-0000-000000000001', 20000, 'EGP', 'cash', now(), 'v4-43-key')$$);

BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL lock_timeout = '500ms';
SELECT test.throws($$SELECT id FROM invoices WHERE id = '43c00000-0000-0000-0000-000000000001' FOR UPDATE$$, 'lock timeout',
  'the twin request waits on the invoice lock');
SELECT dblink_exec('other', 'COMMIT');
SELECT test.lives($Q$SELECT id FROM invoices WHERE id = '43c00000-0000-0000-0000-000000000001' FOR UPDATE$Q$, 'then gets the lock');
SELECT test.ok((SELECT count(*) = 1 FROM payments WHERE idempotency_key = 'v4-43-key'),
  'and, reading the key after the lock, finds the first payment (so the API answers with it)');
SELECT test.throws($$INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at, idempotency_key)
  VALUES ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-0000000000a1',
  '43c00000-0000-0000-0000-000000000001', 20000, 'EGP', 'cash', now(), 'v4-43-key')$$, 'idempotency_key',
  'and the database refuses a second payment with the key in any case');
SELECT test.ok((SELECT paid_minor = 20000 FROM invoices WHERE id = '43c00000-0000-0000-0000-000000000001'), 'the invoice shows one payment of 200.00');
COMMIT;

SELECT dblink_disconnect('other');
