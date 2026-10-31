-- Phase D4: visits (draft/final, amendments), plans, procedures, chart, prescriptions, follow-ups (SRS VISIT-*, CHART-001, TPLAN-*, AUDIT-002)
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL app.user_id = 'b0000000-0000-0000-0000-0000000000a3';   -- Dr. Mona
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000a3';

INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, starts_at, ends_at, status, source, booked_by, check_in_method, checked_in_at) VALUES
 ('a4000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
  '70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a2','2031-06-01 18:00+02','2031-06-01 18:30+02','checked_in','phone','c0000000-0000-0000-0000-0000000000a2','walk_in',now()),
 ('a4000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
  '70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a2','2031-06-08 18:00+02','2031-06-08 18:30+02','confirmed','phone','c0000000-0000-0000-0000-0000000000a2',NULL,NULL),
 ('a4000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
  '70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a2','2031-06-15 18:00+02','2031-06-15 18:30+02','confirmed','phone','c0000000-0000-0000-0000-0000000000a2',NULL,NULL),
 ('a4000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-0000000000a1',
  '70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a2','2031-06-22 18:00+02','2031-06-22 18:30+02','confirmed','phone','c0000000-0000-0000-0000-0000000000a2',NULL,NULL);

-- visits: opening starts the appointment; a new visit is a draft whatever is sent
INSERT INTO visits (id, tenant_id, appointment_id, patient_id, doctor_id, branch_id, chief_complaint, status, finalized_at)
VALUES ('b4000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','a4000000-0000-0000-0000-000000000001',
        '70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a2','d0000000-0000-0000-0000-0000000000a1','ألم في الضرس', 'final', now());
SELECT test.ok((SELECT status = 'draft' AND finalized_at IS NULL FROM visits WHERE id = 'b4000000-0000-0000-0000-000000000001'), 'a new visit is a draft');
SELECT test.ok((SELECT status = 'in_progress' FROM appointments WHERE id = 'a4000000-0000-0000-0000-000000000001'), 'opening the visit starts the appointment');
UPDATE visits SET clinical_notes = 'تسوس عميق في 36' WHERE id = 'b4000000-0000-0000-0000-000000000001';
SELECT test.throws($$INSERT INTO visit_amendments (tenant_id, visit_id, field, new_text, reason, author_id) VALUES
  ('11111111-1111-1111-1111-111111111111','b4000000-0000-0000-0000-000000000001','diagnosis','x','سهو في الكتابة','c0000000-0000-0000-0000-0000000000a3')$$,
  'only a final visit is amended', 'a draft is edited, not amended');

-- CLR-06: completing the appointment finalizes the note; a final note is never overwritten
UPDATE appointments SET status = 'completed', completed_at = now() WHERE id = 'a4000000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT status = 'final' AND finalized_at IS NOT NULL AND finalized_by = 'c0000000-0000-0000-0000-0000000000a3'
  FROM visits WHERE id = 'b4000000-0000-0000-0000-000000000001'), 'completing the appointment finalizes its visit, by the acting member');
SELECT test.throws($$UPDATE visits SET clinical_notes = 'غيرت رأيي' WHERE id = 'b4000000-0000-0000-0000-000000000001'$$, 'is final', 'a final note cannot be overwritten');
SELECT test.throws($$UPDATE visits SET status = 'draft' WHERE id = 'b4000000-0000-0000-0000-000000000001'$$, 'is final', 'a final visit cannot go back to draft');
SELECT test.throws($$DELETE FROM visits WHERE id = 'b4000000-0000-0000-0000-000000000001'$$, 'permission denied', 'visits are never deleted (no DELETE right since review R11)');
SELECT test.throws($$INSERT INTO visit_amendments (tenant_id, visit_id, field, new_text, reason, author_id) VALUES
  ('11111111-1111-1111-1111-111111111111','b4000000-0000-0000-0000-000000000001','diagnosis','x',' ','c0000000-0000-0000-0000-0000000000a3')$$,
  'visit_amendments_reason', 'an amendment needs a reason');
INSERT INTO visit_amendments (tenant_id, visit_id, field, new_text, reason, author_id) VALUES
  ('11111111-1111-1111-1111-111111111111','b4000000-0000-0000-0000-000000000001','diagnosis','التهاب لب الضرس 36','نتيجة الأشعة','c0000000-0000-0000-0000-0000000000a3');
SELECT test.ok((SELECT count(*) = 1 FROM visit_amendments WHERE visit_id = 'b4000000-0000-0000-0000-000000000001'), 'an amendment is added beside the original');
SELECT test.throws($$UPDATE visit_amendments SET new_text = 'y'$$, 'permission denied', 'amendments cannot be edited');
SELECT test.throws($$DELETE FROM visit_amendments$$, 'permission denied', 'amendments cannot be deleted');

-- AUDIT-002: the audit says what changed, never the clinical text
SELECT test.ok((SELECT bool_and(changes ->> 'clinical_notes' = 'true') AND bool_and(changes::text NOT LIKE '%تسوس%') FROM audit_log
  WHERE entity_type = 'visit' AND entity_id = 'b4000000-0000-0000-0000-000000000001' AND changes ? 'clinical_notes'),
  'the visit audit records that the notes changed, not the notes');
SELECT test.ok((SELECT count(*) = 1 FROM audit_log WHERE entity_type = 'visit_amendment' AND changes::text NOT LIKE '%الأشعة%'
  AND changes ->> 'new_text' = 'true'), 'the amendment is audited without its text');

-- treatment plans: draft -> proposed -> accepted; the estimate is derived; items fixed once accepted
SELECT test.throws($$INSERT INTO treatment_plans (tenant_id, patient_id, doctor_id, title, status) VALUES
  ('11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a2','x','accepted')$$,
  'starts as a draft', 'a plan starts as a draft');
INSERT INTO treatment_plans (id, tenant_id, patient_id, doctor_id, title) VALUES
  ('c4000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a2','حشو وتنظيف');
INSERT INTO treatment_plan_items (id, tenant_id, plan_id, service_id, tooth_code, surfaces, price_minor) VALUES
  ('d4000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','c4000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-0000000000a3', 36, '{O,D}', 100000),
  ('d4000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','c4000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-0000000000a2', NULL, '{}', 60000);
SELECT test.throws($$INSERT INTO treatment_plan_items (tenant_id, plan_id, service_id, tooth_code, price_minor) VALUES
  ('11111111-1111-1111-1111-111111111111','c4000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-0000000000a3', 19, 100000)$$,
  'treatment_plan_items_tooth', 'a plan item names an FDI tooth');
SELECT test.throws($$UPDATE treatment_plans SET status = 'accepted', accepted_at = now() WHERE id = 'c4000000-0000-0000-0000-000000000001'$$,
  'cannot become', 'a draft is proposed before it is accepted');
UPDATE treatment_plans SET status = 'proposed' WHERE id = 'c4000000-0000-0000-0000-000000000001';
SELECT test.throws($$UPDATE treatment_plans SET status = 'accepted' WHERE id = 'c4000000-0000-0000-0000-000000000001'$$,
  'treatment_plans_accepted_recorded', 'acceptance records when');
UPDATE treatment_plans SET status = 'accepted', accepted_at = now(), accepted_by = 'c0000000-0000-0000-0000-0000000000a3' WHERE id = 'c4000000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT status = 'accepted' AND total_estimate_minor = 160000 FROM treatment_plans WHERE id = 'c4000000-0000-0000-0000-000000000001'),
  'accepted, with the derived estimate');
SELECT test.throws($$INSERT INTO treatment_plan_items (tenant_id, plan_id, service_id, price_minor) VALUES
  ('11111111-1111-1111-1111-111111111111','c4000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-0000000000a2', 60000)$$,
  'not added or removed', 'no item is added to an accepted plan');
SELECT test.throws($$UPDATE treatment_plan_items SET price_minor = 90000 WHERE id = 'd4000000-0000-0000-0000-000000000001'$$,
  'are fixed', 'the price of an accepted item is fixed');
SELECT test.throws($$DELETE FROM treatment_plan_items WHERE id = 'd4000000-0000-0000-0000-000000000002'$$,
  'not added or removed', 'an accepted item is cancelled, never deleted');
SELECT test.throws($$UPDATE treatment_plan_items SET status = 'done' WHERE id = 'd4000000-0000-0000-0000-000000000001'$$,
  'procedure records it', 'an item is done only through a procedure');
SELECT test.throws($$UPDATE treatment_plans SET accepted_at = now() - interval '1 day' WHERE id = 'c4000000-0000-0000-0000-000000000001'$$,
  'not changed', 'the acceptance is not rewritten');

-- procedures (walk-in visit): CLR-16 price range; the plan item and the plan follow
INSERT INTO visits (id, tenant_id, patient_id, doctor_id, branch_id)
VALUES ('b4000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a1',
        'f0000000-0000-0000-0000-0000000000a2','d0000000-0000-0000-0000-0000000000a1');
SELECT test.throws($$INSERT INTO visit_procedures (tenant_id, visit_id, service_id, doctor_id, price_minor) VALUES
  ('11111111-1111-1111-1111-111111111111','b4000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-0000000000a3','f0000000-0000-0000-0000-0000000000a2', 50000)$$,
  'outside the service price range', 'a procedure is priced within the service range (a lower price is a discount)');
INSERT INTO visit_procedures (id, tenant_id, visit_id, service_id, doctor_id, plan_item_id, tooth_code, surfaces, price_minor) VALUES
  ('e4000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','b4000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-0000000000a3',
   'f0000000-0000-0000-0000-0000000000a2','d4000000-0000-0000-0000-000000000001', 36, '{O,D}', 120000);
SELECT test.ok((SELECT i.status = 'done' AND p.status = 'in_progress' FROM treatment_plan_items i JOIN treatment_plans p ON p.id = i.plan_id
  WHERE i.id = 'd4000000-0000-0000-0000-000000000001'), 'the procedure marks the item done and starts the plan');
SELECT test.throws($$INSERT INTO visit_procedures (tenant_id, visit_id, service_id, doctor_id, plan_item_id, price_minor) VALUES
  ('11111111-1111-1111-1111-111111111111','b4000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-0000000000a3',
   'f0000000-0000-0000-0000-0000000000a2','d4000000-0000-0000-0000-000000000001', 100000)$$, 'the plan item is done', 'a done item is not performed twice');
UPDATE treatment_plan_items SET status = 'cancelled' WHERE id = 'd4000000-0000-0000-0000-000000000002';
SELECT test.ok((SELECT status = 'completed' AND total_estimate_minor = 100000 FROM treatment_plans WHERE id = 'c4000000-0000-0000-0000-000000000001'),
  'every item done or cancelled completes the plan; cancelled items leave the estimate');
SELECT test.throws($$UPDATE treatment_plan_items SET status = 'planned' WHERE id = 'd4000000-0000-0000-0000-000000000002'$$,
  'stays cancelled', 'a cancelled item stays visible as cancelled');
DELETE FROM visit_procedures WHERE id = 'e4000000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT i.status = 'planned' AND p.status = 'accepted' FROM treatment_plan_items i JOIN treatment_plans p ON p.id = i.plan_id
  WHERE i.id = 'd4000000-0000-0000-0000-000000000001'), 'removing the procedure from a draft visit reopens the item and the plan');
INSERT INTO visit_procedures (id, tenant_id, visit_id, service_id, doctor_id, price_minor) VALUES
  ('e4000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','b4000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-0000000000a2',
   'f0000000-0000-0000-0000-0000000000a2', 60000);
UPDATE visits SET status = 'final' WHERE id = 'b4000000-0000-0000-0000-000000000002';
SELECT test.throws($$DELETE FROM visit_procedures WHERE id = 'e4000000-0000-0000-0000-000000000002'$$, 'the visit is final', 'a final visit keeps its procedures');
UPDATE treatment_plans SET status = 'cancelled' WHERE id = 'c4000000-0000-0000-0000-000000000001';
SELECT test.throws($$UPDATE treatment_plans SET title = 'x' WHERE id = 'c4000000-0000-0000-0000-000000000001'$$, 'is closed', 'a cancelled plan is closed');
SELECT test.throws($$UPDATE treatment_plans SET status = 'accepted' WHERE id = 'c4000000-0000-0000-0000-000000000001'$$, 'cannot become', 'cancelled is final');

-- chart: append-only, entries of a visit belong to its patient
SELECT test.throws($$INSERT INTO tooth_records (tenant_id, patient_id, visit_id, tooth_code, condition) VALUES
  ('11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a2','b4000000-0000-0000-0000-000000000002', 36, 'caries')$$,
  'another patient', 'a chart entry of a visit is for that visit''s patient');
INSERT INTO tooth_records (tenant_id, patient_id, visit_id, tooth_code, surfaces, condition, recorded_by) VALUES
  ('11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a1','b4000000-0000-0000-0000-000000000002', 36, '{O,D}', 'caries', 'c0000000-0000-0000-0000-0000000000a3');
SELECT test.throws($$UPDATE tooth_records SET condition = 'filled'$$, 'permission denied', 'a chart entry is corrected by a new entry, never edited');

-- prescriptions: issued, never edited; a correction replaces one, once
SELECT test.throws($$INSERT INTO prescriptions (tenant_id, visit_id, patient_id, doctor_id) VALUES
  ('11111111-1111-1111-1111-111111111111','b4000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a1')$$,
  'must match its visit', 'the prescription doctor is the visit doctor');
INSERT INTO prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, issued_by) VALUES
  ('f4000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','b4000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-0000000000a1',
   'f0000000-0000-0000-0000-0000000000a2','c0000000-0000-0000-0000-0000000000a3');
INSERT INTO prescription_items (tenant_id, prescription_id, drug_name, dose, frequency, duration) VALUES
  ('11111111-1111-1111-1111-111111111111','f4000000-0000-0000-0000-000000000001','Amoxicillin 500mg','كبسولة','كل 8 ساعات','5 أيام');
SELECT test.throws($$UPDATE prescriptions SET notes = 'x'$$, 'permission denied', 'an issued prescription is not edited');
SELECT test.throws($$DELETE FROM prescription_items$$, 'permission denied', 'its lines are not removed');
INSERT INTO prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, replaces_id) VALUES
  ('f4000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','b4000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-0000000000a1',
   'f0000000-0000-0000-0000-0000000000a2','f4000000-0000-0000-0000-000000000001');
SELECT test.throws($$INSERT INTO prescriptions (tenant_id, visit_id, patient_id, doctor_id, replaces_id) VALUES
  ('11111111-1111-1111-1111-111111111111','b4000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-0000000000a1',
   'f0000000-0000-0000-0000-0000000000a2','f4000000-0000-0000-0000-000000000001')$$, 'prescriptions_replaced_once', 'a prescription is replaced once');
SELECT test.ok((SELECT count(*) = 1 FROM audit_log WHERE entity_type = 'prescription_item' AND changes ->> 'drug_name' = 'true'),
  'the drug is audited as written, not by name');

-- follow-ups and plan items follow their appointment (VISIT-005, APPT-007)
INSERT INTO recalls (id, tenant_id, patient_id, doctor_id, reason, due_date, status, appointment_id, created_by) VALUES
  ('a5000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a2',
   'checkup', '2031-06-08', 'booked', 'a4000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a3'),
  ('a5000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a2',
   'cleaning', '2031-06-15', 'booked', 'a4000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000a3');
UPDATE appointments SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'clinic' WHERE id = 'a4000000-0000-0000-0000-000000000002';
SELECT test.ok((SELECT status = 'pending' AND appointment_id IS NULL FROM recalls WHERE id = 'a5000000-0000-0000-0000-000000000001'),
  'a cancelled booking puts the follow-up back on the list');
UPDATE appointments SET status = 'checked_in', checked_in_at = now(), check_in_method = 'walk_in' WHERE id = 'a4000000-0000-0000-0000-000000000003';
UPDATE appointments SET status = 'completed', completed_at = now() WHERE id = 'a4000000-0000-0000-0000-000000000003';
SELECT test.ok((SELECT status = 'done' FROM recalls WHERE id = 'a5000000-0000-0000-0000-000000000002'), 'a completed booking closes its follow-up');
INSERT INTO treatment_plans (id, tenant_id, patient_id, doctor_id, title) VALUES
  ('c4000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a2','تقويم');
INSERT INTO treatment_plan_items (id, tenant_id, plan_id, service_id, price_minor, status, appointment_id) VALUES
  ('d4000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','c4000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-0000000000a2', 60000,
   'scheduled', 'a4000000-0000-0000-0000-000000000004');
UPDATE appointments SET status = 'no_show' WHERE id = 'a4000000-0000-0000-0000-000000000004';
SELECT test.ok((SELECT status = 'planned' AND appointment_id IS NULL FROM treatment_plan_items WHERE id = 'd4000000-0000-0000-0000-000000000003'),
  'a missed booking puts the plan item back to planned');

-- another clinic sees none of it
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SET LOCAL app.member_id = 'c0000000-0000-0000-0000-0000000000b1';
SELECT test.ok((SELECT count(*) FROM visits) + (SELECT count(*) FROM visit_amendments) + (SELECT count(*) FROM treatment_plans)
  + (SELECT count(*) FROM prescriptions) + (SELECT count(*) FROM recalls) = 0, 'another clinic sees no clinical rows');
ROLLBACK;
