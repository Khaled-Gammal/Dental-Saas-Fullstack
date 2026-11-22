-- migrate:up
-- Schema v4 audit, INT-01 (docs/database/schema-v3-audit.md): a doctor's weekly schedule could name a branch the doctor
-- does not work at. Bookings were already refused there (appointments_validate_doctor, 0012), so slot search offered
-- times that the booking then refused. The API keeps the two in step (doctors.repository.ts: replaceBranches drops the
-- schedules of a removed branch, replaceSchedule checks the branches); the database now holds the same rule as a
-- foreign key to the doctor's branch link.
--
-- DEFERRABLE INITIALLY DEFERRED, NO ACTION: replaceBranches deletes every link of the doctor and inserts the kept ones
-- again in one transaction, so the check waits for COMMIT. NO ACTION (not RESTRICT) accepts a link deleted and inserted
-- again; a schedule left at a branch the doctor no longer has is refused at COMMIT.

-- nothing is changed: a schedule at a foreign branch stops the migration, for a person to look at
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM doctor_schedules s
   WHERE NOT EXISTS (SELECT 1 FROM doctor_branches db WHERE db.doctor_id = s.doctor_id AND db.branch_id = s.branch_id);
  IF n > 0 THEN
    RAISE EXCEPTION '% doctor schedule row(s) name a branch the doctor does not work at; fix them before this migration', n;
  END IF;
END $$;

ALTER TABLE doctor_schedules ADD CONSTRAINT doctor_schedules_doctor_branch_fk
  FOREIGN KEY (doctor_id, branch_id) REFERENCES doctor_branches (doctor_id, branch_id) DEFERRABLE INITIALLY DEFERRED;

-- migrate:down
ALTER TABLE doctor_schedules DROP CONSTRAINT IF EXISTS doctor_schedules_doctor_branch_fk;
