# Schema v4 audit, phase 2: referential integrity (2026-11-22)

This follows phase 1 (`2026-11-22-schema-v4-phase-1-security.md`); the user said "ok". The findings are in
`docs/database/schema-v3-audit.md`.

## What changed

Migrations only: no API change was needed, because the API already follows both rules.

| Migration | Finding | What it does |
|---|---|---|
| `20261202000074_doctor_schedule_branch` | INT-01 | Adds foreign key `doctor_schedules (doctor_id, branch_id) → doctor_branches`, `DEFERRABLE INITIALLY DEFERRED`, NO ACTION. A schedule always names one of the doctor's branches. The check waits for COMMIT because `replaceBranches` deletes every link of the doctor and links the kept ones again in one transaction. NO ACTION accepts a link deleted and added again; a schedule left at a removed branch is refused at COMMIT. Existing rows are checked first (0 on `dental_test` and on the dev DB). |
| `20261202000075_appointment_move_guard` | SCH-02 | An appointment's time, doctor and branch change only while it is `held`, `pending` or `confirmed`. Applies to every role. The trigger is `BEFORE UPDATE OF starts_at, ends_at, doctor_id, branch_id`, so status-only updates (check-in, completion, the no-show job) don't run it. I first checked that nothing moves a later appointment: the API's `move()`/`selfMove()`, every SQL function, and the seeds. |
| `20261202000076_data_exports_policy` | PERF-01 | The `data_exports` policy is recreated with `=`, the indexable form every other table has had since 0004. `tenant_id` is NOT NULL, so the rows are the same. |

I chose a foreign key over the trigger the plan named for INT-01: it is declarative and needs no code to maintain.

### Tests

New `packages/db/test/42_v4_integrity.sql`, 16 checks:
- a schedule at a branch the doctor doesn't work at is refused, on insert and on update;
- removing a branch while its schedule stays is refused;
- the API's own remove-a-branch sequence passes and keeps the other branch's schedule;
- pending appointments move;
- completed, cancelled and checked-in ones don't, for every role;
- status, notes and room changes are unaffected;
- the export policy text is the `=` form, and clinics stay isolated.

## Checks run

- `pnpm db:test`: 42 files, **762 checks passed**.
- 0076, 0075 and 0074 rolled back on `dental_test`, then applied again.
- `pnpm --filter @dental/api test` against `dental_test`: **60 suites, 478 tests passed**. This covers doctor branch and schedule edits, moves, patient self-service moves, check-in and completion.

## Deploy notes

- No API change, so these migrations can go out alone.
- A schedule at a foreign branch, or a move of a finished appointment, would now fail. The API refuses both earlier with its own messages, so users don't see the database errors.
- The dev DB has no row the foreign key would reject (checked read-only). Not applied to it yet (phase 5).

## Next

Phase 3 changes the API only:
- SCH-03: hold expiry from the database clock.
- FIN-02: the payment idempotency key read after the invoice lock.

It also adds a test with two sessions for double booking, the expired hold and a duplicate payment key.
