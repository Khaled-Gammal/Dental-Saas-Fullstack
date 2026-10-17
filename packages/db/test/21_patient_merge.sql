-- Phase D5: merging duplicate patients (SRS PATIENT-003, CLR-15)
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-0000000000a2';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a2';

-- the same person registered twice (survivor 1, duplicate 2) and a child whose guardian is the duplicate
INSERT INTO patients (id, tenant_id, file_no, full_name, phone) VALUES
 ('7e000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111', 951, 'هالة سمير', '+201077700001'),
 ('7e000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111', 952, 'هاله سمير', '+201077700001');
INSERT INTO patients (id, tenant_id, file_no, full_name, phone, guardian_patient_id) VALUES
 ('7e000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111', 953, 'ياسين', '+201077700001', '7e000000-0000-0000-0000-000000000002');
INSERT INTO patient_medical_history (tenant_id, patient_id, allergies, conditions, medications, is_smoker, updated_by) VALUES
 ('11111111-1111-1111-1111-111111111111','7e000000-0000-0000-0000-000000000001','{Penicillin}','{}','{}', false, 'c0000000-0000-0000-0000-0000000000a2'),
 ('11111111-1111-1111-1111-111111111111','7e000000-0000-0000-0000-000000000002','{penicillin,Latex}','{سكري}','{Metformin}', true, 'c0000000-0000-0000-0000-0000000000a2');

-- the duplicate's records, including the locked kinds: a final visit, an issued and paid invoice, an accepted plan,
-- an issued prescription and an append-only chart entry
INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, status, source, booked_by, check_in_method, checked_in_at) VALUES
 ('a7000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','7e000000-0000-0000-0000-000000000002',
  'f0000000-0000-0000-0000-0000000000a2','2031-07-05 18:00+02','2031-07-05 18:30+02','checked_in','phone','c0000000-0000-0000-0000-0000000000a2','walk_in',now());
INSERT INTO visits (id, tenant_id, appointment_id, patient_id, doctor_id, branch_id, diagnosis) VALUES
 ('b7000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','a7000000-0000-0000-0000-000000000001','7e000000-0000-0000-0000-000000000002',
  'f0000000-0000-0000-0000-0000000000a2','d0000000-0000-0000-0000-0000000000a1','تسوس');
UPDATE appointments SET status = 'completed', completed_at = now() WHERE id = 'a7000000-0000-0000-0000-000000000001'; -- the visit is now final
INSERT INTO tooth_records (tenant_id, patient_id, visit_id, tooth_code, condition) VALUES
 ('11111111-1111-1111-1111-111111111111','7e000000-0000-0000-0000-000000000002','b7000000-0000-0000-0000-000000000001', 36, 'caries');
INSERT INTO prescriptions (id, tenant_id, visit_id, patient_id, doctor_id) VALUES
 ('f7000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','b7000000-0000-0000-0000-000000000001','7e000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-0000000000a2');
INSERT INTO treatment_plans (id, tenant_id, patient_id, doctor_id, title) VALUES
 ('c7000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','7e000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-0000000000a2','حشو');
INSERT INTO treatment_plan_items (tenant_id, plan_id, service_id, price_minor) VALUES
 ('11111111-1111-1111-1111-111111111111','c7000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-0000000000a2', 60000);
UPDATE treatment_plans SET status = 'proposed' WHERE id = 'c7000000-0000-0000-0000-000000000001';
UPDATE treatment_plans SET status = 'accepted', accepted_at = now(), accepted_by = 'c0000000-0000-0000-0000-0000000000a3' WHERE id = 'c7000000-0000-0000-0000-000000000001';
INSERT INTO invoices (id, tenant_id, branch_id, patient_id, currency) VALUES
 ('17000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','7e000000-0000-0000-0000-000000000002','EGP'),
 ('17000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','7e000000-0000-0000-0000-000000000001','EGP');
INSERT INTO invoice_items (tenant_id, invoice_id, description, unit_price_minor, line_total_minor) VALUES
 ('11111111-1111-1111-1111-111111111111','17000000-0000-0000-0000-000000000001','Filling', 100000, 100000),
 ('11111111-1111-1111-1111-111111111111','17000000-0000-0000-0000-000000000002','Scaling', 60000, 60000);
UPDATE invoices SET status = 'issued', number = 'MRG-1' WHERE id = '17000000-0000-0000-0000-000000000001';
UPDATE invoices SET status = 'issued', number = 'MRG-2' WHERE id = '17000000-0000-0000-0000-000000000002';
INSERT INTO payments (id, tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at) VALUES
 ('27000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1','7e000000-0000-0000-0000-000000000002',
  '17000000-0000-0000-0000-000000000001', 40000, 'EGP', 'cash', now());
INSERT INTO recalls (tenant_id, patient_id, reason, due_date) VALUES
 ('11111111-1111-1111-1111-111111111111','7e000000-0000-0000-0000-000000000002','checkup', '2031-12-01');

-- what it would move, and the refusals
SELECT test.ok((SELECT (patient_merge_counts('7e000000-0000-0000-0000-000000000002') ->> 'payments')::int = 1
  AND (patient_merge_counts('7e000000-0000-0000-0000-000000000002') ->> 'visits')::int = 1), 'the preview counts what would move');
SELECT test.throws($$SELECT merge_patients('7e000000-0000-0000-0000-000000000001','7e000000-0000-0000-0000-000000000001')$$, 'into itself', 'a record is not merged into itself');
SELECT test.throws($$UPDATE visits SET patient_id = '7e000000-0000-0000-0000-000000000001' WHERE id = 'b7000000-0000-0000-0000-000000000001'$$,
  'is final', 'outside a merge, a final visit cannot change patient');
SET LOCAL app.patient_merge = 'on';
SELECT test.throws($$UPDATE payments SET patient_id = '7e000000-0000-0000-0000-000000000001' WHERE id = '27000000-0000-0000-0000-000000000001'$$,
  'cannot be changed', 'the merge setting alone does not let the API role move a payment');
SET LOCAL app.patient_merge = '';

-- balances before: 1000 - 400 (duplicate) + 600 (survivor) = 1200 owed
SELECT test.ok((SELECT sum(total_minor - paid_minor) = 120000 FROM invoices WHERE patient_id IN ('7e000000-0000-0000-0000-000000000001','7e000000-0000-0000-0000-000000000002')),
  'balances before the merge');
SELECT merge_patients('7e000000-0000-0000-0000-000000000001','7e000000-0000-0000-0000-000000000002');

SELECT test.ok((SELECT sum(total_minor - paid_minor) = 120000 FROM invoices WHERE patient_id = '7e000000-0000-0000-0000-000000000001'),
  'the survivor''s balance is the sum of both (acceptance 1)');
SELECT test.ok((SELECT (SELECT count(*) FROM appointments WHERE patient_id = '7e000000-0000-0000-0000-000000000002')
  + (SELECT count(*) FROM visits WHERE patient_id = '7e000000-0000-0000-0000-000000000002')
  + (SELECT count(*) FROM invoices WHERE patient_id = '7e000000-0000-0000-0000-000000000002')
  + (SELECT count(*) FROM payments WHERE patient_id = '7e000000-0000-0000-0000-000000000002')
  + (SELECT count(*) FROM treatment_plans WHERE patient_id = '7e000000-0000-0000-0000-000000000002')
  + (SELECT count(*) FROM prescriptions WHERE patient_id = '7e000000-0000-0000-0000-000000000002')
  + (SELECT count(*) FROM tooth_records WHERE patient_id = '7e000000-0000-0000-0000-000000000002')
  + (SELECT count(*) FROM recalls WHERE patient_id = '7e000000-0000-0000-0000-000000000002')
  + (SELECT count(*) FROM patient_medical_history WHERE patient_id = '7e000000-0000-0000-0000-000000000002')
  + (SELECT count(*) FROM patient_medical_history_versions WHERE patient_id = '7e000000-0000-0000-0000-000000000002')
  + (SELECT count(*) FROM patients WHERE guardian_patient_id = '7e000000-0000-0000-0000-000000000002') = 0),
  'no row points at the merged record any more (acceptance 2)');
SELECT test.ok((SELECT merged_into_id = '7e000000-0000-0000-0000-000000000001' FROM patients WHERE id = '7e000000-0000-0000-0000-000000000002'),
  'the duplicate points at the survivor');
SELECT test.ok((SELECT allergies = '{Penicillin,Latex}' AND conditions = '{سكري}' AND medications = '{Metformin}' AND is_smoker = false
  FROM patient_medical_history WHERE patient_id = '7e000000-0000-0000-0000-000000000001'),
  'allergies, conditions and medications are combined (no allergy lost, no repeat); the survivor''s flags are kept (CLR-15)');
SELECT test.ok((SELECT count(*) >= 3 FROM patient_medical_history_versions WHERE patient_id = '7e000000-0000-0000-0000-000000000001'),
  'both histories'' versions are kept on the survivor, plus the combined one');
SELECT test.ok((SELECT status = 'final' AND diagnosis = 'تسوس' FROM visits WHERE id = 'b7000000-0000-0000-0000-000000000001'),
  'the moved visit is still final and unchanged');
SELECT test.ok((SELECT status = 'accepted' FROM treatment_plans WHERE id = 'c7000000-0000-0000-0000-000000000001'), 'the moved plan keeps its acceptance');
SELECT test.ok((SELECT amount_minor = 40000 AND status = 'succeeded' FROM payments WHERE id = '27000000-0000-0000-0000-000000000001'), 'the moved payment is unchanged');
SELECT test.ok((SELECT guardian_patient_id = '7e000000-0000-0000-0000-000000000001' FROM patients WHERE id = '7e000000-0000-0000-0000-000000000003'),
  'the child''s guardian is now the survivor');
SELECT test.ok((SELECT count(*) = 1 FROM audit_log WHERE entity_type = 'payment' AND entity_id = '27000000-0000-0000-0000-000000000001'
  AND action = 'payment.update' AND changes ? 'patient_id'), 'each moved money row is audited');
SELECT test.throws($$SELECT merge_patients('7e000000-0000-0000-0000-000000000001','7e000000-0000-0000-0000-000000000002')$$, 'already merged', 'a merged record is not merged again');
SELECT test.throws($$UPDATE payments SET patient_id = '7e000000-0000-0000-0000-000000000002' WHERE id = '27000000-0000-0000-0000-000000000001'$$,
  'cannot be changed', 'after the merge the payment is locked again');

-- another clinic cannot merge or count this clinic's patients
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SELECT test.throws($$SELECT merge_patients('70000000-0000-0000-0000-0000000000b1','7e000000-0000-0000-0000-000000000003')$$, 'not found', 'another clinic''s patient cannot be merged in');
SELECT test.throws($$SELECT patient_merge_counts('7e000000-0000-0000-0000-000000000003')$$, 'not found', 'nor counted');
ROLLBACK;
