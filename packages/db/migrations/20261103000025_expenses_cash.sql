-- migrate:up
-- Phase E3: expenses with approval and the daily cash box (SRS EXP-001…004, CASH-001…004; database design E-08…E-10).
-- Decisions (accepted 2026-10-17):
-- CLR-03 — expenses entered by the owner or the accountant are approved on entry; receptionists may record CASH expenses
--          up to a clinic-set amount (starting at 500.00), which wait for the owner's approval.
-- CLR-04 — one cash session per branch per business day; receptionist or accountant opens and closes; only the owner
--          reopens, with a reason; nothing is dated into a closed day.
-- Additive. Existing expenses (dev seed only) become "approved" with no method (unknown, so nothing is guessed).

-- the clinic's business day of a moment (its own time zone)
CREATE OR REPLACE FUNCTION business_date(p_at timestamptz, p_tenant uuid) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (p_at AT TIME ZONE coalesce((SELECT timezone FROM tenants WHERE id = p_tenant), 'Africa/Cairo'))::date
$$;

-- ---------------------------------------------------------------------
-- 1. Expense categories (EXP-002): eight Arabic starting categories per clinic; renamed or deactivated, not deleted
-- ---------------------------------------------------------------------
ALTER TABLE expense_categories
  ADD COLUMN key text,
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT expense_categories_name_length CHECK (char_length(btrim(name)) BETWEEN 2 AND 80) NOT VALID;
CREATE UNIQUE INDEX expense_categories_key ON expense_categories (tenant_id, key) WHERE key IS NOT NULL;
-- Safe to run again: a category the clinic already has under the same name takes the key (nothing is duplicated),
-- and a key already in use (say, a starting category the owner renamed) is left as it is.
CREATE OR REPLACE FUNCTION seed_expense_categories(p_tenant uuid) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES ('rent', 'إيجار'), ('salaries', 'رواتب'), ('supplies', 'مستلزمات'), ('equipment', 'أجهزة ومعدات'),
    ('laboratory', 'معامل'), ('utilities', 'كهرباء ومياه وإنترنت'), ('maintenance', 'صيانة'), ('other', 'أخرى')) v(k, n) LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM expense_categories WHERE tenant_id = p_tenant AND key = c.k);
    UPDATE expense_categories SET key = c.k WHERE tenant_id = p_tenant AND name = c.n AND key IS NULL;
    IF NOT FOUND THEN
      INSERT INTO expense_categories (tenant_id, key, name) VALUES (p_tenant, c.k, c.n) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $f$;
SELECT seed_expense_categories(id) FROM tenants;
CREATE OR REPLACE FUNCTION tenant_settings_seed_categories() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seed_expense_categories(NEW.tenant_id);
  RETURN NULL;
END $$;
CREATE TRIGGER tenant_settings_seed_categories AFTER INSERT ON tenant_settings FOR EACH ROW EXECUTE FUNCTION tenant_settings_seed_categories();
REVOKE DELETE ON expense_categories FROM app_user;
CREATE TRIGGER audit_expense_categories AFTER INSERT OR UPDATE ON expense_categories FOR EACH ROW EXECUTE FUNCTION audit_row_change('expense_category');

-- the most a receptionist records in one cash expense (CLR-03); 0 = receptionists record none
ALTER TABLE tenant_settings ADD COLUMN reception_expense_limit_minor bigint NOT NULL DEFAULT 50000
  CONSTRAINT tenant_settings_reception_expense_limit CHECK (reception_expense_limit_minor BETWEEN 0 AND 100000000);

-- ---------------------------------------------------------------------
-- 2. Expenses (EXP-001, EXP-003, EXP-004, E-08)
-- ---------------------------------------------------------------------
ALTER TABLE expenses
  ADD COLUMN payment_method text CONSTRAINT expenses_payment_method CHECK (payment_method IN ('cash', 'card', 'bank_transfer', 'wallet', 'instapay')),
  ADD COLUMN reference      text CONSTRAINT expenses_reference_length CHECK (char_length(reference) BETWEEN 1 AND 100),
  ADD COLUMN supplier_name  text CONSTRAINT expenses_supplier_length CHECK (char_length(supplier_name) BETWEEN 1 AND 120),
  ADD COLUMN status         text NOT NULL DEFAULT 'approved' CONSTRAINT expenses_status CHECK (status IN ('pending', 'approved', 'rejected', 'void')),
  ADD COLUMN approved_by    uuid,
  ADD COLUMN approved_at    timestamptz,
  ADD COLUMN decision_note  text,
  ADD COLUMN void_reason    text,
  ADD COLUMN voided_by      uuid,
  ADD COLUMN voided_at      timestamptz,
  ADD COLUMN updated_at     timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT expenses_approved_by_fk FOREIGN KEY (tenant_id, approved_by) REFERENCES tenant_members(tenant_id, id),
  ADD CONSTRAINT expenses_voided_by_fk FOREIGN KEY (tenant_id, voided_by) REFERENCES tenant_members(tenant_id, id),
  -- EXP-003: nobody approves their own (an expense approved on entry has no approver)
  ADD CONSTRAINT expenses_self_approval CHECK (approved_by IS NULL OR approved_by IS DISTINCT FROM created_by),
  ADD CONSTRAINT expenses_void_complete CHECK ((status = 'void') = (voided_at IS NOT NULL AND coalesce(char_length(btrim(void_reason)), 0) >= 3)),
  ADD CONSTRAINT expenses_description_length CHECK (char_length(description) <= 500);
-- new expenses carry their method, and the reference rules of payments (old rows had none: NOT VALID)
ALTER TABLE expenses ADD CONSTRAINT expenses_method_required CHECK (payment_method IS NOT NULL) NOT VALID;
ALTER TABLE expenses ADD CONSTRAINT expenses_reference_required CHECK (payment_method NOT IN ('bank_transfer', 'wallet', 'instapay') OR reference IS NOT NULL);
CREATE INDEX expenses_branch_day ON expenses (tenant_id, branch_id, spent_on);
CREATE INDEX expenses_pending ON expenses (tenant_id, created_at) WHERE status = 'pending';
REVOKE DELETE ON expenses FROM app_user;

-- recorded money does not change: corrections are void + a new expense; status moves only forward
CREATE OR REPLACE FUNCTION expenses_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.spent_on > business_date(now(), NEW.tenant_id) THEN
      RAISE EXCEPTION 'an expense is not dated in the future' USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_future';
    END IF;
    IF NEW.currency <> (SELECT currency FROM tenants WHERE id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'an expense is in the clinic currency' USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_clinic_currency';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.branch_id, NEW.category_id, NEW.amount_minor, NEW.currency, NEW.spent_on, NEW.payment_method, NEW.reference, NEW.supplier_name,
      NEW.description, NEW.created_by, NEW.created_at, NEW.file_id) IS DISTINCT FROM
     (OLD.branch_id, OLD.category_id, OLD.amount_minor, OLD.currency, OLD.spent_on, OLD.payment_method, OLD.reference, OLD.supplier_name,
      OLD.description, OLD.created_by, OLD.created_at, OLD.file_id) THEN
    RAISE EXCEPTION 'a recorded expense is not edited; void it and record it again' USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_locked';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'void'))
    OR (OLD.status IN ('approved', 'rejected') AND NEW.status = 'void')) THEN
    RAISE EXCEPTION 'an expense cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_locked';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER expenses_guard BEFORE INSERT OR UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION expenses_guard();
DROP TRIGGER IF EXISTS audit_expenses ON expenses;
CREATE TRIGGER audit_expenses AFTER INSERT OR UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION audit_row_change('expense', 'description');

-- ---------------------------------------------------------------------
-- 3. Cash sessions (CASH-001…004, E-10)
-- ---------------------------------------------------------------------
CREATE TABLE cash_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL,
  business_date     date NOT NULL,
  currency          char(3) NOT NULL,
  status            text NOT NULL DEFAULT 'open' CONSTRAINT cash_sessions_status CHECK (status IN ('open', 'closed')),
  opening_minor     bigint NOT NULL CONSTRAINT cash_sessions_opening CHECK (opening_minor >= 0),
  opened_by         uuid NOT NULL,
  opened_at         timestamptz NOT NULL DEFAULT now(),
  counted_minor     bigint CONSTRAINT cash_sessions_counted CHECK (counted_minor >= 0),
  expected_minor    bigint,
  difference_minor  bigint GENERATED ALWAYS AS (counted_minor - expected_minor) STORED,
  closing_totals    jsonb,
  note              text CONSTRAINT cash_sessions_note_length CHECK (char_length(note) <= 500),
  closed_by         uuid,
  closed_at         timestamptz,
  UNIQUE (tenant_id, id),
  CONSTRAINT cash_sessions_one_per_day UNIQUE (tenant_id, branch_id, business_date),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, opened_by) REFERENCES tenant_members(tenant_id, id),
  FOREIGN KEY (tenant_id, closed_by) REFERENCES tenant_members(tenant_id, id),
  CONSTRAINT cash_sessions_closed_complete CHECK ((status = 'closed') = (closed_at IS NOT NULL AND counted_minor IS NOT NULL AND expected_minor IS NOT NULL)),
  -- CASH-003: a difference needs a note
  CONSTRAINT cash_sessions_difference_note CHECK (status <> 'closed' OR counted_minor = expected_minor OR coalesce(char_length(btrim(note)), 0) >= 3)
);
CREATE UNIQUE INDEX cash_sessions_one_open_per_branch ON cash_sessions (tenant_id, branch_id) WHERE status = 'open';
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cash_sessions USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY branch_access ON cash_sessions AS RESTRICTIVE
  USING ((SELECT member_branch_ids()) IS NULL OR branch_id = ANY ((SELECT member_branch_ids())::uuid[]))
  WITH CHECK ((SELECT member_branch_ids()) IS NULL OR branch_id = ANY ((SELECT member_branch_ids())::uuid[]));
REVOKE DELETE ON cash_sessions FROM app_user;
CREATE TRIGGER audit_cash_sessions AFTER INSERT OR UPDATE ON cash_sessions FOR EACH ROW EXECUTE FUNCTION audit_row_change('cash_session', 'note');

-- CASH-004: every reopening keeps the figures it undid
CREATE TABLE cash_session_reopenings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id        uuid NOT NULL,
  reason            text NOT NULL CONSTRAINT cash_session_reopenings_reason CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  previous_counted  bigint NOT NULL,
  previous_expected bigint NOT NULL,
  previous_note     text,
  previous_closed_by uuid,
  previous_closed_at timestamptz NOT NULL,
  reopened_by       uuid NOT NULL,
  reopened_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, session_id) REFERENCES cash_sessions(tenant_id, id),
  FOREIGN KEY (tenant_id, reopened_by) REFERENCES tenant_members(tenant_id, id)
);
ALTER TABLE cash_session_reopenings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_session_reopenings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cash_session_reopenings USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY branch_access ON cash_session_reopenings AS RESTRICTIVE
  USING ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM cash_sessions s WHERE s.id = session_id))
  WITH CHECK ((SELECT member_branch_ids()) IS NULL OR EXISTS (SELECT 1 FROM cash_sessions s WHERE s.id = session_id));
REVOKE UPDATE, DELETE ON cash_session_reopenings FROM app_user;
CREATE TRIGGER audit_cash_session_reopenings AFTER INSERT ON cash_session_reopenings FOR EACH ROW EXECUTE FUNCTION audit_row_change('cash_session_reopening', 'reason');

-- the session's figures change only by closing (open -> closed) or by an audited reopening (closed -> open)
CREATE OR REPLACE FUNCTION cash_sessions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN RAISE EXCEPTION 'a session opens first' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.branch_id, NEW.business_date, NEW.currency, NEW.opening_minor, NEW.opened_by, NEW.opened_at)
     IS DISTINCT FROM (OLD.branch_id, OLD.business_date, OLD.currency, OLD.opening_minor, OLD.opened_by, OLD.opened_at) THEN
    RAISE EXCEPTION 'the opening of a session is fixed' USING ERRCODE = 'check_violation', CONSTRAINT = 'cash_session_closed';
  END IF;
  IF OLD.status = 'closed' AND NEW.status = 'closed' THEN
    RAISE EXCEPTION 'a closed session does not change' USING ERRCODE = 'check_violation', CONSTRAINT = 'cash_session_closed';
  END IF;
  IF OLD.status = 'closed' AND NEW.status = 'open' AND NOT EXISTS (
       SELECT 1 FROM cash_session_reopenings WHERE session_id = OLD.id AND reopened_at = now()) THEN
    RAISE EXCEPTION 'a session is reopened only with its reason recorded' USING ERRCODE = 'check_violation', CONSTRAINT = 'cash_session_closed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cash_sessions_guard BEFORE INSERT OR UPDATE ON cash_sessions FOR EACH ROW EXECUTE FUNCTION cash_sessions_guard();

-- CASH-002: what moved on one branch's business day, from recorded transactions only (never typed)
CREATE OR REPLACE FUNCTION cash_day_totals(p_branch uuid, p_date date) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH t AS (SELECT tenant_id FROM branches WHERE id = p_branch),
  pay AS (
    SELECT p.method, sum(p.amount_minor) AS amount FROM payments p, t
    WHERE p.branch_id = p_branch AND p.status IN ('succeeded', 'partially_refunded', 'refunded')
      AND business_date(p.paid_at, t.tenant_id) = p_date GROUP BY p.method),
  ref AS (
    SELECT r.method, sum(r.amount_minor) AS amount FROM refunds r, t
    WHERE r.branch_id = p_branch AND business_date(r.refunded_at, t.tenant_id) = p_date GROUP BY r.method),
  exp AS (
    SELECT e.payment_method AS method, sum(e.amount_minor) AS amount FROM expenses e
    WHERE e.branch_id = p_branch AND e.spent_on = p_date AND e.status <> 'void' AND e.payment_method IS NOT NULL
    GROUP BY e.payment_method)
  SELECT jsonb_build_object(
    'payments', coalesce((SELECT jsonb_object_agg(method, amount) FROM pay), '{}'),
    'refunds', coalesce((SELECT jsonb_object_agg(method, amount) FROM ref), '{}'),
    'expenses', coalesce((SELECT jsonb_object_agg(method, amount) FROM exp), '{}'),
    'cash_in', coalesce((SELECT amount FROM pay WHERE method = 'cash'), 0),
    'cash_refunds', coalesce((SELECT amount FROM ref WHERE method = 'cash'), 0),
    'cash_expenses', coalesce((SELECT amount FROM exp WHERE method = 'cash'), 0))
$$;

-- CLR-04: nothing is dated into a closed day — payments, reversals, refunds and expenses of that branch and date
-- The session row is share-locked: a movement saved while the day is being closed waits for the close and is then
-- refused, and the close (which locks the row FOR UPDATE before adding up the day) waits for movements already in flight.
CREATE OR REPLACE FUNCTION cash_day_closed(p_branch uuid, p_date date) RETURNS boolean
LANGUAGE plpgsql VOLATILE AS $f$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM cash_sessions WHERE branch_id = p_branch AND business_date = p_date FOR SHARE;
  RETURN coalesce(v_status = 'closed', false);
END $f$;

CREATE OR REPLACE FUNCTION cash_day_open_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_day date;
BEGIN
  IF coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' THEN RETURN coalesce(NEW, OLD); END IF;
  IF TG_TABLE_NAME = 'payments' THEN
    IF TG_OP = 'UPDATE' AND NOT (NEW.status = 'reversed' AND OLD.status <> 'reversed') THEN RETURN NEW; END IF; -- refunds have their own day
    IF NEW.paid_at IS NULL THEN RETURN NEW; END IF;
    IF NEW.paid_at > now() + interval '5 minutes' THEN
      RAISE EXCEPTION 'a payment is not dated in the future' USING ERRCODE = 'check_violation', CONSTRAINT = 'payments_future';
    END IF;
    v_day := business_date(NEW.paid_at, NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'refunds' THEN
    v_day := business_date(NEW.refunded_at, NEW.tenant_id);
  ELSE -- expenses: a new one, or one whose status changes what the day expects
    -- money that left the drawer stays on its day whatever the owner decides; only a void (recorded in error) changes it
    IF TG_OP = 'UPDATE' AND NOT (NEW.status = 'void' AND OLD.status <> 'void') THEN RETURN NEW; END IF;
    v_day := NEW.spent_on;
  END IF;
  IF cash_day_closed(NEW.branch_id, v_day) THEN
    RAISE EXCEPTION 'the cash day % of this branch is closed', v_day USING ERRCODE = 'check_violation', CONSTRAINT = 'cash_session_closed';
  END IF;
  RETURN NEW;
END $$;
-- named to fire after each table's validate trigger (BEFORE triggers run in name order), once branch and dates are filled
CREATE TRIGGER payments_within_open_day BEFORE INSERT OR UPDATE OF status ON payments FOR EACH ROW EXECUTE FUNCTION cash_day_open_guard();
CREATE TRIGGER refunds_within_open_day BEFORE INSERT ON refunds FOR EACH ROW EXECUTE FUNCTION cash_day_open_guard();
CREATE TRIGGER expenses_within_open_day BEFORE INSERT OR UPDATE OF status ON expenses FOR EACH ROW EXECUTE FUNCTION cash_day_open_guard();

-- ---------------------------------------------------------------------
-- 4. Permissions (CLR-03, CLR-04): receptionists record cash expenses and run the cash box; accountants run it too
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION default_role_permissions(p_role text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN ARRAY['*']
    WHEN 'doctor' THEN ARRAY['branches:read','patients:read','patients:write','patients:merge','clinical:read','clinical:write',
      'appointments:read','appointments:write:own','treatments:write:own','invoices:read:own','reports:read:own']
    WHEN 'receptionist' THEN ARRAY['branches:read','patients:read','patients:write','patients:merge','patients:block','clinical:read',
      'appointments:read','appointments:write','appointments:override','invoices:read','invoices:write','payments:write',
      'payments:reverse','discounts:apply','reports:read:daily','expenses:write:cash','cash:operate']
    WHEN 'assistant' THEN ARRAY['branches:read','patients:read','clinical:read','appointments:read','appointments:write',
      'inventory:read','inventory:write']
    WHEN 'accountant' THEN ARRAY['branches:read','patients:read','appointments:read','invoices:read','invoices:write','invoices:void',
      'payments:write','payments:refund','discounts:apply','expenses:read','expenses:write','inventory:read','reports:read',
      'subscription:read','cash:operate']
    ELSE ARRAY[]::text[] END
$$;
UPDATE roles r SET permissions = r.permissions || ARRAY(
  SELECT p FROM unnest(default_role_permissions(r.key)) p WHERE NOT p = ANY (r.permissions))
WHERE r.is_system AND r.key IN ('receptionist', 'accountant')
  AND EXISTS (SELECT 1 FROM unnest(default_role_permissions(r.key)) p WHERE NOT p = ANY (r.permissions));

-- migrate:down
-- Permissions granted to roles stay (removing rights on rollback could lock people out); the function goes back.
CREATE OR REPLACE FUNCTION default_role_permissions(p_role text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN ARRAY['*']
    WHEN 'doctor' THEN ARRAY['branches:read','patients:read','patients:write','patients:merge','clinical:read','clinical:write',
      'appointments:read','appointments:write:own','treatments:write:own','invoices:read:own','reports:read:own']
    WHEN 'receptionist' THEN ARRAY['branches:read','patients:read','patients:write','patients:merge','patients:block','clinical:read',
      'appointments:read','appointments:write','appointments:override','invoices:read','invoices:write','payments:write',
      'payments:reverse','discounts:apply','reports:read:daily']
    WHEN 'assistant' THEN ARRAY['branches:read','patients:read','clinical:read','appointments:read','appointments:write',
      'inventory:read','inventory:write']
    WHEN 'accountant' THEN ARRAY['branches:read','patients:read','appointments:read','invoices:read','invoices:write','invoices:void',
      'payments:write','payments:refund','discounts:apply','expenses:read','expenses:write','inventory:read','reports:read',
      'subscription:read']
    ELSE ARRAY[]::text[] END
$$;
DROP TRIGGER IF EXISTS expenses_within_open_day ON expenses;
DROP TRIGGER IF EXISTS refunds_within_open_day ON refunds;
DROP TRIGGER IF EXISTS payments_within_open_day ON payments;
DROP FUNCTION IF EXISTS cash_day_open_guard();
DROP FUNCTION IF EXISTS cash_day_closed(uuid, date);
DROP FUNCTION IF EXISTS cash_day_totals(uuid, date);
DROP TABLE IF EXISTS cash_session_reopenings;
DROP TABLE IF EXISTS cash_sessions;
DROP FUNCTION IF EXISTS cash_sessions_guard();
DROP TRIGGER IF EXISTS audit_expenses ON expenses;
CREATE TRIGGER audit_expenses AFTER INSERT OR DELETE OR UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION audit_row_change('expense', 'description');
DROP TRIGGER IF EXISTS expenses_guard ON expenses;
DROP FUNCTION IF EXISTS expenses_guard();
GRANT DELETE ON expenses TO app_user;
DROP INDEX IF EXISTS expenses_pending;
DROP INDEX IF EXISTS expenses_branch_day;
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_reference_required, DROP CONSTRAINT IF EXISTS expenses_method_required,
  DROP CONSTRAINT IF EXISTS expenses_description_length, DROP CONSTRAINT IF EXISTS expenses_void_complete, DROP CONSTRAINT IF EXISTS expenses_self_approval,
  DROP CONSTRAINT IF EXISTS expenses_voided_by_fk, DROP CONSTRAINT IF EXISTS expenses_approved_by_fk,
  DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS voided_at, DROP COLUMN IF EXISTS voided_by, DROP COLUMN IF EXISTS void_reason,
  DROP COLUMN IF EXISTS decision_note, DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS approved_by, DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS supplier_name, DROP COLUMN IF EXISTS reference, DROP COLUMN IF EXISTS payment_method;
ALTER TABLE tenant_settings DROP COLUMN IF EXISTS reception_expense_limit_minor;
DROP TRIGGER IF EXISTS audit_expense_categories ON expense_categories;
GRANT DELETE ON expense_categories TO app_user;
DROP TRIGGER IF EXISTS tenant_settings_seed_categories ON tenant_settings;
DROP FUNCTION IF EXISTS tenant_settings_seed_categories();
DROP FUNCTION IF EXISTS seed_expense_categories(uuid);
DROP INDEX IF EXISTS expense_categories_key;
ALTER TABLE expense_categories DROP CONSTRAINT IF EXISTS expense_categories_name_length, DROP COLUMN IF EXISTS is_active, DROP COLUMN IF EXISTS key;
DROP FUNCTION IF EXISTS business_date(timestamptz, uuid);
