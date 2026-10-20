-- migrate:up
-- Owner's decision (2026-10-20, replaces the reception part of CLR-03): expenses are the owner's and the accountant's.
-- Reception runs bookings, patients and patient payments, and still opens and closes the cash box (cash:operate),
-- whose cash-expense total it needs to count the drawer. `expenses:write:cash` is retired: no new clinic's
-- receptionist gets it and every role loses it. The members concerned get a new access version first, so a token
-- issued with the old rights stops working at once. Expenses already recorded by reception stay as they are
-- (a pending one still waits for the owner). tenant_settings.reception_expense_limit_minor stays, unused.
CREATE OR REPLACE FUNCTION default_role_permissions(p_role text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN ARRAY['*']
    WHEN 'doctor' THEN ARRAY['branches:read','patients:read','patients:write','patients:merge','clinical:read','clinical:write',
      'appointments:read','appointments:write:own','treatments:write:own','invoices:read:own','reports:read:own']
    WHEN 'receptionist' THEN ARRAY['branches:read','patients:read','patients:write','patients:merge','patients:block','clinical:read',
      'appointments:read','appointments:write','appointments:override','invoices:read','invoices:write','payments:write',
      'payments:reverse','discounts:apply','reports:read:daily','cash:operate']
    WHEN 'assistant' THEN ARRAY['branches:read','patients:read','clinical:read','appointments:read','appointments:write',
      'inventory:read','inventory:write']
    WHEN 'accountant' THEN ARRAY['branches:read','patients:read','appointments:read','invoices:read','invoices:write','invoices:void',
      'payments:write','payments:refund','discounts:apply','expenses:read','expenses:write','inventory:read','reports:read',
      'subscription:read','cash:operate']
    ELSE ARRAY[]::text[] END
$$;
UPDATE tenant_members m SET access_version = m.access_version + 1
  FROM roles r WHERE r.id = m.role_id AND 'expenses:write:cash' = ANY (r.permissions);
UPDATE roles SET permissions = array_remove(permissions, 'expenses:write:cash') WHERE 'expenses:write:cash' = ANY (permissions);

-- migrate:down
-- the 0025 defaults, and the right back on every system receptionist role (with a new access version)
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
UPDATE roles SET permissions = permissions || ARRAY['expenses:write:cash']
  WHERE is_system AND key = 'receptionist' AND NOT 'expenses:write:cash' = ANY (permissions);
UPDATE tenant_members m SET access_version = m.access_version + 1
  FROM roles r WHERE r.id = m.role_id AND r.is_system AND r.key = 'receptionist';
