-- Phase C: the database writes the audit trail for money and appointments (SRS AUDIT-001, AUDIT-003)
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-0000000000a2';   -- the receptionist
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a2';

INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency)
VALUES ('1d000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
        '70000000-0000-0000-0000-0000000000a1','EGP');
INSERT INTO invoice_items (tenant_id, invoice_id, description, unit_price_minor, line_total_minor)
VALUES ('11111111-1111-1111-1111-111111111111','1d000000-0000-0000-0000-000000000001','Scaling', 60000, 60000);
UPDATE invoices SET status = 'issued', number = 'SMA-D-1' WHERE id = '1d000000-0000-0000-0000-000000000001';
INSERT INTO payments (id, tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at, received_by, notes)
VALUES ('2d000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
        '70000000-0000-0000-0000-0000000000a1','1d000000-0000-0000-0000-000000000001', 60000, 'EGP', 'card', now(),
        'c0000000-0000-0000-0000-0000000000a2', 'private note');

SELECT test.ok((SELECT count(*) = 1 FROM audit_log WHERE entity_id = '2d000000-0000-0000-0000-000000000001' AND action = 'payment.create'
  AND actor_type = 'member' AND actor_user_id = 'b0000000-0000-0000-0000-0000000000a2'
  AND changes -> 'amount_minor' = '[null, 60000]'::jsonb AND changes -> 'method' = '[null, "card"]'::jsonb),
  'recording a payment writes one audit row with the actor, amount and method');
SELECT test.ok((SELECT changes -> 'notes' = 'true'::jsonb FROM audit_log WHERE entity_id = '2d000000-0000-0000-0000-000000000001' AND action = 'payment.create'),
  'payment notes are recorded as present, never their text');
SELECT test.ok((SELECT count(*) >= 1 FROM audit_log WHERE entity_id = '1d000000-0000-0000-0000-000000000001' AND action = 'invoice.update'
  AND changes -> 'status' = '["issued", "paid"]'::jsonb),
  'the invoice status change caused by the payment is audited');

INSERT INTO refunds (tenant_id, payment_id, amount_minor, reason, created_by)
VALUES ('11111111-1111-1111-1111-111111111111','2d000000-0000-0000-0000-000000000001', 5000, 'goodwill', 'c0000000-0000-0000-0000-0000000000a2');
SELECT test.ok((SELECT count(*) = 1 FROM audit_log WHERE entity_type = 'refund' AND action = 'refund.create'
  AND changes -> 'amount_minor' = '[null, 5000]'::jsonb), 'a refund is audited');
SELECT test.ok((SELECT count(*) = 1 FROM audit_log WHERE entity_id = '2d000000-0000-0000-0000-000000000001' AND action = 'payment.update'
  AND changes -> 'refunded_minor' = '[0, 5000]'::jsonb), 'the payment''s refunded amount change is audited');

-- an update that changes nothing writes nothing
SELECT count(*) AS before FROM audit_log \gset
UPDATE invoices SET updated_at = now() WHERE id = '1d000000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT count(*) FROM audit_log) = :before, 'a no-op update writes no audit row');

-- appointments: website holds are not business events until they become bookings
INSERT INTO appointments (id, tenant_id, branch_id, doctor_id, starts_at, ends_at, source, status, hold_expires_at)
VALUES ('ad000000-0000-0000-0000-0000000000d1','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
        'f0000000-0000-0000-0000-0000000000a1','2031-03-01 18:00+02','2031-03-01 18:30+02','website','held', now() + interval '10 minutes'),
       ('ad000000-0000-0000-0000-0000000000d2','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
        'f0000000-0000-0000-0000-0000000000a1','2031-03-01 19:00+02','2031-03-01 19:30+02','website','held', now() + interval '10 minutes');
UPDATE appointments SET status = 'expired' WHERE id = 'ad000000-0000-0000-0000-0000000000d2';
SELECT test.ok(NOT EXISTS (SELECT 1 FROM audit_log WHERE entity_id IN ('ad000000-0000-0000-0000-0000000000d1','ad000000-0000-0000-0000-0000000000d2')),
  'a hold and a released hold are not audited');
SET LOCAL app.user_id = '';
SET LOCAL app.actor_type = 'patient';
UPDATE appointments SET status = 'pending', patient_id = '70000000-0000-0000-0000-0000000000a1', patient_notes = 'tooth pain'
WHERE id = 'ad000000-0000-0000-0000-0000000000d1';
SELECT test.ok((SELECT count(*) = 1 FROM audit_log WHERE entity_id = 'ad000000-0000-0000-0000-0000000000d1' AND actor_type = 'patient'
  AND actor_user_id IS NULL AND changes -> 'status' = '["held", "pending"]'::jsonb AND changes -> 'patient_notes' = 'true'::jsonb),
  'a website booking is audited as the patient''s act, without the patient''s note text');

SET LOCAL app.actor_type = '';
UPDATE appointments SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'system' WHERE id = 'ad000000-0000-0000-0000-0000000000d1';
SELECT test.ok((SELECT count(*) = 1 FROM audit_log WHERE entity_id = 'ad000000-0000-0000-0000-0000000000d1' AND actor_type = 'system'
  AND changes -> 'status' = '["pending", "cancelled"]'::jsonb), 'a change with no signed-in member is audited as the system');

SELECT test.throws($$UPDATE audit_log SET action = 'x'$$, 'permission denied', 'the audit trail cannot be edited');
SELECT test.throws($$DELETE FROM audit_log$$, 'permission denied', 'the audit trail cannot be deleted');
ROLLBACK;
