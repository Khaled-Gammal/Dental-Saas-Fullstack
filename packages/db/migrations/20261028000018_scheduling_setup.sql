-- migrate:up
-- Phase D2: rescheduling, holidays, doctor time off, rooms, booking settings (SRS APPT-001, 005, 006, 009). Additive.

-- ---------------------------------------------------------------------
-- 1. Slot search for a move must not count the appointment being moved as busy. Same function, one optional
--    argument more (the old 3-argument form is replaced, callers keep working through the default).
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS doctor_busy_intervals(uuid[], timestamptz, timestamptz);
CREATE FUNCTION doctor_busy_intervals(p_doctors uuid[], p_from timestamptz, p_to timestamptz, p_exclude uuid DEFAULT NULL)
RETURNS TABLE (doctor_id uuid, starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.doctor_id, a.starts_at, a.ends_at FROM appointments a
  WHERE a.tenant_id = current_tenant_id()
    AND a.doctor_id = ANY (p_doctors) AND a.starts_at < p_to AND a.ends_at > p_from
    AND a.status IN ('held','pending','confirmed','checked_in','in_progress','completed')
    AND (a.status <> 'held' OR a.hold_expires_at > now())
    AND (p_exclude IS NULL OR a.id <> p_exclude)
$$;
ALTER FUNCTION doctor_busy_intervals(uuid[], timestamptz, timestamptz, uuid) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION doctor_busy_intervals(uuid[], timestamptz, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION doctor_busy_intervals(uuid[], timestamptz, timestamptz, uuid) TO app_user;

-- ---------------------------------------------------------------------
-- 2. Holidays: one per date and scope (one branch, or the whole clinic); who added it.
--    Doctor time off: who added it. Existing duplicates stop the migration with a message instead of being removed.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM holidays GROUP BY tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), date HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'holidays has the same date twice for one scope; remove the duplicate rows before this migration';
  END IF;
END $$;
CREATE UNIQUE INDEX holidays_one_per_scope_date ON holidays (tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), date);
ALTER TABLE holidays ADD COLUMN created_by uuid,
  ADD CONSTRAINT holidays_created_by_member_fk FOREIGN KEY (tenant_id, created_by) REFERENCES tenant_members (tenant_id, id);
ALTER TABLE holidays ADD CONSTRAINT holidays_name_length CHECK (char_length(name) BETWEEN 1 AND 100) NOT VALID;
ALTER TABLE holidays VALIDATE CONSTRAINT holidays_name_length;

ALTER TABLE doctor_time_off ADD COLUMN created_by uuid,
  ADD CONSTRAINT doctor_time_off_created_by_member_fk FOREIGN KEY (tenant_id, created_by) REFERENCES tenant_members (tenant_id, id),
  -- one leave cannot cover more than a year (a typo in the year would otherwise block a doctor for a decade)
  ADD CONSTRAINT doctor_time_off_max_length CHECK (ends_at - starts_at <= interval '366 days') NOT VALID;
ALTER TABLE doctor_time_off VALIDATE CONSTRAINT doctor_time_off_max_length;

-- ---------------------------------------------------------------------
-- 3. Reminder times: at most four, each between 15 minutes and 7 days before the visit.
-- ---------------------------------------------------------------------
ALTER TABLE tenant_settings ADD CONSTRAINT tenant_settings_reminder_offsets CHECK (
  cardinality(reminder_offsets_minutes) <= 4
  AND 15 <= ALL (reminder_offsets_minutes) AND 10080 >= ALL (reminder_offsets_minutes)) NOT VALID;
ALTER TABLE tenant_settings VALIDATE CONSTRAINT tenant_settings_reminder_offsets;

-- rooms of a branch are listed in name order
CREATE INDEX IF NOT EXISTS rooms_tenant_branch ON rooms (tenant_id, branch_id, name);

-- migrate:down
DROP INDEX IF EXISTS rooms_tenant_branch;
ALTER TABLE tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_reminder_offsets;
ALTER TABLE doctor_time_off DROP CONSTRAINT IF EXISTS doctor_time_off_max_length,
  DROP CONSTRAINT IF EXISTS doctor_time_off_created_by_member_fk, DROP COLUMN IF EXISTS created_by;
ALTER TABLE holidays DROP CONSTRAINT IF EXISTS holidays_name_length,
  DROP CONSTRAINT IF EXISTS holidays_created_by_member_fk, DROP COLUMN IF EXISTS created_by;
DROP INDEX IF EXISTS holidays_one_per_scope_date;
DROP FUNCTION IF EXISTS doctor_busy_intervals(uuid[], timestamptz, timestamptz, uuid);
CREATE FUNCTION doctor_busy_intervals(p_doctors uuid[], p_from timestamptz, p_to timestamptz)
RETURNS TABLE (doctor_id uuid, starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.doctor_id, a.starts_at, a.ends_at FROM appointments a
  WHERE a.tenant_id = current_tenant_id()
    AND a.doctor_id = ANY (p_doctors) AND a.starts_at < p_to AND a.ends_at > p_from
    AND a.status IN ('held','pending','confirmed','checked_in','in_progress','completed')
    AND (a.status <> 'held' OR a.hold_expires_at > now())
$$;
ALTER FUNCTION doctor_busy_intervals(uuid[], timestamptz, timestamptz) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION doctor_busy_intervals(uuid[], timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION doctor_busy_intervals(uuid[], timestamptz, timestamptz) TO app_user;
