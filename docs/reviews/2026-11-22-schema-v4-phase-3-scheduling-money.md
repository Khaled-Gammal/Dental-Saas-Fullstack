# Schema v4 audit, phase 3: scheduling and financial integrity (2026-11-22)

This follows phase 2 (`2026-11-22-schema-v4-phase-2-integrity.md`); the user said "ok". The findings are in
`docs/database/schema-v3-audit.md`. This phase changes the API only, with no migration.

## What changed

| Finding | File | Change |
|---|---|---|
| SCH-03 | `scheduling/application/hold-slot.usecase.ts`, `ports.ts`, `infrastructure/kysely-scheduling.repository.ts` | A website hold's `hold_expires_at` used to come from the API host's clock. It is now written by the database as `now() + make_interval(mins => 10)`, on the clock that `release_expired_holds()` and the finalize step compare with. `insertHold` returns the stored value and the API answers with it. `HoldInput.holdExpiresAt` becomes `holdMinutes`, and `HoldSlot` no longer needs the clock. `ttlSeconds` (the visitor's countdown) is unchanged. |
| FIN-02 | `billing/billing.service.ts` `pay()` | The idempotency key is now read **after** the invoice row lock, as `refund()` already does after the payment lock. Before, a double click with the same key could get 409 `conflict` from the unique index on the second request. Now that request waits for the first, sees its payment, and answers with the invoice: one payment, two 201 responses. There was never a double charge; only the second response changes. |

### Tests

- New `packages/db/test/43_v4_concurrency.sql` (13 checks, two real sessions through dblink):
  - **Scenario 5:** a second overlapping booking of the same doctor waits for the first, and is refused as a double booking once the first commits.
  - **Scenario 7:** a hold that ran out without being released. Two bookings race for the slot. The second waits while the first releases the hold, then loses to the first booking (not to the dead hold), and the slot ends up with exactly one booking.
  - **FIN-02:** the twin payment waits on the invoice lock, then finds the first payment by its key; the database refuses a second payment with the key in any case.
- `billing.e2e-spec.ts`: the repeated payment is now sent twice at the same moment (`Promise.all`). Both answer 201, a later retry too, and the invoice has one payment. I did not run this test against the old code; under the old order the second response was a 409.
- `booking.e2e-spec.ts`: the `expiresAt` a hold returns equals the `hold_expires_at` stored in the database.

## Checks run

- `pnpm db:test`: 44 files, **775 checks passed**.
- `pnpm --filter @dental/api typecheck`: clean. `lint`: no errors (the old `sentry.ts` warning remains).
- `pnpm --filter @dental/api test` against `dental_test`: **60 suites, 478 tests passed**.

## Deploy notes

API only, so it can go out on its own. Holds created before the deploy keep the expiry they were given.

## Next

**Phase 4 (indexes):** the audit found no index worth its write cost (§7 of the audit). I propose to close it with no migration, unless the user wants a particular one.

**Phase 5 (readiness):**
- `database/schema_v4.sql` (a `pg_dump --schema-only` snapshot);
- `docs/database/schema-v4-migration-guide.md` (deploy order and rollback);
- `pnpm db:migrate` on the dev DB.
