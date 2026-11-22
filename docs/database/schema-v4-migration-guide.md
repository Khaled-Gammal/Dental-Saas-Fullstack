# Schema v4: migrations, deploy order and rollback

The changes from the schema v3 audit (`docs/database/schema-v3-audit.md`). Schema v4 is the live schema: migrations
0001–0069, plus the seven below, plus four small API changes. A generated snapshot of the result is in
`database/schema_v4.sql` (reference only). Phase reviews: `docs/reviews/2026-11-22-schema-v4-phase-{1,2,3}-*.md`.

## The migrations

All seven are additive: new triggers, functions, one foreign key, a recreated policy, and REVOKEs. None rewrites rows. The two that depend on existing data check it first and stop with a message instead of changing anything.

| # | File | Findings | Objects | Lock / cost | Pre-check | `down` |
|---|---|---|---|---|---|---|
| 0070 | `owner_role_guard` | SEC-02 | functions `acting_member_is_owner()`, `is_owner_role(uuid)`; triggers on `tenant_members`, `invitations`, `roles` | brief SHARE ROW EXCLUSIVE per table; per-row cost only when role, status, branches or permissions are written | – | drops the triggers and functions |
| 0071 | `clinic_role_inserts` | SEC-03, SEC-04, SEC-08 | insert triggers on `domains`, `subscriptions`; REVOKE INSERT `usage_counters` (app_user); REVOKE ALL `schema_migrations` (app_user, app_worker) | brief, on 2 small tables | – | drops the triggers, gives the grants back as 0002/0046 left them |
| 0072 | `public_image_kinds` | SEC-05 | function `public_image_guard()`; triggers on `tenants`, `doctors`, `services`, `branches`, `sites`, `posts`, `gallery_items` (only `UPDATE OF` the image columns, plus INSERT); `file_is_public()` replaced | brief per table | stops if any image column already points at an `xray`/`clinical_photo`/`consent`/`document`/`invoice_pdf` file | drops the triggers, restores the old `file_is_public()` |
| 0073 | `caller_bound_definers` | SEC-01, SEC-06 | `request_clinic_deletion()` replaced (same signature); `member_access_state()` dropped and re-created with one more column, `user_active` | instant | – | restores both earlier bodies |
| 0074 | `doctor_schedule_branch` | INT-01 | FK `doctor_schedules (doctor_id, branch_id) → doctor_branches`, `DEFERRABLE INITIALLY DEFERRED` | validates while it is added: reads both tables (small) | stops if a schedule names a branch its doctor doesn't work at | drops the FK |
| 0075 | `appointment_move_guard` | SCH-02 | function and trigger `appointments_move_guard` (`BEFORE UPDATE OF starts_at, ends_at, doctor_id, branch_id`) | brief SHARE ROW EXCLUSIVE on `appointments`; nothing on status-only updates | – | drops them |
| 0076 | `data_exports_policy` | PERF-01 | policy `tenant_isolation` on `data_exports` recreated with `=` | brief ACCESS EXCLUSIVE on a small table | – | recreates the `IS NOT DISTINCT FROM` form |

## The API changes that go with them

| Finding | File | Works against a DB without the migrations? |
|---|---|---|
| SEC-01 | `modules/clinic-data/clinic-data.repository.ts`: `requestDeletion` runs in `runAs(tenantId, …, { userId })` | yes (the old function ignores the context) |
| SEC-06 | `auth/jwt-auth.guard.ts`: refuses `user_active = false` (`account_disabled`) | yes (a missing column is ignored) |
| SCH-03 | `modules/scheduling/…`: hold expiry `now() + make_interval(mins => 10)` in SQL | yes (no schema change) |
| FIN-02 | `modules/billing/billing.service.ts`: idempotency key read after the invoice lock | yes (no schema change) |

## Deploy order (production)

1. **Before:** nothing new to create. The roles are the existing ones; `app_platform` has existed since 0062.
2. Run the migrations as the migration role: `pnpm db:migrate`, or dbmate with `DATABASE_ADMIN_URL`. If 0072 or 0074 stops, its message names the table and the number of rows. Fix those rows by hand and run again; nothing was half applied (each migration is one transaction).
3. Deploy the API straight away.
   - Between steps 2 and 3 everything keeps working except **"delete the clinic"**. The old API calls `request_clinic_deletion()` with no clinic context, which 0073 refuses (on purpose).
   - The old API ignores the new `user_active` column.
4. Check that `select max(version) from schema_migrations` is `20261202000076`, then run the smoke tests:
   - sign in;
   - invite staff;
   - move a pending appointment;
   - take a payment;
   - place an online booking hold.

## Rollback

- **API:** can be rolled back on its own. The old API works against the new schema, except clinic deletion (above).
- **Database:**
  - `node packages/db/scripts/dbmate.mjs rollback` undoes the newest migration. Run it once per migration, newest first.
  - Every `down` was run, and the `up` run again, on `dental_test` (2026-11-22).
  - Rolling back reopens the gaps the migrations closed; it deletes no data.
  - Roll back 0073 only together with the API, or the new guard loses the account check (it is null-safe).
- **Dev DB:** never roll back. It holds the user's own test data. Patch forward with a new migration, as before.

## Potentially destructive operations

Nothing drops a table or column, deletes rows or rewrites data. These statements remove or replace something, and each is restored by its migration's `down`:

| Migration | Statement | Why it is safe |
|---|---|---|
| 0073 | `DROP FUNCTION member_access_state(uuid)`, then `CREATE` with one more result column | A function's result type can't change in place. The drop and create run in one transaction, with owner and grants set again. The API reads columns by name. |
| 0073 | `CREATE OR REPLACE FUNCTION request_clinic_deletion` | Same signature and messages. It refuses callers from outside the clinic (intended, SEC-01). |
| 0072 | `CREATE OR REPLACE FUNCTION file_is_public` | Same answers, except for clinical files. |
| 0076 | `DROP POLICY` / `CREATE POLICY tenant_isolation ON data_exports` | Same rows (`tenant_id` is NOT NULL), one transaction. |
| 0071 | `REVOKE INSERT ON usage_counters`, `REVOKE ALL ON schema_migrations` | Removes rights the API never used. dbmate runs as the admin role. |
| `down` sections | `DROP TRIGGER` / `DROP FUNCTION` / `DROP CONSTRAINT` of objects the migration itself created | Reopens the gap; no data involved. |

The rules the migrations add can make a later write fail. Each rule is one the API already applies, and the API checks it first with its own message:
- giving the owner role;
- adding a domain or subscription;
- using a clinical file as an image;
- a schedule at a foreign branch;
- moving a finished appointment.

## A database built from the original `dental_saas_schema_3.sql`

No environment of this project was built that way: dbmate starts every database at 0001. 0001 is the v3 file plus some `appointments` additions made before the first deploy (64 lines of diff):
- the booking-code columns and their checks;
- the staff-author rule;
- `override_reason`;
- the `appointments_open_code` index;
- `check_in_by_code()`.

For such a database:

1. `psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f database/v3-to-0001.sql`. This adds exactly that difference and records 0001 in `schema_migrations`. It changes no rows, and it stops if existing appointments break the 0001 rules.
2. `pnpm db:migrate`, which applies 0002–0076.

**Tested 2026-11-22** on a scratch database (`dental_v3_check`, dropped afterwards):
- the v3 file loaded on PostgreSQL 16.14 (75 tables);
- then the bridge, then 0002–0076 (75 migrations), then the seeds;
- then all 44 SQL test files: **775 checks passed, 0 failed**.

Its final schema matched the freshly built `dental_test` exactly: columns, constraint definitions, indexes, function bodies and their grants, triggers, policies, RLS flags, and table and column grants. Only column order and auto-generated constraint names were left out of the comparison; no later migration depends on an `appointments` constraint name.

## Production deployment checklist

- [ ] Back up first (`docs/ops/backups.md`) and note the current `max(version)` of `schema_migrations` (expected `20261201000069`).
- [ ] Run the pre-checks read-only, or let the migrations run them:
  - `SELECT count(*) FROM doctor_schedules s WHERE NOT EXISTS (SELECT 1 FROM doctor_branches db WHERE db.doctor_id = s.doctor_id AND db.branch_id = s.branch_id)` must return 0;
  - no image column points at a clinical file: run 0072's DO block as a SELECT.
- [ ] `pnpm db:migrate` with the admin URL. Expect 7 migrations, each a few milliseconds. The longest lock is on `appointments` and `tenant_members`, and only while the trigger is created.
- [ ] Deploy the API build from this branch right after: guard, clinic data, scheduling and billing changes. Note the "delete the clinic" window above.
- [ ] Check that `select max(version) from schema_migrations` is `20261202000076`.
- [ ] Smoke test:
  - staff sign-in;
  - the owner invites a member;
  - a non-owner manager edits a non-owner;
  - book, move and check in an appointment;
  - take a payment and refund it;
  - place a website hold, then confirm it;
  - an owner's clinic export.
- [ ] Watch the API's 4xx/5xx for `rule_violation` / `insufficient_privilege` in the first hour. A new rule hit by a real path shows there, and the fix is a new migration, not a rollback.
- [ ] Roles: these migrations create and alter none. `app_user` and `app_platform` stay NOBYPASSRLS; `app_worker` and `app_backup` keep BYPASSRLS, as before.

## ARC-01: signed clinic context (0077, 0078)

Design: `docs/database/arc-01-signed-tenant-context.md`. Reviews:
- `docs/reviews/2026-11-22-arc-01-phase-1-signed-context.md`
- `docs/reviews/2026-11-22-arc-01-phase-2-enforce.md`
- `docs/reviews/2026-11-22-arc-01-phase-3-patient-scope.md`

**0079 has no ordering constraint:** it works with the old API and with the signing one. **A new table** needs a patient policy in its migration (`patient_scope` to deny, or the mode it needs); `45_arc_patient_scope.sql` fails until it has one.

| # | File | What | `down` |
|---|---|---|---|
| 0077 | `signed_tenant_context` | key table and mode table (definer-only); `enter_context()` / `enter_host_context()`; verified readers; 70 policies + `tenant_self` + outbox on `(SELECT current_tenant_id())`; mode **permissive** | restores the plain readers and policies, drops the new objects |
| 0078 | `enforce_signed_context` | mode **enforce**: unsigned contexts give no clinic for logins that don't bypass RLS | back to permissive |
| 0079 | `patient_context_scope` | 112 RESTRICTIVE `patient_scope*` policies (read / files / read_write / insert_only / deny); `appointments_clinical_follow()` and `next_tenant_counter()` as definer functions | drops the policies, restores both functions and the grants |

**Order. The key comes first; enforce comes last.**

1. Generate `TENANT_CONTEXT_KEY`: at least 32 random bytes, for example `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`. Keep it with the other secrets. Set `TENANT_CONTEXT_KEY_ID=1`. Production refuses to start with the dev key.
2. Apply **0077** (permissive) while the old API still runs; nothing changes for it. dbmate applies every pending file, so ship this as **two releases**: release 1 carries 0077 with the signing API, and release 2 carries 0078. If both go out in one deploy, the migrations run before the new API starts, and old instances see empty clinics for that window. That is a few seconds with one instance; it gives wrong-looking pages, but never wrong data.
3. Run `pnpm db:context-key` with the production `TENANT_CONTEXT_KEY` / `TENANT_CONTEXT_KEY_ID` and the admin URL.
4. Deploy the signing API (this branch) to **every** API instance. Check that sign-in, the dashboard, the website, online booking and invite acceptance work. They now sign; permissive still accepts the old instances during the roll.
5. Once no old API instance is left, apply **0078** (`pnpm db:migrate`).
6. Check:
   - `SELECT mode FROM app_context_settings` returns `enforce`;
   - smoke-test the same flows;
   - watch for `insufficient_privilege` / "clinic context signature" errors. A request that is not signed would show "not found" or empty lists, not an error, so check the dashboard home and the website too.

**Emergency switch back.** No migration and no deploy, as the admin role:

```sql
UPDATE app_context_settings SET mode = 'permissive', updated_at = now();
```

The signing API keeps working in either mode.

**Key rotation:**
1. Add the new key with a new id: `TENANT_CONTEXT_KEY_ID=2`, then `pnpm db:context-key`.
2. Deploy the API with id 2.
3. Retire id 1: `UPDATE app_context_keys SET retired_at = now() WHERE id = 1`.

A retired key signs nothing new. Transactions already open keep their proof until they end.

**Who is affected by enforce:**
- Only logins that do not bypass RLS, which means `app_user` (the API) and `app_platform`. The platform panel does not use a clinic context.
- The migration role, `app_worker` and `app_backup` keep the plain settings: they read every row anyway.
- A tool or script that logs in as `app_user` and sets `app.tenant_id` itself stops seeing clinic rows. Two SQL tests did that and now sign (`test.enter_sql()` in `00_helpers.sql`).

## Status

| Database | State |
|---|---|
| `dental_test` | rebuilt by `pnpm db:test` on every run; 0070–0076 included |
| `dental` (dev) | migrated to `20261202000076` on 2026-11-22. The pre-checks found nothing (0 schedules at a foreign branch, 0 clinical files used as images). Its schema dump equals the one built from migrations, apart from the test helpers. |
| production | not deployed |

## Tests that cover these changes

| Tests | Checks |
|---|---|
| `packages/db/test/41_v4_security.sql` | 53 |
| `42_v4_integrity.sql` | 16 |
| `43_v4_concurrency.sql` | 13, with two sessions |
| `01`, `17`, `32` | adjusted to the new rules |
| API e2e: `staff` (deactivated account), `billing` (concurrent duplicate payment), `booking` (hold expiry from the database) | |

Full runs on 2026-11-22:
- `pnpm db:test` (fresh database from 0001): 44 files / 775 checks.
- The same 44 files on the v3-file database (above): 775 checks.
- API: 60 suites / 478 tests.
- `pnpm db:types` after the migrations: no change to `packages/db/src/database.ts` (the Kysely types match the schema).
