# Database backups (Phase 1B)

A small container (`docker/backup`) runs `pg_dump` every night, encrypts the dump, uploads it to an S3-compatible
bucket, and deletes old backups. A second command restores the latest backup into a throwaway server and checks it.

| What | How |
|---|---|
| Format | `pg_dump --format=custom --compress=6`: the whole database (schema, data, grants, policies), restorable with `pg_restore` |
| Encryption | AES-256-CBC, key derived from `BACKUP_PASSPHRASE` (PBKDF2-SHA256, 200,000 rounds). The unencrypted dump never touches the disk |
| Integrity | a `.sha256` file next to each dump, uploaded last: a dump without one is an incomplete upload and is ignored (and removed after the retention period) |
| Check before upload | the new file is decrypted and its table of contents read (`pg_restore --list`); a dump with no table data fails the run |
| Schedule | `BACKUP_CRON` (default 02:15, `TZ=Africa/Cairo`): before the 03:15–04:30 nightly clean-up jobs, long before the clinics open |
| Retention | `BACKUP_RETENTION_DAYS` (30); the newest `BACKUP_KEEP_MIN` (7) are never deleted, so a clock or cron fault cannot empty the bucket |
| Alerts | `BACKUP_HEALTHCHECK_URL`: pinged at start, on success and on failure (`/start`, `/fail`). Use a heartbeat check that alerts when no success arrives for about 25 hours |
| Names | `dental-20261031T001500Z.dump.enc` (UTC time, sorts by date) |

## Set up (production)

1. **A bucket** on Cloudflare R2 (or S3 / B2), in a different account or at least a different provider from the
   server. Create an access key limited to that bucket. Turn on object versioning or a lifecycle "keep deleted
   versions 7 days" rule if the provider has it, so a stolen key cannot erase the history at once.
2. **A database role** that can read everything (the development init script creates it with a dev password):
   ```sql
   CREATE ROLE app_backup LOGIN PASSWORD '<long random>' NOSUPERUSER BYPASSRLS IN ROLE pg_read_all_data;
   ```
   `BYPASSRLS` is needed because `pg_dump` refuses to run where row-level security would hide rows; the role can write
   nothing. On a development database created before this change:
   `docker compose exec postgres psql -U postgres -c "CREATE ROLE app_backup LOGIN PASSWORD 'app_backup_dev' NOSUPERUSER BYPASSRLS IN ROLE pg_read_all_data"`
3. **The passphrase**: `openssl rand -hex 32` (letters and digits only: Docker Compose expands `$` in env files, which
   would silently change a passphrase that contains one). Store it in the password manager *before* the first backup.
   Lost passphrase = no restore. Leaked passphrase + bucket = every clinic's records.
4. `cp docker/backup/backup.env.example docker/backup/backup.env`, fill it in (it is git-ignored).
5. Add the `backup` service from `docker-compose.backup.yml` to the production compose file (or pass both files), then
   `docker compose ... up -d --build backup`.
6. Run one now and check it arrived: `docker compose ... run --rm backup once`.
7. Run the restore check (below) once. Only then call backups done.

The backup image is `postgres:16-alpine`: `pg_dump` must be the server's major version or newer. When the database
moves to PostgreSQL 17, change the image in `docker/backup/Dockerfile` in the same change.

## Restore check (monthly, and after any change to the database or this setup)

```bash
docker compose -f docker-compose.yml -f docker-compose.backup.yml --profile restore-check run --rm restore-check
docker compose -f docker-compose.yml -f docker-compose.backup.yml --profile restore-check rm -sf restore-db
```

It downloads the newest complete backup, checks its SHA-256, decrypts it, restores it into a new database on the
throwaway `restore-db` server (data in memory), prints the number of clinics, patients, appointments and the last
migration, and drops it. It fails when the newest backup is older than `RESTORE_MAX_AGE_HOURS` (36), when the
checksum or the passphrase is wrong, when `pg_restore` reports any error, or when there are no clinics. The roles the
dump refers to (`app_definer`, `app_user`, `app_worker`, `app_platform`) are created there without login; if the
production tables are owned by a role other than `postgres` (a managed database's admin user), add it to
`RESTORE_ROLES`.

To run it on a schedule, a host crontab line is enough (the 1st of each month, 05:00):
`0 5 1 * * cd /srv/dental && docker compose ... --profile restore-check run --rm restore-check; docker compose ... --profile restore-check rm -sf restore-db`
and set `RESTORE_HEALTHCHECK_URL` to a monthly heartbeat check.

## Restoring for real

1. Stop the API and the worker (nothing may write while you restore).
2. Download the backup and its `.sha256`, check it: `sha256sum -c dental-<time>.dump.enc.sha256`.
3. Decrypt:
   `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass env:BACKUP_PASSPHRASE -in dental-<time>.dump.enc -out restore.dump`
   (keep `restore.dump` on an encrypted disk and delete it afterwards: it is every clinic's data in the clear).
4. Into a **new** database (keep the broken one until you are sure):
   `createdb -O postgres dental_restored && pg_restore --exit-on-error -d dental_restored restore.dump`
   The roles must exist first (step 2 of the set-up, plus the app roles).
5. Point `DATABASE_URL`, `DATABASE_WORKER_URL` and `DATABASE_PLATFORM_URL` at it (or rename the databases), start the
   API and the worker, check `/health` and `/health/worker`, sign in to a clinic.
6. Everything written after the backup's time is lost (up to a day): tell the clinics which day to re-check.

Uploaded files (images, documents) live in object storage, not in the database: turn on versioning on that bucket too.

## Known limits

- The passphrase sits on the server next to the bucket key, so whoever takes the server can read the backups too (they
  can read the live database anyway). The checksum detects a damaged file, not a deliberate change by someone with
  write access to the bucket. If that matters later, switch to `age` with a public key on the server and the private
  key offline.
- If listing the bucket fails, the run uploads the new backup, deletes nothing and reports a failure.

The SRS (NFR-07) also asks for continuous WAL archiving (restore to any minute in the last 7 days). Nightly dumps give
"yesterday at 02:15" at worst. WAL archiving (WAL-G or pgBackRest to the same bucket) is the next step once the first
clinics are live; it does not replace these dumps, which stay the simple, independent copy.
