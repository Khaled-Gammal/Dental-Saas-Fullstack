-- Phase D3: Arabic-normalised names, medical history versions, clinical documents (SRS PATIENT-001/004/005, L10N-007)
\set ON_ERROR_STOP 1
BEGIN;
-- the normaliser: spelling variants are one key
SELECT test.ok(ar_normalize('أحمد') = ar_normalize('احمد') AND ar_normalize('إسلام') = 'اسلام' AND ar_normalize('آمال') = 'امال',
  'alef forms are one letter');
SELECT test.ok(ar_normalize('فاطمة') = ar_normalize('فاطمه') AND ar_normalize('مصطفى') = ar_normalize('مصطفي'), 'ta marbuta and alef maqsura');
SELECT test.ok(ar_normalize('مُحَمَّد') = 'محمد' AND ar_normalize('محـــمد') = 'محمد', 'diacritics and tatweel are ignored');
SELECT test.ok(ar_normalize('  Omar   KHALED ') = 'omar khaled' AND ar_normalize(NULL) = '', 'Latin is lower-cased, spaces collapsed');
SELECT test.ok(ar_normalize('مسؤول') = 'مسوول' AND ar_normalize('هيئة') = 'هييه', 'hamza on waw and ya');

SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO patients (id, tenant_id, file_no, full_name, phone)
VALUES ('7d000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111', 901, 'أحمد مُحمّد فاطمة', '+201055500001');
SELECT test.ok((SELECT full_name_norm = 'احمد محمد فاطمه' FROM patients WHERE id = '7d000000-0000-0000-0000-000000000001'),
  'the stored search key follows the name');
UPDATE patients SET full_name = 'إيمان مصطفى' WHERE id = '7d000000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT full_name_norm = 'ايمان مصطفي' FROM patients WHERE id = '7d000000-0000-0000-0000-000000000001'), 'and is updated with it');
SELECT test.ok((SELECT count(*) = 1 FROM patients WHERE full_name_norm ILIKE '%' || ar_normalize('ايمان مصطفي') || '%'), 'typed without hamza, the name is found');
SELECT test.throws($$UPDATE patients SET full_name_norm = 'x'$$, 'can only be updated to DEFAULT', 'the search key cannot be written directly');

-- medical history versions
INSERT INTO patient_medical_history (tenant_id, patient_id, allergies, updated_by)
VALUES ('11111111-1111-1111-1111-111111111111','7d000000-0000-0000-0000-000000000001','{penicillin}','c0000000-0000-0000-0000-0000000000a3');
UPDATE patient_medical_history SET allergies = '{penicillin,latex}', updated_at = now() WHERE patient_id = '7d000000-0000-0000-0000-000000000001';
UPDATE patient_medical_history SET updated_at = now() WHERE patient_id = '7d000000-0000-0000-0000-000000000001';
SELECT test.ok((SELECT array_agg(array_to_string(allergies, ',') ORDER BY id) = ARRAY['penicillin', 'penicillin,latex']
  FROM patient_medical_history_versions WHERE patient_id = '7d000000-0000-0000-0000-000000000001'),
  'each change is a version; a save that changed nothing is not');
SELECT test.ok((SELECT saved_by = 'c0000000-0000-0000-0000-0000000000a3' FROM patient_medical_history_versions
  WHERE patient_id = '7d000000-0000-0000-0000-000000000001' ORDER BY id LIMIT 1), 'a version records who saved it');
SELECT test.throws($$UPDATE patient_medical_history_versions SET allergies = '{}'$$, 'permission denied', 'versions cannot be edited');
SELECT test.throws($$DELETE FROM patient_medical_history_versions$$, 'permission denied', 'versions cannot be deleted');
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SELECT test.ok((SELECT count(*) = 0 FROM patient_medical_history_versions), 'another clinic sees no versions');
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';

-- clinical documents are private and archived, never half-archived
SELECT test.throws($$INSERT INTO files (tenant_id, bucket, object_key, mime_type, size_bytes, kind, is_private)
  VALUES ('11111111-1111-1111-1111-111111111111','local','t/x/doc-1','application/pdf', 10, 'document', false)$$,
  'files_clinical_private', 'a clinical document can never be public');
INSERT INTO files (id, tenant_id, bucket, object_key, mime_type, size_bytes, kind, is_private)
VALUES ('fd000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','local','t/x/xray-1','image/jpeg', 10, 'xray', true);
INSERT INTO patient_files (tenant_id, patient_id, file_id, caption)
VALUES ('11111111-1111-1111-1111-111111111111','7d000000-0000-0000-0000-000000000001','fd000000-0000-0000-0000-000000000001','أشعة بانوراما');
SELECT test.throws($$UPDATE patient_files SET archived_at = now() WHERE file_id = 'fd000000-0000-0000-0000-000000000001'$$,
  'patient_files_archive_complete', 'archiving needs a reason');
SELECT test.lives($$UPDATE patient_files SET archived_at = now(), archive_reason = 'رُفعت بالخطأ', archived_by = 'c0000000-0000-0000-0000-0000000000a3'
  WHERE file_id = 'fd000000-0000-0000-0000-000000000001'$$, 'archived with a reason');
ROLLBACK;
