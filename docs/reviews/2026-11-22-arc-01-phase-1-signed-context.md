# ARC-01, phase ARC-1: signed clinic context, permissive (2026-11-22)

Design: `docs/database/arc-01-signed-tenant-context.md`. The user's decisions: a new shared key, permissive first then enforce, and ARC-3 right after ARC-2. Branch `v4/arc-01-signed-context`, from `v4/schema-audit`.

## What changed

### Database: `20261203000077_signed_tenant_context`

- **`app_context_keys`** (id, key, retired_at) and **`app_context_settings`** (one row: `mode`, starting `permissive`).
  - All privileges revoked from PUBLIC, `app_user`, `app_worker` and `app_platform`; SELECT for `app_definer` only.
  - The key itself is written by `pnpm db:context-key`, never by a migration.
- **`enter_context(tenant, member, user, actor, issued_at, key_id, sig)`** and **`enter_host_context(host, issued_at, key_id, sig)`** (SECURITY DEFINER):
  - check the API's HMAC and that it was signed within 5 minutes;
  - set the four settings transaction-locally;
  - leave `app.ctx_proof`, which binds them to this connection (`pg_backend_pid()`) and this transaction (`now()`).
- **`context_verified()`** (definer) believes the settings when:
  - the proof matches; or
  - the login role bypasses RLS anyway (admin, worker, backup); or
  - the mode is `permissive` and there is no proof at all.

  A wrong proof is never believed.
- **Readers:** `current_tenant_id()` and `current_member_id()` go through it, plus new `current_user_id()` and `current_actor_type()`.
  - `member_branch_ids()`, `gallery_items_consent_stamp()`, `audit_row_change()` and `request_clinic_deletion()` now call the readers. The migration patches them by their text and fails if any function still reads the settings directly.
- **Policies:** all 70 `tenant_isolation` policies, `outbox_events` and `tenant_self` now read `(SELECT current_tenant_id())`, once per statement, and the index is still used.
- **Not changed:** `app.patient_merge` was already safe. `patient_merge_only()` requires `current_user = 'app_definer'`, which only holds inside `merge_patients()`.

### API

| File | Change |
|---|---|
| `packages/db/src/context.ts` | new: `signContext` / `signHost` (HMAC-SHA256, the SQL's message format) and `DEV_TENANT_CONTEXT_KEY` |
| `packages/db/src/index.ts` | `enterTenant(…, key)` signs and calls `enter_context`; new `enterHost(tx, host, key)`; `withTenant(…, key)`. Without a key the old unsigned path stays, for scripts. |
| `apps/api/src/config.ts` | `TENANT_CONTEXT_KEY` (dev default, refused in production) and `TENANT_CONTEXT_KEY_ID` |
| `shared/database/database.module.ts`, `tokens.ts` | a `CONTEXT_KEY` provider |
| `shared/database/tenant-db.service.ts` | `run` / `runAs` sign. `actAs(tx, tenantId, userId)` enters again, signed. New `enter(tx, tenantId, actor)`. `runForHost` uses `enter_host_context`. |
| `modules/staff/invitation-acceptance.service.ts` | `actAs` with the clinic |
| `modules/scheduling/infrastructure/kysely-scheduling.repository.ts` | the booking confirm step enters through `TenantDb.enter` (signed) instead of `set_config` |

No module code reads or writes the context settings any more: the search finds only the unsigned fallback in `packages/db`, which the API never takes.

### Scripts, env, CI

- **`packages/db/scripts/context-key.mjs`** (`pnpm db:context-key`, `--test`): upserts the key from `TENANT_CONTEXT_KEY` / `TENANT_CONTEXT_KEY_ID`, or the dev key.
- **Who runs it:** `db:test` after the migrations; `db:reset`; CI after `pnpm db:migrate`.
- **`.env.example`:** the two variables, with the rotation steps.

### Tests

- **New `packages/db/test/44_arc_signed_context.sql`**, 32 checks. It runs through dblink as a **real `app_user` login**; an admin session acting as `app_user` is trusted on purpose. It covers:
  - the key and the mode are out of the API role's reach;
  - a signed context gives its clinic, member, user and actor;
  - an injected `set_config` to clinic B (id from its public hostname) gives no clinic, no patients, and nothing from a definer function;
  - clearing the member, or posing as the owner's member, gives no clinic;
  - a proof replayed in the next transaction gives no clinic, even in permissive mode;
  - a made-up, ten-minute-old, other-clinic, retired-key or unknown-key signature is refused;
  - a signed hostname enters its clinic as patient; an unknown host enters nothing; an unsigned one is refused;
  - the audit trail records the signed user;
  - enforce mode: the old unsigned setting gives no clinic and no rows, while signed works;
  - permissive mode: unsigned still works, a wrong proof never does.
- **`42_v4_integrity`:** the policy-text check now accepts the `(SELECT …)` form.

## Checks run

- `pnpm db:test`: 45 files, **807 checks passed**.
- 0077 rolled back on `dental_test` and applied again.
- API suite against `dental_test`, **permissive** mode: 60 suites, **478 tests passed**.
- API suite against `dental_test` switched to **enforce** for the run: 60 suites, **478 tests passed**. Every API path signs; one that didn't would have found no clinic. The database was put back to permissive afterwards.
- `pnpm typecheck` (5 packages) passed. API lint: 0 errors (the old `sentry.ts` warning).
- `pnpm db:types`: the two new tables were added to `database.ts`.
- Cost, measured in the design spike: the verified reader costs about 10 µs per call instead of 0.5 µs, paid once per table per statement.

## Dev database

- Migrated to `20261203000077` and given the dev key (`pnpm db:context-key`).
- Mode `permissive`. Without this, your next `pnpm dev` would have failed: the new API calls `enter_context()`.
- Your website dev server (port 3000) was running and was not touched. The API was not running.

## Deploy notes (production, for ARC-1)

1. Choose `TENANT_CONTEXT_KEY` (32+ random bytes) and set it in the API's environment.
2. Run `pnpm db:migrate`, then `pnpm db:context-key` with the same env.
3. Deploy the API. Permissive mode keeps the old API working until then.

Until ARC-2 switches to enforce, permissive mode gives **no protection yet**: an injection can still clear the proof and set a plain clinic.

## Next

**ARC-2:**
- a one-line migration to `enforce`;
- `05_concurrency` and `43_v4_concurrency` (dblink as `app_user`, unsigned) sign their entries;
- a production checklist with key-before-API ordering.

Then **ARC-3**, the public patient-actor restrictions.
