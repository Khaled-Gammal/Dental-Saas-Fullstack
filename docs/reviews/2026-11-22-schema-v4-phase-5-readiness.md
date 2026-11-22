# Schema v4 audit, phases 4–5: indexes and readiness (2026-11-22)

This follows phase 3 (`2026-11-22-schema-v4-phase-3-scheduling-money.md`). The user said "ok" to skip phase 4 and run phase 5.

## Phase 4: indexes

Closed with no migration. The 110 foreign keys without a leading index point at rows the API never deletes (members, doctors, branches, appointments, visits), or at parents whose children already have an index starting with `tenant_id`. None has a query to show for an index, and each index would cost writes on the busiest tables (audit §7).

## Phase 5: readiness

- **Dev DB migrated.** `pnpm db:migrate` applied 0070–0076 to `dental` (now at `20261202000076`). The pre-checks of 0072 and 0074 found nothing.
- **Schema checked.** `pg_dump --schema-only` of the dev DB equals the dump of `dental_test` (built from the migrations), apart from the test-only `test` schema, the `dblink` extension and pg_dump's random `\restrict` token.
- **`database/schema_v4.sql`:** that dump with a header (reference only; how to regenerate it is in the header).
- **`docs/database/schema-v4-migration-guide.md`:** each migration's objects, locks, pre-checks and `down`; the API changes and their compatibility both ways; deploy order; rollback; state of each database.

## Checks run

- `pnpm typecheck` (all 5 packages): passed.
- `pnpm db:test`: 44 files, 775 checks passed.
- The API suite was last run after the last code change (phase 3): 60 suites, 478 tests passed. Phase 5 changed no code.

## Left for decision (from the audit, not built)

- **ARC-01:** a signed tenant context, so that SQL injection could not switch clinics.
- **SEC-07:** row-level security, or definer-only reads, on `users` and `legal_acceptances`.
- **WRK-01:** per-clinic worker jobs under `SET LOCAL ROLE app_user`.
- Whether to drop the 14 tables the API doesn't use.

Nothing is committed. The work is on branch `v4/schema-audit`.
