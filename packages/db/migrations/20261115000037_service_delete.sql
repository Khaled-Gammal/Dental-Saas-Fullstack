-- migrate:up
-- Services (owner 2026-10-21): every clinic types its own services and can delete them. A service nothing points at is
-- removed outright; one already used by appointments, plans, visits, invoices or the waitlist is marked deleted
-- instead, so that history keeps its name. A deleted service is off everywhere (the check), so every "active" filter
-- already hides it; the price list, the edit form and new uses also skip it by deleted_at.
ALTER TABLE services ADD COLUMN deleted_at timestamptz;
ALTER TABLE services ADD CONSTRAINT services_deleted_is_off
  CHECK (deleted_at IS NULL OR (NOT is_active AND NOT show_on_website AND NOT bookable_online));

-- migrate:down
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_deleted_is_off;
ALTER TABLE services DROP COLUMN IF EXISTS deleted_at;
