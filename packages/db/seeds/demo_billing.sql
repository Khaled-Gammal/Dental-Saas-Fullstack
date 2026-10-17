-- Demo invoices and payments for clinic A, to look at the billing screens (dev only, never run in production).
-- Run: pnpm --filter @dental/db seed:demo-billing   (safe to run twice: it does nothing if the demo data exists)
--
-- What it creates (branch Nasr City, receptionist Sara as the receiver unless said otherwise):
--   Omar Khaled  — a final visit by Dr. Mona with three procedures; invoice from two of them, partly paid
--                  (cash + InstaPay); the consultation is left unbilled; and a draft invoice (X-ray)
--   Nour Ali     — invoice paid in full (card + bank transfer); another invoice issued by mistake and voided
--   منى عبد الله  — a cash payment entered by mistake and reversed, then paid by e-wallet
--   كريم حسن     — paid by card, then 200 EGP refunded in cash (part of the treatment was not done)
-- Visits and recorded payments can never be deleted (by design); reset the dev database to remove them.
DO $demo$
DECLARE
  t   constant uuid := '11111111-1111-1111-1111-111111111111';
  nasr constant uuid := 'd0000000-0000-0000-0000-0000000000a1';
  mona constant uuid := 'f0000000-0000-0000-0000-0000000000a2';
  sara constant uuid := 'c0000000-0000-0000-0000-0000000000a2';   -- receptionist
  owner constant uuid := 'c0000000-0000-0000-0000-0000000000a1';
  doc  constant uuid := 'c0000000-0000-0000-0000-0000000000a3';   -- Dr. Mona's login
  omar constant uuid := '70000000-0000-0000-0000-0000000000a1';
  nour constant uuid := '70000000-0000-0000-0000-0000000000a2';
  mona_p constant uuid := '7f000000-0000-0000-0000-000000000001';
  karim  constant uuid := '7f000000-0000-0000-0000-000000000002';
  consult constant uuid := '90000000-0000-0000-0000-0000000000a1';
  scaling constant uuid := '90000000-0000-0000-0000-0000000000a2';
  filling constant uuid := '90000000-0000-0000-0000-0000000000a3';
  whitening constant uuid := '90000000-0000-0000-0000-0000000000a4';
  v uuid; p1 uuid; p2 uuid; inv uuid; pay uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE tenant_id = t AND notes = 'بيانات تجريبية') THEN
    RAISE NOTICE 'demo billing data already exists; nothing to do';
    RETURN;
  END IF;
  -- act as the clinic and the receptionist, so numbering, audit rows and "received by" are right
  PERFORM set_config('app.tenant_id', t::text, true), set_config('app.member_id', sara::text, true),
          set_config('app.user_id', 'b0000000-0000-0000-0000-0000000000a2', true), set_config('app.actor_type', 'member', true);

  INSERT INTO patients (id, tenant_id, file_no, full_name, phone, gender) VALUES
    (mona_p, t, next_tenant_counter('patient_file'), 'منى عبد الله', '+201077700091', 'female'),
    (karim,  t, next_tenant_counter('patient_file'), 'كريم حسن', '+201077700092', 'male')
  ON CONFLICT (id) DO NOTHING;

  -- Omar: a final visit with three procedures; two are invoiced, the consultation stays unbilled
  INSERT INTO visits (tenant_id, patient_id, doctor_id, branch_id, chief_complaint, diagnosis, created_by)
  VALUES (t, omar, mona, nasr, 'ألم عند المضغ', 'تسوس في الضرس 36', doc) RETURNING id INTO v;
  INSERT INTO visit_procedures (tenant_id, visit_id, service_id, doctor_id, tooth_code, surfaces, price_minor, created_by)
  VALUES (t, v, filling, mona, 36, '{O,D}', 100000, doc) RETURNING id INTO p1;
  INSERT INTO visit_procedures (tenant_id, visit_id, service_id, doctor_id, price_minor, created_by)
  VALUES (t, v, scaling, mona, 60000, doc) RETURNING id INTO p2;
  INSERT INTO visit_procedures (tenant_id, visit_id, service_id, doctor_id, price_minor, created_by)
  VALUES (t, v, consult, mona, 30000, doc);
  UPDATE visits SET status = 'final', finalized_by = doc WHERE id = v;

  INSERT INTO invoices (tenant_id, branch_id, patient_id, currency, notes, created_by) VALUES (t, nasr, omar, 'EGP', 'بيانات تجريبية', sara) RETURNING id INTO inv;
  INSERT INTO invoice_items (tenant_id, invoice_id, service_id, visit_procedure_id, doctor_id, description, tooth_code, quantity, unit_price_minor, line_total_minor, sort_order) VALUES
    (t, inv, filling, p1, mona, 'حشو تجميلي — سن 36 (OD)', 36, 1, 100000, 100000, 0),
    (t, inv, scaling, p2, mona, 'تنظيف الجير والتلميع', NULL, 1, 60000, 60000, 1);
  PERFORM issue_invoice(inv);
  INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, reference, paid_at, received_by, idempotency_key)
  VALUES (t, nasr, omar, inv, 60000, 'EGP', 'cash', NULL, now(), sara, 'demo-omar-1'),
         (t, nasr, omar, inv, 40000, 'EGP', 'instapay', 'IP-773190', now(), sara, 'demo-omar-2');

  -- Omar: a draft invoice not issued yet
  INSERT INTO invoices (tenant_id, branch_id, patient_id, currency, notes, created_by) VALUES (t, nasr, omar, 'EGP', 'بيانات تجريبية', sara) RETURNING id INTO inv;
  INSERT INTO invoice_items (tenant_id, invoice_id, description, quantity, unit_price_minor, line_total_minor) VALUES (t, inv, 'أشعة بانوراما', 1, 15000, 15000);

  -- Nour: paid in full by card and bank transfer
  INSERT INTO invoices (tenant_id, branch_id, patient_id, currency, notes, created_by) VALUES (t, nasr, nour, 'EGP', 'بيانات تجريبية', sara) RETURNING id INTO inv;
  INSERT INTO invoice_items (tenant_id, invoice_id, service_id, description, quantity, unit_price_minor, line_total_minor, sort_order) VALUES
    (t, inv, consult, 'كشف', 1, 30000, 30000, 0), (t, inv, whitening, 'تبييض الأسنان', 1, 350000, 350000, 1);
  PERFORM issue_invoice(inv);
  INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, reference, paid_at, received_by, idempotency_key) VALUES
    (t, nasr, nour, inv, 200000, 'EGP', 'card', 'APR-55821', now(), sara, 'demo-nour-1'),
    (t, nasr, nour, inv, 180000, 'EGP', 'bank_transfer', 'TRX-2026-7781', now(), owner, 'demo-nour-2');

  -- Nour: issued by mistake, then voided
  INSERT INTO invoices (tenant_id, branch_id, patient_id, currency, notes, created_by) VALUES (t, nasr, nour, 'EGP', 'بيانات تجريبية', sara) RETURNING id INTO inv;
  INSERT INTO invoice_items (tenant_id, invoice_id, service_id, description, quantity, unit_price_minor, line_total_minor) VALUES (t, inv, scaling, 'تنظيف الجير والتلميع', 1, 60000, 60000);
  PERFORM issue_invoice(inv);
  UPDATE invoices SET status = 'void', void_reason = 'أُصدرت للمريض الخطأ', voided_at = now(), voided_by = sara WHERE id = inv;

  -- منى عبد الله: a cash payment entered by mistake and reversed, then the right one by e-wallet
  INSERT INTO invoices (tenant_id, branch_id, patient_id, currency, notes, created_by) VALUES (t, nasr, mona_p, 'EGP', 'بيانات تجريبية', sara) RETURNING id INTO inv;
  INSERT INTO invoice_items (tenant_id, invoice_id, service_id, description, quantity, unit_price_minor, line_total_minor) VALUES (t, inv, filling, 'حشو تجميلي', 1, 80000, 80000);
  PERFORM issue_invoice(inv);
  INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at, received_by, idempotency_key)
  VALUES (t, nasr, mona_p, inv, 80000, 'EGP', 'cash', now(), sara, 'demo-mona-1') RETURNING id INTO pay;
  UPDATE payments SET status = 'reversed', reversed_at = now(), reversed_by = sara, reversal_reason = 'سُجلت نقدًا والمريضة دفعت بالمحفظة' WHERE id = pay;
  INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, reference, paid_at, received_by, idempotency_key)
  VALUES (t, nasr, mona_p, inv, 80000, 'EGP', 'wallet', 'VF-01093321', now(), sara, 'demo-mona-2');

  -- كريم حسن: paid by card, part refunded in cash by the owner
  INSERT INTO invoices (tenant_id, branch_id, patient_id, currency, notes, created_by) VALUES (t, nasr, karim, 'EGP', 'بيانات تجريبية', sara) RETURNING id INTO inv;
  INSERT INTO invoice_items (tenant_id, invoice_id, service_id, description, quantity, unit_price_minor, line_total_minor, sort_order) VALUES
    (t, inv, scaling, 'تنظيف الجير والتلميع', 1, 60000, 60000, 0), (t, inv, consult, 'كشف', 1, 30000, 30000, 1);
  PERFORM issue_invoice(inv);
  INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, reference, paid_at, received_by, idempotency_key)
  VALUES (t, nasr, karim, inv, 90000, 'EGP', 'card', 'APR-55990', now(), sara, 'demo-karim-1') RETURNING id INTO pay;
  INSERT INTO refunds (tenant_id, payment_id, amount_minor, method, reason, created_by) VALUES (t, pay, 20000, 'cash', 'لم يتم جزء من التنظيف', owner);

  RAISE NOTICE 'demo billing data created';
END $demo$;
