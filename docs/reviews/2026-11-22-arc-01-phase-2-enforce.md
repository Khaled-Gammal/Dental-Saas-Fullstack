# ARC-01, phase ARC-2: enforce the signed clinic context (2026-11-22)

This follows ARC-1 (`2026-11-22-arc-01-phase-1-signed-context.md`); the user said "ok". Branch `v4/arc-01-signed-context`.

## What changed

- **`20261204000078_enforce_signed_context`:** `app_context_settings.mode = 'enforce'`. From here an unsigned `app.tenant_id` (and member, user, actor) gives no clinic for any login that does not bypass RLS. SQL running as the API role can no longer choose a clinic.
  - It warns, but doesn't fail, when no key is written yet: a fresh build writes the key right after the migrations (`db:test`, CI).
  - `down` returns to permissive.
  - The emergency switch back needs no migration (an admin `UPDATE`, see the migration guide).
- **Tests:**
  - `00_helpers.sql` now holds `test.enter_sql()` / `test.host_sql()`, which sign a context as the API does.
  - `05_concurrency.sql` and `43_v4_concurrency.sql` sign their second session's entry; they were the only app_user logins that set the clinic unsigned.
  - `44_arc_signed_context.sql` starts from enforce, switches to permissive for its permissive checks, and ends back in enforce (33 checks).
- **Docs:**
  - `docs/database/schema-v4-migration-guide.md` gains an ARC-01 section: the order (key, then 0077 with the signing API, then 0078 once no old API is left), two releases, the emergency switch, key rotation, and who is affected.
  - `schema-v4-changelog.md` gains the ARC-01 entry.

## Checks run

- `pnpm db:test`: 45 files, **808 checks passed** on a fresh database that enforces from 0078. That includes both concurrency tests, now signed, and the attack checks of `44` as a real `app_user` login.
- 0078 rolled back (mode back to `permissive`) and applied again (`enforce`) on `dental_test`.
- `pnpm --filter @dental/api test` against the enforcing `dental_test`: 60 suites, **478 tests passed**. Every API path signs.

## Dev database: not switched

`dental` stays at 0077, **permissive**. It is shared by every branch you run, and `main` (and any branch without the ARC-1 API) sets the clinic unsigned. In enforce it would see no clinic rows at all. When this branch is merged, or whenever you want dev to enforce, run `pnpm db:migrate`. To go back, run the one-line admin `UPDATE` in the guide.

## What ARC-1 and ARC-2 protect now

An injection in any **signed-in** endpoint stays inside the signed-in member's clinic, branches and identity: changing any of them gives no clinic. This was checked on a real `app_user` login, as an injected `set_config` to clinic B followed by an empty result.

Still open: an injection inside a **public website** endpoint enters, legitimately, the clinic whose hostname the request names, as `patient`, and can read that clinic's tables. ARC-3 restricts the patient context to what the website shows.

## Next

ARC-3 (the user chose "right after ARC-2"). First an inventory of every table the website, online booking and self-service paths read or write as the patient. Then RESTRICTIVE policies for `current_actor_type() = 'patient'` on the clinical, money and staff tables, with tests on both sides: every public flow still works, and a patient context reads nothing else.
