# Schema v4 changelog

**v3 → v4, 2026-11-22.** Branch `v4/schema-audit`, from `origin/main` 1ae942b.

Schema v3 is `dental_saas_schema_3.sql`, which became migration 0001. The live schema before this work was 0001–0069; v4 is that plus 0070–0076 and four API changes. Each item traces to a finding in `docs/database/schema-v3-audit.md`. Deploy and rollback: `docs/database/schema-v4-migration-guide.md`. Snapshot: `database/schema_v4.sql`.

There are no table or column changes, so the Kysely types (`packages/db/src/database.ts`, this repo's typed schema; it has no Prisma) are unchanged. Re-generating them gives no diff.

## Security

| ID | Before | After | Where |
|---|---|---|---|
| SEC-02 | Only the API stopped a member who is not an owner from taking the owner role, changing an owner, changing their own access, inviting an owner, or widening the role they hold. | The database refuses all five for the API role. Sign-up and invite acceptance (owner invitations included) still work. | 0070: `tenant_members_owner_guard`, `invitations_owner_guard`, `roles_own_role_guard`, `acting_member_is_owner()`, `is_owner_role()` |
| SEC-03 | The API role could insert a live custom domain: it was routed and allowed a TLS certificate without DNS proof. | The API role adds only the clinic's own sign-up subdomain. | 0071: `domains_insert_guard` |
| SEC-04 | The API role could insert subscription rows and usage counters. | Only the first, trialing subscription; usage counters are not writable. | 0071: `subscriptions_insert_guard`, REVOKE |
| SEC-08 | The API and worker roles could read and write dbmate's `schema_migrations`, so a forged row could skip a migration. | No access. | 0071: REVOKE |
| SEC-05 | A logo, photo or cover could point at an x-ray, clinical photo, consent or document, which was then served on the website. | Those 9 image columns refuse clinical kinds; `file_is_public()` never publishes them. | 0072: `public_image_guard`, 7 triggers |
| SEC-01 | `request_clinic_deletion()` (SECURITY DEFINER) trusted its arguments: any API-role session could close any clinic. | Only inside the clinic's own request, by its signed-in owner. | 0073; API `clinic-data.repository.ts` |
| SEC-06 | A deactivated account kept working until its token expired (≤15 min). | Refused at its next request (`account_disabled`). | 0073: `member_access_state().user_active`; API `jwt-auth.guard.ts` |

## Referential and business integrity

| ID | Before | After | Where |
|---|---|---|---|
| INT-01 | A doctor could be scheduled at a branch they don't work at. | Deferred foreign key `doctor_schedules (doctor_id, branch_id) → doctor_branches` (NO ACTION, checked at COMMIT). | 0074 |
| SCH-02 | A checked-in, finished, cancelled or no-show appointment could be given another time, doctor or branch. | Only `held`, `pending` and `confirmed` appointments move, for every role. | 0075: `appointments_move_guard` |

## Scheduling and money (API only)

| ID | Before | After | Where |
|---|---|---|---|
| SCH-03 | A website hold's expiry came from the API host's clock. | `now() + interval` in SQL, the clock the release compares with. | `hold-slot.usecase.ts`, `ports.ts`, `kysely-scheduling.repository.ts` |
| FIN-02 | A double-clicked payment could answer 409 to the second request. There was no double charge. | The key is read after the invoice lock: both requests answer with the one payment. | `billing.service.ts` |

## Performance

| ID | Before | After | Where |
|---|---|---|---|
| PERF-01 | The `data_exports` policy used the non-indexable `IS NOT DISTINCT FROM`. | `tenant_id = current_tenant_id()`, like every other table. | 0076 |
| PERF-02 | 110 foreign keys without a leading index. | **No index added.** None has a query or delete path that needs it (audit §7). | – |

## Constraints, triggers and functions added

- **Constraint:**
  - `doctor_schedules_doctor_branch_fk`.
- **Triggers:**
  - `tenant_members_owner_guard`, `invitations_owner_guard`, `roles_own_role_guard`;
  - `domains_insert_guard`, `subscriptions_insert_guard`;
  - `tenants_public_image`, `doctors_public_image`, `services_public_image`, `branches_public_image`, `sites_public_image`, `posts_public_image`, `gallery_items_public_image`;
  - `appointments_move_guard`.
- **Functions:**
  - new: `acting_member_is_owner()`, `is_owner_role(uuid)`, `tenant_members_owner_guard()`, `invitations_owner_guard()`, `roles_own_role_guard()`, `domains_insert_guard()`, `subscriptions_insert_guard()`, `public_image_guard()`, `appointments_move_guard()`;
  - replaced: `file_is_public(uuid)`, `request_clinic_deletion(uuid, uuid)`, `member_access_state(uuid)`.
- **Grants:**
  - revoked: INSERT on `usage_counters` (`app_user`); ALL on `schema_migrations` (`app_user`, `app_worker`).
  - new helper functions: EXECUTE revoked from PUBLIC, granted to `app_user`.
- **Policy:**
  - `tenant_isolation` on `data_exports` recreated.

## Tests added or changed

- **New SQL tests:**
  - `packages/db/test/41_v4_security.sql` (53 checks);
  - `42_v4_integrity.sql` (16);
  - `43_v4_concurrency.sql` (13; two sessions through dblink).
  - They cover the brief's scenarios 2, 3, 4, 5, 7, 8, 9 and 11. Scenarios 1, 6, 10 and 12 were already covered by 01, 05, 15/17 and 29.
- **Changed to match the new rules:**
  - `01_tenant_isolation`: the API role may not add a custom domain;
  - `17_staff_access`: the acting owner is set, as the API does;
  - `32_data_export_deletion`: deletion from the owner's own clinic context.
- **API e2e:**
  - `staff` (deactivated account);
  - `billing` (the same payment twice at once);
  - `booking` (hold expiry is the stored one).

## Also new

- `database/v3-to-0001.sql`: upgrades a database built from the bare v3 file to 0001, so that dbmate can take it to v4. Tested end to end; see the migration guide.

## ARC-01: signed clinic context (0077, 0078)

| Before | After | Where |
|---|---|---|
| `current_tenant_id()` returned `app.tenant_id`, a setting the API role could change itself: one SQL injection could `set_config()` another clinic's id and read it. | The API signs each transaction's clinic, member, user and actor with `TENANT_CONTEXT_KEY`. `enter_context()` / `enter_host_context()` check the signature and leave a proof bound to the connection and the transaction. Every reader and policy believes only a verified context. Forged, stale or replayed contexts give no clinic. | 0077, 0078; `packages/db/src/context.ts`; `TenantDb` |

- **New objects:**
  - tables `app_context_keys`, `app_context_settings`;
  - functions `enter_context`, `enter_host_context`, `context_verified`, `context_mac`, `context_proof_message`, `current_user_id`, `current_actor_type`.
- **Rewritten:** `current_tenant_id`, `current_member_id`; through text patches, `member_branch_ids`, `audit_row_change`, `gallery_items_consent_stamp`, `request_clinic_deletion`.
- **Policies:** 70 `tenant_isolation` policies, `tenant_self` and the outbox policy now read `(SELECT current_tenant_id())`.
- **Tooling:** `pnpm db:context-key`, and the `TENANT_CONTEXT_KEY` / `TENANT_CONTEXT_KEY_ID` settings.
- **Tests:** `44_arc_signed_context.sql` (33 checks), with dblink as a real `app_user` login; `05` and `43` sign their remote sessions.
- **Cost:** about 10 µs per table per query, instead of 0.5 µs.
- **ARC-3 (0079):** the website's patient context is limited by 112 RESTRICTIVE policies.
  - It reads the catalogue, appointments, patients and non-clinical files.
  - It may insert into the audit trail and the outbox, and nothing else.
  - Any new RLS table is denied to it until its migration says otherwise; `45_arc_patient_scope.sql` fails on a table without a patient policy.
  - `appointments_clinical_follow()` and `next_tenant_counter()` became definer functions.
- **Still open:** in the website context, the clinic's `patients` and `appointments` remain readable (the booking needs them). ARC-3b options are in `docs/reviews/2026-11-22-arc-01-phase-3-patient-scope.md`.

## Not changed (decisions left open, audit §12)

- **ARC-3b:** the website context without direct access to `patients` and `appointments`.
- **SEC-07:** RLS or definer-only reads on `users` and `legal_acceptances`.
- **WRK-01:** per-clinic worker jobs under `app_user`.
- Dropping the 14 tables the API doesn't use.
