-- migrate:up
-- Week 3 onboarding: rules the setup wizard relies on.

-- Two shifts of the same branch on the same weekday may not overlap (10:00-14:00 and 13:00-16:00 is a typo, not a schedule).
-- Times are lifted onto a fixed date so a tsrange can be compared; touching shifts (10-14 and 14-18) are allowed.
ALTER TABLE branch_hours ADD CONSTRAINT branch_hours_no_overlap EXCLUDE USING gist (
  branch_id WITH =,
  weekday WITH =,
  tsrange(DATE '2000-01-01' + opens_at, DATE '2000-01-01' + closes_at, '[)') WITH &&
);

-- A clinic's theme colour must be a plain #rrggbb (it is written into CSS on the public site).
ALTER TABLE sites ADD CONSTRAINT sites_theme_primary_hex CHECK (
  NOT (draft_theme ? 'primary') OR draft_theme->>'primary' ~ '^#[0-9a-fA-F]{6}$'
);

-- The same rule for the published copy (Publish copies draft -> published).
ALTER TABLE sites ADD CONSTRAINT sites_published_primary_hex CHECK (
  published_theme IS NULL OR NOT (published_theme ? 'primary') OR published_theme->>'primary' ~ '^#[0-9a-fA-F]{6}$'
);

-- The main branch is what the website shows first: it cannot be switched off.
ALTER TABLE branches ADD CONSTRAINT branches_main_is_active CHECK (NOT is_main OR is_active);

-- migrate:down
ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_main_is_active;
ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_published_primary_hex;
ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_theme_primary_hex;
ALTER TABLE branch_hours DROP CONSTRAINT IF EXISTS branch_hours_no_overlap;
