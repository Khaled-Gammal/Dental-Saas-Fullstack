-- migrate:up
-- Phase 2E: the patient's own link to cancel or move their booking (from the confirmation and reminder emails).
-- `manage_token_hash` (since 0001) holds the hash of the link's secret; the link itself is never stored.

-- How many times the patient moved this booking from their link (the clinic allows a fixed number; staff moves do not count).
-- The check is NOT VALID: every existing row holds the default 0, and validating would scan the table under the
-- ALTER's exclusive lock; new and updated rows are checked all the same.
ALTER TABLE appointments ADD COLUMN patient_reschedules smallint NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD CONSTRAINT appointments_patient_reschedules CHECK (patient_reschedules >= 0) NOT VALID;

-- The status machine, plus one move: a confirmed booking the patient moves to another time goes back to "pending"
-- when the clinic confirms website bookings by hand (it confirmed the old time, not the new one). Only together with a
-- new start time, so nothing else can un-confirm a booking.
CREATE OR REPLACE FUNCTION appointments_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF OLD.status = 'confirmed' AND NEW.status = 'pending' AND NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN
    NEW.confirmed_at := NULL;
    RETURN NEW;
  END IF;
  IF (OLD.status, NEW.status) NOT IN (
      ('held','expired'), ('held','pending'), ('held','confirmed'), ('held','cancelled'),
      ('pending','confirmed'), ('pending','checked_in'), ('pending','cancelled'), ('pending','no_show'),
      ('confirmed','checked_in'), ('confirmed','cancelled'), ('confirmed','no_show'),
      ('checked_in','in_progress'), ('checked_in','completed'), ('checked_in','cancelled'),
      ('in_progress','completed')) THEN
    RAISE EXCEPTION 'appointment cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- migrate:down
CREATE OR REPLACE FUNCTION appointments_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF (OLD.status, NEW.status) NOT IN (
      ('held','expired'), ('held','pending'), ('held','confirmed'), ('held','cancelled'),
      ('pending','confirmed'), ('pending','checked_in'), ('pending','cancelled'), ('pending','no_show'),
      ('confirmed','checked_in'), ('confirmed','cancelled'), ('confirmed','no_show'),
      ('checked_in','in_progress'), ('checked_in','completed'), ('checked_in','cancelled'),
      ('in_progress','completed')) THEN
    RAISE EXCEPTION 'appointment cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
ALTER TABLE appointments DROP COLUMN IF EXISTS patient_reschedules;
