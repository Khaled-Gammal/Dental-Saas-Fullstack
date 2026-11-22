-- migrate:up
-- Schema v4 audit, SCH-02 (docs/database/schema-v3-audit.md): the status machine (appointments_transition, 0001/0069)
-- fires on status changes only, so a checked-in, finished, cancelled or no-show appointment could still be given
-- another time, doctor or branch, rewriting the clinic's history. Only the API refused it (manage-appointments.usecase:
-- pending/confirmed only; selfMove: pending/confirmed only). Now the database does too, for every role. No path in
-- the API, the SQL functions or the seeds moves an appointment after it was confirmed.

CREATE FUNCTION appointments_move_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.starts_at, NEW.ends_at, NEW.doctor_id, NEW.branch_id) IS DISTINCT FROM (OLD.starts_at, OLD.ends_at, OLD.doctor_id, OLD.branch_id)
     AND OLD.status NOT IN ('held', 'pending', 'confirmed') THEN
    RAISE EXCEPTION 'a % appointment keeps its time, doctor and branch', OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'appointments_move_status';
  END IF;
  RETURN NEW;
END $$;
-- only when one of the four columns is written: status-only updates (check-in, completion, no-show jobs) cost nothing
CREATE TRIGGER appointments_move_guard BEFORE UPDATE OF starts_at, ends_at, doctor_id, branch_id ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_move_guard();

-- migrate:down
DROP TRIGGER IF EXISTS appointments_move_guard ON appointments;
DROP FUNCTION IF EXISTS appointments_move_guard();
