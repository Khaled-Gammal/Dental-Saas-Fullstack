-- Placeholder legal documents for local development and tests (H6) — NEVER for production. The real Terms of
-- Service, Privacy Policy and Data Processing Agreement come from the owner (or their lawyer) and are published from
-- the platform panel (#/platform → المستندات القانونية).
-- Safe to run again: a kind that already has a version gets nothing, and acceptances are recorded once.
-- Existing members are recorded as having accepted version 1, so the demo accounts are not stopped at sign-in; publish
-- a new version with "must accept again" in the panel to see the accept screen.
INSERT INTO legal_documents (kind, version, title_ar, body_ar)
SELECT k.kind, 1, k.title, k.title || E'\n\n' ||
  'نص مؤقت للتطوير فقط — ليس نصًا قانونيًا. يُستبدل بالنص المعتمد من صاحب المنصة أو محاميه قبل الإطلاق، وينشر من لوحة إدارة المنصة.' || E'\n\n' ||
  'هذا المستند يحدد علاقة العيادة بالمنصة. سيوضع هنا النص الكامل المعتمد بأقسامه وتاريخ سريانه.'
FROM (VALUES ('terms', 'شروط الاستخدام'), ('privacy', 'سياسة الخصوصية'), ('dpa', 'اتفاقية معالجة البيانات')) AS k(kind, title)
WHERE NOT EXISTS (SELECT 1 FROM legal_documents d WHERE d.kind = k.kind);

-- every active member accepted Terms and Privacy; every owner the DPA for their clinic
INSERT INTO legal_acceptances (user_id, document_id, tenant_id)
SELECT DISTINCT m.user_id, d.id, NULL::uuid
FROM tenant_members m JOIN legal_documents d ON d.kind IN ('terms', 'privacy') AND d.version = 1
WHERE m.status = 'active'
ON CONFLICT ON CONSTRAINT legal_acceptances_once DO NOTHING;
INSERT INTO legal_acceptances (user_id, document_id, tenant_id)
SELECT m.user_id, d.id, m.tenant_id
FROM tenant_members m JOIN roles r ON r.id = m.role_id AND r.key = 'owner' JOIN legal_documents d ON d.kind = 'dpa' AND d.version = 1
WHERE m.status = 'active'
ON CONFLICT ON CONSTRAINT legal_acceptances_once DO NOTHING;
