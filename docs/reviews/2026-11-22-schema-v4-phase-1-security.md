# Schema v4 audit, phase 1: security fixes (2026-11-22)

Brief: the pasted "Principal Database Architect" audit of schema v3, plus "fix what you see, matching the
implementation". The audit is in `docs/database/schema-v3-audit.md`. The user chose low-risk fixes and a stop after
each phase, and said "ok" to start phase 1.

## What changed

### Migrations (all additive; every `down` was run and the `up` run again on `dental_test`)

| Migration | Finding | What it does |
|---|---|---|
| `20261202000070_owner_role_guard` | SEC-02 | **`tenant_members`:** for the API role, only an active owner (`app.member_id`) gives or takes the owner role, or changes an owner's status or branches. A non-owner never changes their own role, status or branches. Two paths still give the owner role with no member in the context: sign-up (the clinic has no member yet) and accepting an invitation for that role and that email, claimed in the same transaction. **`invitations`:** only an owner invites an owner. **`roles`:** permissions change only on a member's request, never by a non-owner who holds that role. Two helpers, `acting_member_is_owner()` and `is_owner_role(uuid)`. |
| `20261202000071_clinic_role_inserts` | SEC-03, SEC-04, SEC-08 | **`domains`:** the API role adds only the clinic's own subdomain, while it has none (that is, `provision_tenant()`). **`subscriptions`:** only the first trialing row. **Revoked:** INSERT on `usage_counters` from `app_user`; everything on `schema_migrations` from `app_user` and `app_worker`. |
| `20261202000072_public_image_kinds` | SEC-05 | The 9 columns a website visitor can be shown an image through refuse `xray`, `clinical_photo`, `consent`, `document` and `invoice_pdf` files. `file_is_public()` never answers yes for those kinds. Existing rows are checked first: the migration would stop with a message, never change data. |
| `20261202000073_caller_bound_definers` | SEC-01, SEC-06 | **`request_clinic_deletion()`:** also requires the request's own clinic (`app.tenant_id`) and signed-in user (`app.user_id`). Same message and constraint name, so the error mapping is unchanged. **`member_access_state()`:** gains `user_active`. The earlier columns are unchanged. |

### API

- `clinic-data.repository.ts`: `requestDeletion` runs inside `runAs(tenantId, …, { userId })` instead of the bare pool.
- `jwt-auth.guard.ts`: refuses `user_active = false` with the existing `account_disabled` code. Sign-in already used that code.

### Tests

- New `packages/db/test/41_v4_security.sql`, 53 checks:
  - every SEC-02 attempt as a receptionist;
  - an owner still doing all of it;
  - an owner invitation accepted in one transaction, and the wrong account refused;
  - domain, subscription, usage counter and migration ledger writes refused;
  - clinical files as logo, photo, service image, branch photo or share image refused, and `file_is_public()` false even with the triggers switched off;
  - cross-clinic and no-context deletion refused;
  - `user_active`;
  - the brief's scenarios 2 (appointments across clinics), 3 (one login, two clinics), 9 (files across clinics) and 11 (usage counters).
- Changed to match the new rules:
  - `01_tenant_isolation`: a pending custom domain is now written by the admin, because the API role may not add one;
  - `17_staff_access`: the owner is set as the acting member, as `TenantDb.run` does;
  - `32_data_export_deletion`: the owner's deletion runs in clinic A's context.
- New API e2e case in `staff.e2e-spec.ts`: a deactivated account's token is refused at its next request (`account_disabled`).

## Checks run

- `pnpm db:test`: 41 files, **746 checks passed** (693 before plus 53 new).
- Each of 0073, 0072, 0071 and 0070 rolled back on `dental_test`, then all four applied again.
- `pnpm --filter @dental/api typecheck`: clean. `lint`: no errors (the one warning, in `sentry.ts`, was there before).
- API e2e and unit tests against `dental_test` (`pnpm --filter @dental/api test`, `TEST_DATABASE_URL` exported): **60 suites, 478 tests passed.**
  - This covers sign-up, owner invitations and their acceptance into a second clinic, role edits, clinic deletion and restore, and the platform panel.
  - `staff.e2e-spec.ts` was run again on its own with the new SEC-06 case: 15 tests passed.

## Deploy notes

- Run the migrations, then deploy the new API straight away.
  - Between the two, everything works except "delete the clinic". The old API calls `request_clinic_deletion()` with no clinic context, which 0073 now refuses (that is SEC-01).
  - The extra `user_active` column is ignored by the old API.
  - The new API also works against a database without 0073: `user_active` is then missing, and the guard ignores it.
- Not applied to the dev DB yet. That happens in phase 5, as planned.

## Open

Nothing new needs a decision. ARC-01, SEC-07 and WRK-01 stay in the report for later. Phase 2 (INT-01, SCH-02, PERF-01) is next, after the user's OK.
