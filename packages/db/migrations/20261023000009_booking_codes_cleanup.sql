-- migrate:up
-- Booking codes must not outlive the visit they belong to. `appointments_open_code` keeps an unused code unique per
-- clinic; a code left on a cancelled, no-show or expired appointment would occupy that space forever and new
-- random codes would start colliding. Clear it the moment the appointment reaches a final state that never uses it.
CREATE OR REPLACE FUNCTION appointments_clear_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'no_show', 'expired') AND NEW.check_in_code_used_at IS NULL THEN
    NEW.check_in_code_hash := NULL;
    NEW.check_in_code_expires_at := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointments_clear_code BEFORE UPDATE OF status ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_clear_code();

-- One-time cleanup of codes that can no longer be used: final or already-arrived appointments, and expired codes.
UPDATE appointments SET check_in_code_hash = NULL, check_in_code_expires_at = NULL
WHERE check_in_code_hash IS NOT NULL AND check_in_code_used_at IS NULL
  AND (status IN ('cancelled', 'no_show', 'expired', 'checked_in', 'in_progress', 'completed') OR check_in_code_expires_at < now());

-- migrate:down
DROP TRIGGER IF EXISTS appointments_clear_code ON appointments;
DROP FUNCTION IF EXISTS appointments_clear_code();
