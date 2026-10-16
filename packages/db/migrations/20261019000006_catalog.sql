-- migrate:up
-- Week 3 part 2: doctors + services rules the wizard relies on.

-- A catalogue service is added to a clinic's price list once (a double click, or two owners at once, must not duplicate it).
-- Custom services (no catalogue code) are unrestricted.
CREATE UNIQUE INDEX services_tenant_catalog_code ON services (tenant_id, catalog_code) WHERE catalog_code IS NOT NULL;

-- Name the doctor-schedule EXCLUDE constraint: the API maps it to the `schedule_overlap` error code,
-- and a declared name cannot drift the way an auto-generated one can.
ALTER TABLE doctor_schedules RENAME CONSTRAINT doctor_schedules_doctor_id_weekday_tsrange_excl TO doctor_schedules_no_overlap;

-- migrate:down
ALTER TABLE doctor_schedules RENAME CONSTRAINT doctor_schedules_no_overlap TO doctor_schedules_doctor_id_weekday_tsrange_excl;
DROP INDEX IF EXISTS services_tenant_catalog_code;
