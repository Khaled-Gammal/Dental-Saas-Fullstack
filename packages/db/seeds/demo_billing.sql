-- Demo invoices and payments for clinic A, to look at the billing screens (dev only, never run in production).
-- Run: pnpm --filter @dental/db seed:demo-billing   (safe to run again: each part does nothing if its data exists)
--
-- What it creates (branch Nasr City, receptionist Sara as the receiver unless said otherwise):
--   Omar Khaled  — a final visit by Dr. Mona with three procedures; invoice from two of them, partly paid
--                  (cash + InstaPay); the consultation is left unbilled; and a draft invoice (X-ray)
--   Nour Ali     — invoice paid in full (card + bank transfer); another invoice issued by mistake and voided
--   منى عبد الله  — a cash payment entered by mistake and reversed, then paid by e-wallet
--   كريم حسن     — paid by card, then 200 EGP refunded in cash (part of the treatment was not done)
-- Further parts below (E2, E3, H1) each have their own guard.
-- Visits, recorded payments, expenses and cash days can never be deleted (by design); reset the dev database to remove them.
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

-- Phase E2 demo (separate guard, so it can be added to a database that already has the E1 demo):
--   Nour Ali  — a draft with a 15 % discount entered by the receptionist (limit 10 %): waiting for the owner's approval
--   كريم حسن  — 6,000 EGP orthodontics on 6 monthly installments: the first paid, the second overdue, the last waived
DO $demo2$
DECLARE
  t   constant uuid := '11111111-1111-1111-1111-111111111111';
  nasr constant uuid := 'd0000000-0000-0000-0000-0000000000a1';
  sara constant uuid := 'c0000000-0000-0000-0000-0000000000a2';
  owner constant uuid := 'c0000000-0000-0000-0000-0000000000a1';
  nour constant uuid := '70000000-0000-0000-0000-0000000000a2';
  karim constant uuid := '7f000000-0000-0000-0000-000000000002';
  inv uuid; plan uuid; first_ins uuid; last_ins uuid; k int;
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE tenant_id = t AND notes = 'بيانات تجريبية ٢') THEN
    RAISE NOTICE 'E2 demo data already exists; nothing to do';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM patients WHERE id = karim) THEN
    RAISE NOTICE 'run the E1 demo first (it creates the demo patients)';
    RETURN;
  END IF;
  PERFORM set_config('app.tenant_id', t::text, true), set_config('app.member_id', sara::text, true),
          set_config('app.user_id', 'b0000000-0000-0000-0000-0000000000a2', true), set_config('app.actor_type', 'member', true);

  -- a discount above the receptionist's 10 % limit, waiting for the owner
  INSERT INTO invoices (tenant_id, branch_id, patient_id, currency, notes, created_by) VALUES (t, nasr, nour, 'EGP', 'بيانات تجريبية ٢', sara) RETURNING id INTO inv;
  INSERT INTO invoice_items (tenant_id, invoice_id, description, quantity, unit_price_minor, line_total_minor) VALUES (t, inv, 'تاج زيركون', 1, 120000, 120000);
  UPDATE invoices SET discount_type = 'percent', discount_bp = 1500, discount_reason = 'مريضة دائمة منذ سنوات',
         discount_status = 'pending', discount_requested_by = sara WHERE id = inv;

  -- orthodontics on six monthly installments: one paid, one overdue, the last waived by the owner
  INSERT INTO invoices (tenant_id, branch_id, patient_id, currency, notes, created_by) VALUES (t, nasr, karim, 'EGP', 'بيانات تجريبية ٢', sara) RETURNING id INTO inv;
  INSERT INTO invoice_items (tenant_id, invoice_id, description, quantity, unit_price_minor, line_total_minor) VALUES (t, inv, 'تقويم أسنان — المرحلة الأولى', 1, 600000, 600000);
  PERFORM issue_invoice(inv);
  INSERT INTO payment_plans (tenant_id, patient_id, invoice_id, currency, total_minor, installments_count, start_date, created_by)
  VALUES (t, karim, inv, 'EGP', 600000, 6, current_date - 45, sara) RETURNING id INTO plan;
  FOR k IN 1..6 LOOP
    INSERT INTO installments (tenant_id, plan_id, seq, due_date, amount_minor) VALUES (t, plan, k, (current_date - 45) + (k - 1) * 30, 100000);
  END LOOP;
  SELECT id INTO first_ins FROM installments WHERE plan_id = plan AND seq = 1;
  SELECT id INTO last_ins FROM installments WHERE plan_id = plan AND seq = 6;
  INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, installment_id, amount_minor, currency, method, paid_at, received_by, idempotency_key)
  VALUES (t, nasr, karim, inv, first_ins, 100000, 'EGP', 'cash', now(), sara, 'demo2-karim-1');
  PERFORM set_config('app.member_id', owner::text, true), set_config('app.user_id', 'b0000000-0000-0000-0000-0000000000a1', true);
  INSERT INTO balance_adjustments (tenant_id, invoice_id, installment_id, kind, amount_minor, reason, created_by)
  VALUES (t, inv, last_ins, 'waiver', 1, 'تخفيف عن المريض بقرار المالك', owner);

  RAISE NOTICE 'E2 demo data created';
END $demo2$;

-- Phase E3: expenses and the cash box. Yesterday's cash day at Nasr City was opened with 1,000, paid 150 in cash
-- for supplies and was closed 20 short (with a note); today is left unopened, so opening it proposes 830.
-- Reception (Sara) runs the cash box; expenses are the owner's and the accountant's (owner 2026-10-20), approved on
-- entry. Today: the rent by bank transfer and a voided entry (owner), two small cash expenses by the accountant.
-- Expenses and cash days are never deleted (by design); voiding is the correction.
DO $demo3$
DECLARE
  t     constant uuid := '11111111-1111-1111-1111-111111111111';
  nasr  constant uuid := 'd0000000-0000-0000-0000-0000000000a1';
  sara  constant uuid := 'c0000000-0000-0000-0000-0000000000a2';
  owner constant uuid := 'c0000000-0000-0000-0000-0000000000a1';
  acct  constant uuid := 'c0000000-0000-0000-0000-0000000000a5';   -- Mahmoud, the accountant
  today date := business_date(now(), '11111111-1111-1111-1111-111111111111');
  supplies uuid; rent uuid; maint uuid; s uuid; e uuid; totals jsonb; expected bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM expenses WHERE tenant_id = t AND supplier_name = 'بيانات تجريبية ٣') THEN
    RAISE NOTICE 'E3 demo data already exists; nothing to do';
    RETURN;
  END IF;
  SELECT id INTO supplies FROM expense_categories WHERE tenant_id = t AND key = 'supplies';
  SELECT id INTO rent FROM expense_categories WHERE tenant_id = t AND key = 'rent';
  SELECT id INTO maint FROM expense_categories WHERE tenant_id = t AND key = 'maintenance';
  PERFORM set_config('app.tenant_id', t::text, true), set_config('app.member_id', sara::text, true),
          set_config('app.user_id', 'b0000000-0000-0000-0000-0000000000a2', true), set_config('app.actor_type', 'member', true);

  -- yesterday: open, one cash expense, close 20 short with a note — only when Nasr City has no cash day yet
  -- (one open session per branch: a day someone already opened is left alone)
  IF NOT EXISTS (SELECT 1 FROM cash_sessions WHERE branch_id = nasr AND (status = 'open' OR business_date = today - 1)) THEN
  INSERT INTO cash_sessions (tenant_id, branch_id, business_date, currency, opening_minor, opened_by, opened_at)
  VALUES (t, nasr, today - 1, 'EGP', 100000, sara, now() - interval '1 day') RETURNING id INTO s;
  PERFORM set_config('app.member_id', acct::text, true), set_config('app.user_id', 'b0000000-0000-0000-0000-0000000000a5', true);
  INSERT INTO expenses (tenant_id, branch_id, category_id, amount_minor, currency, spent_on, payment_method, description, supplier_name, created_by)
  VALUES (t, nasr, supplies, 15000, 'EGP', today - 1, 'cash', 'قفازات وكمامات', 'بيانات تجريبية ٣', acct);
  PERFORM set_config('app.member_id', sara::text, true), set_config('app.user_id', 'b0000000-0000-0000-0000-0000000000a2', true);
  totals := cash_day_totals(nasr, today - 1);
  expected := 100000 + (totals->>'cash_in')::bigint - (totals->>'cash_refunds')::bigint - (totals->>'cash_expenses')::bigint;
  UPDATE cash_sessions SET status = 'closed', counted_minor = expected - 2000, expected_minor = expected, closing_totals = totals,
    note = 'نقص ٢٠ جنيه — فكة أُعطيت لمريض', closed_by = sara, closed_at = now() - interval '12 hours' WHERE id = s;
  END IF;

  -- today's expenses only while today's cash day is not closed (nothing is dated into a closed day)
  IF EXISTS (SELECT 1 FROM cash_sessions WHERE branch_id = nasr AND business_date = today AND status = 'closed') THEN
    RAISE NOTICE 'today''s cash day at Nasr City is closed; only yesterday''s demo was added';
    RETURN;
  END IF;
  -- today: the accountant's small cash expenses (approved on entry)
  PERFORM set_config('app.member_id', acct::text, true), set_config('app.user_id', 'b0000000-0000-0000-0000-0000000000a5', true);
  INSERT INTO expenses (tenant_id, branch_id, category_id, amount_minor, currency, spent_on, payment_method, description, supplier_name, created_by)
  VALUES (t, nasr, supplies, 8000, 'EGP', today, 'cash', 'مياه وأكواب للعيادة', 'بيانات تجريبية ٣', acct),
         (t, nasr, maint, 12000, 'EGP', today, 'cash', 'تصليح حنفية الحوض', 'بيانات تجريبية ٣', acct);

  -- today: the owner's rent (approved on entry) and an entry voided for a wrong amount
  PERFORM set_config('app.member_id', owner::text, true), set_config('app.user_id', 'b0000000-0000-0000-0000-0000000000a1', true);
  INSERT INTO expenses (tenant_id, branch_id, category_id, amount_minor, currency, spent_on, payment_method, reference, description, supplier_name, created_by)
  VALUES (t, nasr, rent, 800000, 'EGP', today, 'bank_transfer', 'TRX-DEMO-1001', 'إيجار شهر أكتوبر', 'بيانات تجريبية ٣', owner);
  INSERT INTO expenses (tenant_id, branch_id, category_id, amount_minor, currency, spent_on, payment_method, reference, description, supplier_name, created_by)
  VALUES (t, nasr, rent, 80000, 'EGP', today, 'bank_transfer', 'TRX-DEMO-1002', 'إيجار (مبلغ خطأ)', 'بيانات تجريبية ٣', owner) RETURNING id INTO e;
  UPDATE expenses SET status = 'void', void_reason = 'المبلغ الصحيح 8000 وسُجل مرة أخرى', voided_by = owner, voided_at = now() WHERE id = e;

  RAISE NOTICE 'E3 demo data created';
END $demo3$;

-- Phase H1: a balance at check-in and a plan's invoiced/paid figures (Dr. Mona, Nasr City).
--   كريم حسن — an accepted three-item plan; item 1 (filling 46) done today and invoiced together with a consultation
--              outside the plan, partly paid in cash; booked for this evening, so the day list shows what he owes
--   Omar Khaled — booked today and checked in (manual), so the waiting list shows his balance
-- Plans, visits and payments are never deleted (by design); cancel the appointments from the dashboard if they are in the way.
DO $demo4$
DECLARE
  t     constant uuid := '11111111-1111-1111-1111-111111111111';
  nasr  constant uuid := 'd0000000-0000-0000-0000-0000000000a1';
  mona  constant uuid := 'f0000000-0000-0000-0000-0000000000a2';
  sara  constant uuid := 'c0000000-0000-0000-0000-0000000000a2';
  doc   constant uuid := 'c0000000-0000-0000-0000-0000000000a3';
  omar  constant uuid := '70000000-0000-0000-0000-0000000000a1';
  karim constant uuid := '7f000000-0000-0000-0000-000000000002';
  consult constant uuid := '90000000-0000-0000-0000-0000000000a1';
  scaling constant uuid := '90000000-0000-0000-0000-0000000000a2';
  filling constant uuid := '90000000-0000-0000-0000-0000000000a3';
  today date := business_date(now(), '11111111-1111-1111-1111-111111111111');
  plan uuid; item1 uuid; v uuid; p1 uuid; inv uuid; ap uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE tenant_id = t AND notes = 'بيانات تجريبية ٤') THEN
    RAISE NOTICE 'H1 demo data already exists; nothing to do';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM patients WHERE id = karim) THEN
    RAISE NOTICE 'run the E1 demo first (it creates the demo patients)';
    RETURN;
  END IF;
  PERFORM set_config('app.tenant_id', t::text, true), set_config('app.member_id', doc::text, true),
          set_config('app.user_id', 'b0000000-0000-0000-0000-0000000000a3', true), set_config('app.actor_type', 'member', true);

  -- the plan: drafted, proposed, accepted by the patient
  INSERT INTO treatment_plans (tenant_id, patient_id, doctor_id, title, notes)
  VALUES (t, karim, mona, 'علاج الفك السفلي', 'بيانات تجريبية ٤') RETURNING id INTO plan;
  INSERT INTO treatment_plan_items (tenant_id, plan_id, service_id, tooth_code, surfaces, price_minor, sort_order)
  VALUES (t, plan, filling, 46, '{O}', 100000, 0) RETURNING id INTO item1;
  INSERT INTO treatment_plan_items (tenant_id, plan_id, service_id, price_minor, sort_order) VALUES (t, plan, scaling, 60000, 1);
  INSERT INTO treatment_plan_items (tenant_id, plan_id, service_id, tooth_code, surfaces, price_minor, sort_order)
  VALUES (t, plan, filling, 47, '{O,D}', 100000, 2);
  UPDATE treatment_plans SET status = 'proposed' WHERE id = plan;
  UPDATE treatment_plans SET status = 'accepted', accepted_at = now(), accepted_by = doc WHERE id = plan;

  -- today's visit does item 1
  INSERT INTO visits (tenant_id, patient_id, doctor_id, branch_id, chief_complaint, diagnosis, created_by)
  VALUES (t, karim, mona, nasr, 'حساسية في الضرس 46', 'تسوس سطحي في 46', doc) RETURNING id INTO v;
  INSERT INTO visit_procedures (tenant_id, visit_id, service_id, doctor_id, tooth_code, surfaces, price_minor, plan_item_id, created_by)
  VALUES (t, v, filling, mona, 46, '{O}', 100000, item1, doc) RETURNING id INTO p1;
  UPDATE visits SET status = 'final', finalized_by = doc WHERE id = v;

  -- one invoice for the plan's filling and a consultation outside the plan, 500 paid in cash
  PERFORM set_config('app.member_id', sara::text, true), set_config('app.user_id', 'b0000000-0000-0000-0000-0000000000a2', true);
  INSERT INTO invoices (tenant_id, branch_id, patient_id, currency, notes, created_by) VALUES (t, nasr, karim, 'EGP', 'بيانات تجريبية ٤', sara) RETURNING id INTO inv;
  INSERT INTO invoice_items (tenant_id, invoice_id, service_id, visit_procedure_id, doctor_id, description, tooth_code, quantity, unit_price_minor, line_total_minor, sort_order) VALUES
    (t, inv, filling, p1, mona, 'حشو تجميلي — سن 46 (O)', 46, 1, 100000, 100000, 0);
  INSERT INTO invoice_items (tenant_id, invoice_id, service_id, description, quantity, unit_price_minor, line_total_minor, sort_order)
  VALUES (t, inv, consult, 'كشف', 1, 30000, 30000, 1);
  PERFORM issue_invoice(inv);
  IF NOT EXISTS (SELECT 1 FROM cash_sessions WHERE branch_id = nasr AND business_date = today AND status = 'closed') THEN
    INSERT INTO payments (tenant_id, branch_id, patient_id, invoice_id, amount_minor, currency, method, paid_at, received_by, idempotency_key)
    VALUES (t, nasr, karim, inv, 50000, 'EGP', 'cash', now(), sara, 'demo4-karim-1');
  END IF;

  -- today's appointments: Omar checked in for 6 pm, Karim booked for 7 pm (Cairo time)
  INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, service_id, starts_at, ends_at, status, confirmed_at, source, booked_by)
  VALUES (t, nasr, omar, mona, consult, (today + time '18:00') AT TIME ZONE 'Africa/Cairo', (today + time '18:30') AT TIME ZONE 'Africa/Cairo',
          'confirmed', now(), 'phone', sara) RETURNING id INTO ap;
  UPDATE appointments SET status = 'checked_in', check_in_method = 'manual', check_in_note = 'بيانات تجريبية ٤', checked_in_at = now(), checked_in_by = sara
   WHERE id = ap;
  INSERT INTO appointments (tenant_id, branch_id, patient_id, doctor_id, service_id, starts_at, ends_at, status, confirmed_at, source, booked_by)
  VALUES (t, nasr, karim, mona, scaling, (today + time '19:00') AT TIME ZONE 'Africa/Cairo', (today + time '19:30') AT TIME ZONE 'Africa/Cairo',
          'confirmed', now(), 'phone', sara);

  RAISE NOTICE 'H1 demo data created';
END $demo4$;
