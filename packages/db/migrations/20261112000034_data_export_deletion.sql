-- migrate:up
-- Phase H8 (NFR-08, owner 2026-10-20): the owner exports all the clinic's data, and deletes the clinic.
-- Export: a background job builds one ZIP (a CSV and a JSON file per kind of data, and every uploaded file); the owner
-- downloads it from the dashboard. Deletion: the owner confirms with their password and the clinic's name; the clinic
-- closes at once (status 'cancelled': no sign-in, website offline) and its data is kept 90 days, during which the
-- platform admin can restore it; then the worker erases it for good, files included.

-- ---------- export ----------
CREATE TABLE data_exports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'queued'
                CONSTRAINT data_exports_status CHECK (status IN ('queued', 'running', 'ready', 'failed', 'expired')),
  object_key    text,
  size_bytes    bigint,
  files_count   int,
  error         text CHECK (char_length(error) <= 500),
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  expires_at    timestamptz,
  CONSTRAINT data_exports_ready CHECK (status <> 'ready' OR (object_key IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE INDEX data_exports_tenant ON data_exports (tenant_id, created_at DESC);
-- one export in the making per clinic
CREATE UNIQUE INDEX data_exports_one_open ON data_exports (tenant_id) WHERE status IN ('queued', 'running');
ALTER TABLE data_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON data_exports
  USING (tenant_id IS NOT DISTINCT FROM current_tenant_id()) WITH CHECK (tenant_id IS NOT DISTINCT FROM current_tenant_id());
-- the API asks for one and reads them; only the worker builds, finishes and expires them
REVOKE ALL ON data_exports FROM app_user;
GRANT SELECT ON data_exports TO app_user;
GRANT INSERT (tenant_id, requested_by) ON data_exports TO app_user;

-- ---------- deletion ----------
-- deleted_at (since 0001, unused until now) = when deletion was requested; delete_after = when the data goes for good
ALTER TABLE tenants
  ADD COLUMN delete_after                timestamptz,
  ADD COLUMN deletion_requested_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN status_before_cancellation  text,
  ADD CONSTRAINT tenants_deletion CHECK ((deleted_at IS NULL) = (delete_after IS NULL));
GRANT UPDATE (deleted_at, delete_after, deletion_requested_by, status_before_cancellation) ON tenants TO app_definer;

-- the platform's own records outlive a deleted clinic (they lose the link, the details keep its id and name)
ALTER TABLE platform_audit_log DROP CONSTRAINT platform_audit_log_tenant_id_fkey,
  ADD CONSTRAINT platform_audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE webhook_events DROP CONSTRAINT webhook_events_tenant_id_fkey,
  ADD CONSTRAINT webhook_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
-- platform_invoices keep their restriction: a clinic the platform invoiced is not erased silently (the purge reports it)

-- Links between a clinic's own tables (a refund to its branch, an invoice to its patient…) are checked as each table is
-- emptied, and a cascade empties them in no particular order. They become DEFERRABLE INITIALLY IMMEDIATE: checked
-- exactly as before, except inside the erase, which defers them to its end (SET CONSTRAINTS ALL DEFERRED).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname, conrelid::regclass AS tbl FROM pg_constraint
           WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND confdeltype = 'a' AND NOT condeferrable
  LOOP
    EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE', r.tbl, r.conname);
  END LOOP;
END $$;

-- The owner asks: checked here again (the API checked the password and the typed name). Everyone's session ends at
-- their next request. Returns when the data will be erased.
CREATE OR REPLACE FUNCTION request_clinic_deletion(p_user uuid, p_tenant uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text; v_after timestamptz := now() + interval '90 days';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_members m JOIN roles r ON r.id = m.role_id
                 WHERE m.user_id = p_user AND m.tenant_id = p_tenant AND m.status = 'active' AND r.key = 'owner') THEN
    RAISE EXCEPTION 'only the clinic owner deletes the clinic' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'clinic_owner_only';
  END IF;
  SELECT status INTO v_status FROM tenants WHERE id = p_tenant FOR UPDATE;
  IF v_status IN ('suspended', 'cancelled') THEN
    RAISE EXCEPTION 'the clinic is %', v_status USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_status';
  END IF;
  UPDATE tenants SET status = 'cancelled', status_before_cancellation = v_status, deleted_at = now(), delete_after = v_after,
         deletion_requested_by = p_user, updated_at = now()
   WHERE id = p_tenant;
  UPDATE tenant_members SET access_version = access_version + 1 WHERE tenant_id = p_tenant;
  -- no actor: the owner's account may itself be erased with the clinic; the request is named in the details
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (NULL, 'tenant.deletion_requested', p_tenant, jsonb_build_object('requested_by', p_user, 'delete_after', v_after));
  RETURN v_after;
END $$;
ALTER FUNCTION request_clinic_deletion(uuid, uuid) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION request_clinic_deletion(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_clinic_deletion(uuid, uuid) TO app_user;

-- Sign-in lists a deleted clinic too (until it is erased), so it can say "this clinic was deleted" instead of "you
-- belong to no clinic"; the API never opens a 'cancelled' clinic.
CREATE OR REPLACE FUNCTION memberships_for_user(p_user uuid)
RETURNS TABLE (tenant_id uuid, slug citext, name_en text, name_ar text, tenant_status text, role_key text, member_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug, t.name_en, t.name_ar, t.status, r.key, m.status
  FROM tenant_members m
  JOIN tenants t ON t.id = m.tenant_id
  JOIN roles r ON r.id = m.role_id
  WHERE m.user_id = p_user
$$;

-- The panel lists a deleted clinic too, until it is erased (platform_deletions says when).
CREATE OR REPLACE FUNCTION platform_clinics(p_actor uuid)
RETURNS TABLE (id uuid, slug text, name_ar text, name_en text, status text, created_at timestamptz, suspended_at timestamptz,
               suspension_reason text, suspension_kind text,
               plan_code text, plan_name_ar text, subscription_status text, trial_ends_at timestamptz, billing_cycle text, current_period_end timestamptz,
               members int, branches int, patients int, appointments_30d int, last_login_at timestamptz, owner_email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN QUERY
  SELECT t.id, t.slug::text, t.name_ar, t.name_en, t.status, t.created_at, t.suspended_at, t.suspension_reason, t.suspension_kind,
         p.code, p.name_ar, s.status, s.trial_ends_at, s.billing_cycle, s.current_period_end,
         (SELECT count(*)::int FROM tenant_members m WHERE m.tenant_id = t.id AND m.status = 'active'),
         (SELECT count(*)::int FROM branches b WHERE b.tenant_id = t.id AND b.is_active),
         (SELECT count(*)::int FROM patients pa WHERE pa.tenant_id = t.id AND pa.deleted_at IS NULL),
         (SELECT count(*)::int FROM appointments a WHERE a.tenant_id = t.id AND a.starts_at > now() - interval '30 days' AND a.starts_at <= now()),
         (SELECT max(u.last_login_at) FROM tenant_members m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = t.id),
         (SELECT u.email::text FROM tenant_members m JOIN roles r ON r.id = m.role_id JOIN users u ON u.id = m.user_id
           WHERE m.tenant_id = t.id AND r.key = 'owner' AND m.status = 'active' ORDER BY m.created_at LIMIT 1)
  FROM tenants t
  LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status <> 'cancelled'
  LEFT JOIN plans p ON p.id = s.plan_id
  ORDER BY t.created_at DESC;
END $$;

-- The platform admin brings a clinic back within its 90 days, as it was before.
CREATE OR REPLACE FUNCTION platform_restore_clinic(p_actor uuid, p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_back text;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  SELECT status_before_cancellation INTO v_back FROM tenants
   WHERE id = p_tenant AND status = 'cancelled' AND delete_after IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the clinic is not waiting for deletion' USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_status';
  END IF;
  UPDATE tenants SET status = coalesce(v_back, 'active'), status_before_cancellation = NULL, deleted_at = NULL, delete_after = NULL,
         deletion_requested_by = NULL, updated_at = now()
   WHERE id = p_tenant;
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (p_actor, 'tenant.restored', p_tenant, jsonb_build_object('to', coalesce(v_back, 'active')));
END $$;
ALTER FUNCTION platform_restore_clinic(uuid, uuid) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION platform_restore_clinic(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_restore_clinic(uuid, uuid) TO app_user;

-- The panel: clinics waiting for deletion, with when it was asked and when the data goes.
CREATE OR REPLACE FUNCTION platform_deletions(p_actor uuid)
RETURNS TABLE (tenant_id uuid, requested_at timestamptz, delete_after timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN QUERY SELECT t.id, t.deleted_at, t.delete_after FROM tenants t WHERE t.delete_after IS NOT NULL ORDER BY t.delete_after;
END $$;
ALTER FUNCTION platform_deletions(uuid) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION platform_deletions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_deletions(uuid) TO app_user;

-- ---------- the worker's side: run as app_worker (BYPASSRLS), never by the API ----------
-- Clinics whose 90 days are over.
CREATE OR REPLACE FUNCTION clinics_due_for_purge() RETURNS SETOF uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT id FROM tenants WHERE status = 'cancelled' AND delete_after IS NOT NULL AND delete_after <= now() ORDER BY delete_after
$$;

-- Every storage object of a clinic: private files as stored, images as their renditions (the original is not kept),
-- and its data exports.
CREATE OR REPLACE FUNCTION clinic_object_keys(p_tenant uuid) RETURNS SETOF text
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT f.object_key FROM files f WHERE f.tenant_id = p_tenant AND coalesce(cardinality(f.variant_widths), 0) = 0
  UNION ALL
  SELECT f.object_key || '/' || w || '.webp' FROM files f, unnest(f.variant_widths) w WHERE f.tenant_id = p_tenant
  UNION ALL
  SELECT e.object_key FROM data_exports e WHERE e.tenant_id = p_tenant AND e.object_key IS NOT NULL
$$;

-- Erases one clinic (its objects are deleted by the worker first). Everything with its tenant_id goes by cascade; the
-- clinical and money guards stand aside for this transaction only (app.allow_hard_delete). Accounts that belonged to
-- this clinic alone (and are not platform admins) are erased too. Returns false when the clinic is not due, or when
-- the platform invoiced it (that needs a person: reported in the platform audit log).
CREATE OR REPLACE FUNCTION purge_clinic(p_tenant uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_t record; v_users uuid[]; v_user uuid; v_table text;
BEGIN
  SELECT id, slug, name_ar, name_en, deleted_at FROM tenants INTO v_t
   WHERE id = p_tenant AND status = 'cancelled' AND delete_after IS NOT NULL AND delete_after <= now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM platform_invoices WHERE tenant_id = p_tenant) THEN
    INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
    SELECT NULL, 'tenant.purge_blocked', p_tenant, jsonb_build_object('reason', 'platform_invoices')
     WHERE NOT EXISTS (SELECT 1 FROM platform_audit_log WHERE tenant_id = p_tenant AND action = 'tenant.purge_blocked');
    RETURN false;
  END IF;
  SELECT array_agg(DISTINCT user_id) INTO v_users FROM tenant_members WHERE tenant_id = p_tenant;
  INSERT INTO platform_audit_log (actor_user_id, action, tenant_id, details)
  VALUES (NULL, 'tenant.purged', p_tenant, jsonb_build_object('clinic_id', v_t.id, 'slug', v_t.slug, 'name_ar', v_t.name_ar,
          'name_en', v_t.name_en, 'requested_at', v_t.deleted_at));
  PERFORM set_config('app.allow_hard_delete', 'on', true);
  SET CONSTRAINTS ALL DEFERRED;
  DELETE FROM tenants WHERE id = p_tenant;
  -- not every table cascades from tenants (refunds hang off payments, for one): sweep every table with a tenant_id,
  -- tables added later included; the platform's own records keep their history (their link was set to NULL)
  -- (by oid, never by name: the catalogue is read in no particular order)
  FOR v_table IN SELECT c.oid::regclass::text FROM pg_class c
                 JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
                 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
                   AND c.relname NOT IN ('platform_audit_log', 'webhook_events')
                   AND has_table_privilege(c.oid, 'DELETE') -- the rest cascade (legal acceptances, platform notes)
  LOOP
    EXECUTE format('DELETE FROM %s WHERE tenant_id = $1', v_table) USING p_tenant;
  END LOOP;
  SET CONSTRAINTS ALL IMMEDIATE; -- every link checked now: nothing of the clinic is left half-deleted
  FOREACH v_user IN ARRAY coalesce(v_users, '{}') LOOP
    BEGIN
      DELETE FROM users u WHERE u.id = v_user AND u.platform_role IS NULL
         AND NOT EXISTS (SELECT 1 FROM tenant_members m WHERE m.user_id = u.id);
    EXCEPTION WHEN foreign_key_violation THEN
      NULL; -- referenced by a platform record (e.g. a note they wrote as an admin earlier): the account stays
    END;
  END LOOP;
  PERFORM set_config('app.allow_hard_delete', '', true);
  RETURN true;
END $$;

REVOKE EXECUTE ON FUNCTION clinics_due_for_purge(), clinic_object_keys(uuid), purge_clinic(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clinics_due_for_purge(), clinic_object_keys(uuid), purge_clinic(uuid) TO app_worker;

-- migrate:down
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname, conrelid::regclass AS tbl FROM pg_constraint
           WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND condeferrable AND NOT condeferred
  LOOP
    EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I NOT DEFERRABLE', r.tbl, r.conname);
  END LOOP;
END $$;
DROP TABLE IF EXISTS data_exports;
DROP FUNCTION IF EXISTS purge_clinic(uuid);
DROP FUNCTION IF EXISTS clinic_object_keys(uuid);
DROP FUNCTION IF EXISTS clinics_due_for_purge();
DROP FUNCTION IF EXISTS platform_deletions(uuid);
CREATE OR REPLACE FUNCTION platform_clinics(p_actor uuid)
RETURNS TABLE (id uuid, slug text, name_ar text, name_en text, status text, created_at timestamptz, suspended_at timestamptz,
               suspension_reason text, suspension_kind text,
               plan_code text, plan_name_ar text, subscription_status text, trial_ends_at timestamptz, billing_cycle text, current_period_end timestamptz,
               members int, branches int, patients int, appointments_30d int, last_login_at timestamptz, owner_email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM platform_assert_admin(p_actor);
  RETURN QUERY
  SELECT t.id, t.slug::text, t.name_ar, t.name_en, t.status, t.created_at, t.suspended_at, t.suspension_reason, t.suspension_kind,
         p.code, p.name_ar, s.status, s.trial_ends_at, s.billing_cycle, s.current_period_end,
         (SELECT count(*)::int FROM tenant_members m WHERE m.tenant_id = t.id AND m.status = 'active'),
         (SELECT count(*)::int FROM branches b WHERE b.tenant_id = t.id AND b.is_active),
         (SELECT count(*)::int FROM patients pa WHERE pa.tenant_id = t.id AND pa.deleted_at IS NULL),
         (SELECT count(*)::int FROM appointments a WHERE a.tenant_id = t.id AND a.starts_at > now() - interval '30 days' AND a.starts_at <= now()),
         (SELECT max(u.last_login_at) FROM tenant_members m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = t.id),
         (SELECT u.email::text FROM tenant_members m JOIN roles r ON r.id = m.role_id JOIN users u ON u.id = m.user_id
           WHERE m.tenant_id = t.id AND r.key = 'owner' AND m.status = 'active' ORDER BY m.created_at LIMIT 1)
  FROM tenants t
  LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status <> 'cancelled'
  LEFT JOIN plans p ON p.id = s.plan_id
  WHERE t.deleted_at IS NULL
  ORDER BY t.created_at DESC;
END $$;
CREATE OR REPLACE FUNCTION memberships_for_user(p_user uuid)
RETURNS TABLE (tenant_id uuid, slug citext, name_en text, name_ar text, tenant_status text, role_key text, member_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug, t.name_en, t.name_ar, t.status, r.key, m.status
  FROM tenant_members m
  JOIN tenants t ON t.id = m.tenant_id
  JOIN roles r ON r.id = m.role_id
  WHERE m.user_id = p_user AND t.deleted_at IS NULL
$$;
DROP FUNCTION IF EXISTS platform_restore_clinic(uuid, uuid);
DROP FUNCTION IF EXISTS request_clinic_deletion(uuid, uuid);
ALTER TABLE webhook_events DROP CONSTRAINT webhook_events_tenant_id_fkey,
  ADD CONSTRAINT webhook_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE platform_audit_log DROP CONSTRAINT platform_audit_log_tenant_id_fkey,
  ADD CONSTRAINT platform_audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
REVOKE UPDATE (deleted_at, delete_after, deletion_requested_by, status_before_cancellation) ON tenants FROM app_definer;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_deletion,
  DROP COLUMN IF EXISTS status_before_cancellation, DROP COLUMN IF EXISTS deletion_requested_by, DROP COLUMN IF EXISTS delete_after;
