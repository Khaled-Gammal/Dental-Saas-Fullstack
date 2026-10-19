-- migrate:up
-- Phase F3 (CLR-07, database design F-01): clinic websites are Arabic only. New sites start with {ar} and existing ones
-- are set to {ar}. The column, its CHECK and every `_en` column and value stay (no destructive change); English
-- content is still shown where no Arabic exists. Nothing reads `locales` today, so no behaviour changes.
ALTER TABLE sites ALTER COLUMN locales SET DEFAULT '{ar}';
UPDATE sites SET locales = '{ar}' WHERE locales <> '{ar}';

-- migrate:down
-- Only the default goes back. Every site was {ar,en} before (the old default; no screen ever changed it), so a full
-- rollback that needs the old values can run: UPDATE sites SET locales = '{ar,en}';
ALTER TABLE sites ALTER COLUMN locales SET DEFAULT '{ar,en}';
