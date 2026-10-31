-- Runs once, the first time the postgres container starts with an empty volume.
-- Dev-only passwords. In production these roles are created by ops with secrets.

CREATE ROLE app_definer NOLOGIN BYPASSRLS;                                   -- owns SECURITY DEFINER lookups
CREATE ROLE app_user   LOGIN PASSWORD 'app_user_dev'   NOSUPERUSER NOBYPASSRLS;  -- the API
CREATE ROLE app_worker LOGIN PASSWORD 'app_worker_dev' NOSUPERUSER BYPASSRLS;    -- queue workers / jobs
CREATE ROLE app_platform LOGIN PASSWORD 'app_platform_dev' NOSUPERUSER NOBYPASSRLS; -- the platform admin panel (review R11)
-- Phase 1B: nightly backups (docker/backup). Reads every row of every clinic, writes nothing; BYPASSRLS because pg_dump
-- refuses to run where row-level security would hide rows.
CREATE ROLE app_backup LOGIN PASSWORD 'app_backup_dev' NOSUPERUSER BYPASSRLS IN ROLE pg_read_all_data;

CREATE DATABASE dental_test;   -- used by integration tests (dental is created by POSTGRES_DB)
