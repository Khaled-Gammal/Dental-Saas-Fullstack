-- migrate:up
-- Phase C, part 3: the role permission catalogue of SRS v4 B.1 (ACCESS-004). Additive: no role loses a permission.
-- Clinical and financial rights stay apart: no seeded role except the owner holds both kinds of write permission.
-- Decisions taken (2026-10-17): CLR-05 default — refunds by owner and accountant; reception may reverse its own
-- same-day entry. Permissions still waiting for a decision (discount approval, expense approval, cash, adjustments,
-- reception expenses) are not given to any role but the owner ('*').
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

-- Existing clinics: their seeded (system) roles gain the new defaults; nothing is removed, order is kept.
UPDATE roles r SET permissions = r.permissions || ARRAY(
  SELECT p FROM unnest(default_role_permissions(r.key)) p WHERE NOT p = ANY (r.permissions))
WHERE r.is_system AND r.key <> 'owner'
  AND EXISTS (SELECT 1 FROM unnest(default_role_permissions(r.key)) p WHERE NOT p = ANY (r.permissions));

-- migrate:down
-- The function goes back to its 0003 body. Permissions already granted to roles are left in place (removing rights
-- on rollback could lock people out of work they were doing); remove them by hand if needed.
CREATE OR REPLACE FUNCTION default_role_permissions(p_role text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN ARRAY['*']
    WHEN 'doctor' THEN ARRAY['branches:read','patients:read','patients:write','clinical:read','clinical:write',
      'appointments:read','appointments:write:own','treatments:write:own','invoices:read:own','reports:read:own']
    WHEN 'receptionist' THEN ARRAY['branches:read','patients:read','patients:write','clinical:read',
      'appointments:read','appointments:write','appointments:override','invoices:read','invoices:write','payments:write',
      'reports:read:daily']
    WHEN 'assistant' THEN ARRAY['branches:read','patients:read','clinical:read','appointments:read','appointments:write',
      'inventory:read','inventory:write']
    WHEN 'accountant' THEN ARRAY['branches:read','patients:read','appointments:read','invoices:read','invoices:write',
      'payments:write','expenses:write','inventory:read','reports:read','subscription:read']
    ELSE ARRAY[]::text[] END
$$;
