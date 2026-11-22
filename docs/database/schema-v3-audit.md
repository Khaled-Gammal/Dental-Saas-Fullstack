# Database audit: schema v3 as implemented (migrations 0001–0069)

Date: 2026-11-22 · Branch: `v4/schema-audit` (from `origin/main` 1ae942b) · PostgreSQL 16.14 (Docker `postgres:16-alpine`)

## 0. Scope and method

**What was audited.** The brief names `dental_saas_schema_3.sql` as the source of truth. That file (outside the repo, `D:\Freelance\dental_saas_schema_3.sql`, 2026-10-14) became migration `20261014000001_initial_schema.sql`. Since then **68 more dbmate migrations** have changed it, so the schema that runs is 0001 + 0002…0069. The audit covers that live schema. The v3 file is the historical baseline and was not edited.

**Stack corrections to the brief.**
- The API uses **NestJS + Kysely** (types from `kysely-codegen`, `packages/db/src/database.ts`). There is **no Prisma**.
- Migrations live in `packages/db/migrations/` (dbmate).
- Tests:
  - `packages/db/test/*.sql`, run by `pnpm db:test`; dblink opens a real second session;
  - API e2e (jest).

**How each claim was checked.** In this order:
1. Read every migration that touches grants, RLS, definer functions, money, scheduling or files.
2. Read the API's database access layer, auth guard, booking, billing, staff, platform and worker code.
3. Rebuilt `dental_test` from all 69 migrations and ran the 40 existing SQL test files.
4. Ran catalogue queries: RLS flags, policies, grants, definer functions, default privileges, role flags, FK index coverage.
5. Ran **probes as `app_user`**. Each probe is a rolled-back transaction that attempts the bad action.

Every finding marked *Confirmed* was reproduced in step 5. Nothing here is claimed as tested unless it ran.

## 1. Executive summary

The multi-tenant design is sound and already hardened by several review rounds (C, R11). There is **no critical finding**: no path from a normal API request reaches another clinic's rows.
- Every tenant table carries `tenant_id`, with composite same-tenant foreign keys.
- RLS is `ENABLE` + `FORCE`, using indexable `tenant_id = current_tenant_id()` policies.
- Branch limits are RESTRICTIVE policies.
- The API role is NOBYPASSRLS, and the tenant comes only from the signed access token.
- The tenant setting is transaction-local, so it cannot leak across pooled connections.
- Money rules (derived totals, row locks, immutable payments, refund limits) and booking rules (exclusion constraints) live in the database.

What remains:

1. **One structural, residual risk (High, ARC-01).**
   - The tenant context is a GUC that the API role can set itself.
   - RLS therefore protects against a *forgotten filter*, not against *SQL injection*.
   - No injection vector exists today: no unsafe raw SQL was found. One appearing later would expose every clinic.
2. **Rules held only by the API, or definer functions that trust their arguments (Medium):**
   - any caller of the clinic role can close **any** clinic through `request_clinic_deletion()` (SEC-01, confirmed);
   - a non-owner can take the **owner** role or widen their own role at the database level (SEC-02, confirmed);
   - a deactivated account keeps working until its token expires (SEC-06).
3. **Low-cost gaps (Low), all confirmed:**
   - a clinic can add itself a live custom domain (with TLS) without DNS proof;
   - it can insert subscription rows;
   - an x-ray can become the public logo;
   - the API role can write dbmate's migration ledger;
   - a doctor can be scheduled at a branch they don't work at;
   - a completed appointment can be moved;
   - plus three small API ordering issues.

Recommendation:
- Apply the 7 small migrations and 4 small API changes in §11 (phases 1–3).
- Decide later on the three design items: ARC-01, SEC-07 and WRK-01.
- **No index is added.** None of the unindexed foreign keys has a query or delete path that needs one (§7).

## 2. Architecture assessment

| Area | Verdict | Evidence |
|---|---|---|
| Shared DB + `tenant_id` | Sound | Every clinic table has `tenant_id NOT NULL`. The exceptions are deliberate: `outbox_events` (platform events, policy handles NULL, 0004) and the platform tables listed in §8. |
| Same-tenant integrity | Sound | Children reference `(tenant_id, x_id)` → `UNIQUE (tenant_id, id)`. Room ↔ branch via `(tenant_id, branch_id, room_id)`. "Who did it" columns reference `tenant_members(tenant_id, id)` (0012). |
| RLS | Sound for missed filters; see ARC-01 | `ENABLE` + `FORCE` on all clinic tables. `tenant_isolation` uses `=` (0004). `branch_access` is RESTRICTIVE (0015). |
| Tenant resolution | Sound | JWT `tid` only (`jwt-auth.guard.ts`). Re-checked per request through `member_access_state()`: tenant match, member active, tenant not suspended/cancelled, `access_version`, `sessions_revoked_at`. Public site: `resolve_tenant_by_host()` returns only verified/active domains of live clinics. |
| Global users + memberships | Sound | `users` is global. `tenant_members UNIQUE (tenant_id, user_id)`. The role is per clinic. `memberships_for_user()` lists a user's clinics at sign-in, and a login names a clinic only where the member is active. |
| Platform admin separation | Sound | Separate login (password + email code). Platform token type is never accepted by the clinic guard. `platform_*()` definer functions are executable only by `app_platform` (0062), which reads no clinic tables. |
| Connection model | Sound | One pool per process. `set_config(..., true)` inside one transaction per use case (`packages/db/src/index.ts:42`). `statement_timeout` 15 s. The admin URL is never used at runtime. |
| Worker | Works; see WRK-01 | `app_worker` is BYPASSRLS. Per-clinic jobs filter `tenant_id` in SQL. |
| Modular monolith | Fits | No reason for services or a database per clinic. |

## 3. Critical vulnerabilities

**None found.** No path was found that gives one clinic another clinic's data through the API as written.

## 4. High priority issues

### ARC-01: the tenant context can be set by the role it restricts

| Field | |
|---|---|
| Severity | High (residual, design level; not exploitable without an injection bug) |
| Location | `current_tenant_id()` (0001), which reads `current_setting('app.tenant_id')`; `member_branch_ids()` (0015), which reads `app.member_id`; every `tenant_isolation` / `branch_access` policy |
| Problem | Custom GUCs can be set by any role, so `app_user` can run `set_config('app.tenant_id', <other clinic>, true)` itself. `resolve_tenant_by_host()` hands out any clinic's id from its public hostname. |
| Impact | One SQL injection bug anywhere in the clinic API reads (and partly writes) every clinic's patients, visits and invoices. **Confirmed:** as `app_user`, `set_config` to clinic B's id (from `resolve_tenant_by_host('clinic-b.lvh.me')`) made clinic B's patient visible. |
| Recommendation | Keep the current mitigations, which hold today: no unsafe raw SQL (checked), Kysely parameter binding everywhere. A real fix is a v5 decision (§12): a signed context, where a definer `enter_tenant()` checks an HMAC the API computes with a secret the database role cannot read, and the policies call a verifying `(SELECT current_tenant_id())`. Cost: one more call per transaction, recreating every policy, and redesigning the public-site context (a hostname alone must not unlock the clinic's private rows). |
| Migration risk | High (all policies, every request path) |
| Verification | Probe ARC-01 in §10 must fail after a fix. |

## 5. Medium priority issues

### SEC-01: `request_clinic_deletion()` trusts its arguments

| Field | |
|---|---|
| Severity | Medium |
| Location | `request_clinic_deletion(p_user uuid, p_tenant uuid)`, SECURITY DEFINER, owner `app_definer`, EXECUTE `app_user` (0034); called via `TenantDb.platform()` with no context (`clinic-data.repository.ts:54`) |
| Problem | It checks that `p_user` is an active owner of `p_tenant`, but never that the caller is that user in that clinic. This is the class of problem 0062 fixed for `platform_*()`. |
| Impact | **Confirmed:** as `app_user` with no clinic set, the call closed clinic B (`status = 'cancelled'`, erase date +90 days) given its owner's id. Unlike ARC-01 this changes `tenants.status`, which `app_user` cannot write. It takes a clinic offline (restorable by a platform admin for 90 days). |
| Recommendation | Require `p_tenant = current_tenant_id()` and `p_user = app.user_id`. The API calls it inside `runAs(tenantId, …, { userId, actorType: 'member' })`. |
| Migration risk | Low (same signature; one API call moves into a transaction) |
| Verification | New test: from clinic A's context, or with no context, the call for clinic B fails. The owner's own call still works (32_data_export_deletion keeps passing). |

### SEC-02: owner-role assignment and self-widening are guarded only in the API

| Field | |
|---|---|
| Severity | Medium |
| Location | `tenant_members.role_id`, `invitations.role_id`, `roles.permissions`; `roles_guard()` (0030) checks the catalogue, not who acts. The rules live in `staff.service.ts:103-129,201-215` and `role-rules.ts`. |
| Problem | The database accepts a non-owner member giving any member (themselves included) the owner role, inviting someone as owner, or adding permissions to the role they hold. |
| Impact | **Confirmed** as `app_user` with `app.member_id` = a receptionist: `UPDATE tenant_members SET role_id = <owner role>` on themselves succeeded; an owner invitation was created; their own role gained `audit:read` and `payments:refund`. Any bug in the staff endpoints means an owner takeover inside a clinic (not across clinics). |
| Recommendation | Triggers, `app_user` only, as `roles_guard` does: (a) the owner role is given (member insert or role change, invitation insert or role change) only when the acting member is an active owner, except at sign-up (the clinic has no member yet) and at invitation acceptance (an invitation for that role was claimed in this same transaction, `accepted_at = now()`); (b) a member who is not an owner cannot change the permissions of the role they hold. The finer API rules (granting only what you hold) stay in the API. |
| Migration risk | Medium: sign-up, acceptance and the owner's own edits must keep working; covered by tests 06, 17, 28 and API e2e |
| Verification | New tests: each probe above fails; sign-up, an owner invitation by an owner, and its acceptance succeed. |

### SEC-06: a deactivated account keeps its session until the token expires

| Field | |
|---|---|
| Severity | Medium |
| Location | `member_access_state(uuid)` (0049) returns `tenant_id, status, access_version, tenant_status, sessions_revoked_at`, **not** `users.is_active`; `jwt-auth.guard.ts:44-58` |
| Problem | `users.is_active` is checked only when a session starts or refreshes (`session.service.ts:37`). |
| Impact | After an account is deactivated, its access token works for up to 15 minutes. |
| Recommendation | Return `user_active` and refuse it in the guard. |
| Migration risk | Low (DROP/CREATE of the function in one migration, as 0049 did; the API reads by column name) |
| Verification | New SQL test for the column; API e2e: a deactivated user's token is refused at once. |

### SEC-07: global tables readable across clinics by the clinic role (report only)

| Field | |
|---|---|
| Severity | Medium |
| Location | `users` (no RLS; `app_user` SELECT on id, email, phone, full_name, platform_role, is_active, …); `legal_acceptances` (no RLS, `tenant_id` nullable; SELECT on id, user_id, document_id, tenant_id, accepted_at; INSERT) |
| Problem | Any IDOR bug in a staff endpoint can read staff contacts of other clinics and the clinic↔user graph. |
| Impact | Privacy leak of staff (not patient) data, only through an API bug. |
| Recommendation | Option A: RLS on `users`, letting a row through when it is the caller, or shares a membership with the current clinic, or no clinic is set (sign-in flows). Option B: move the remaining cross-clinic reads into definer functions and revoke direct SELECT. Both touch sign-in, invitation and platform flows that read `users` with no clinic, so **not changed now**. |
| Migration risk | High |
| Verification | Would need API e2e of every sign-in and invite path. |

### WRK-01: per-clinic worker jobs run with BYPASSRLS (report only)

| Field | |
|---|---|
| Severity | Medium |
| Location | `app_worker` (BYPASSRLS, default privileges `arwd`); `worker/data-exports.ts` (exports one clinic by `WHERE tenant_id = …` on every table) |
| Problem | Isolation in the export, the notification senders and the reminders depends on each query's WHERE. |
| Impact | A missed filter in a job puts another clinic's rows into an export ZIP or an email. |
| Recommendation | Run per-clinic job transactions as `SET LOCAL ROLE app_user` plus `enterTenant()` (needs `GRANT app_user TO app_worker`). Keep BYPASSRLS only for the cross-clinic scans (`expire_*`, `release_all_expired_holds`, `purge_clinic`). |
| Migration risk | Medium (the export reads columns `app_user` cannot: they must be checked) |
| Verification | Export e2e per clinic. |

## 6. Low priority issues

### SEC-03: a clinic can add a live custom domain without proof

| Field | |
|---|---|
| Severity | Low |
| Location | `domains`: `app_user` keeps INSERT (0002; 0046 revoked only UPDATE). `resolve_tenant_by_host()`, `domain_allowed_for_tls()` (0001). |
| Problem | Nothing in the database ties an `app_user` insert to sign-up. |
| Impact | **Confirmed:** clinic A inserted `drahmed-probe.com` as `custom/active`. It resolved to clinic A and was allowed for TLS issuance (Caddy on-demand TLS: certificate quota abuse, routing a domain one doesn't own). |
| Recommendation | BEFORE INSERT guard for `app_user`: only `type = 'subdomain'`, first label = the clinic's slug, and only while the clinic has no domain (that is, `provision_tenant()`). Platform paths are unaffected. |
| Migration risk | Low |
| Verification | New test: the probe fails; 06_signup keeps passing. |

### SEC-04: a clinic can insert subscription and usage rows

| Field | |
|---|---|
| Severity | Low |
| Location | `subscriptions` and `usage_counters`: `app_user` keeps INSERT (0002 revoked UPDATE/DELETE only; 0001's own comment meant INSERT too) |
| Problem | `subscriptions_one_live` blocks a second live row, but a live row on any plan can be inserted whenever none is live. |
| Impact | **Confirmed** (insert of a `cancelled` row and of a usage counter). With no live subscription, a clinic could grant itself a plan. `usage_counters` is unused. |
| Recommendation | Guard: `app_user` inserts only the first, `trialing` subscription (provisioning). `REVOKE INSERT ON usage_counters FROM app_user`. |
| Migration risk | Low |
| Verification | New test; 06_signup and 29/35 platform tests keep passing. |

### SEC-05: a clinical file can be published as a website image

| Field | |
|---|---|
| Severity | Low |
| Location | `file_is_public()` (0011) decides by reference alone. Image columns: `tenants.logo_file_id`, `doctors.photo_file_id`, `services.image_file_id`, `branches.photo_file_id`, `sites.favicon_file_id`, `sites.share_file_id`, `posts.cover_file_id`, `gallery_items.image_file_id/before_file_id`. |
| Problem | The API checks the kind (`media.service.ts:93`); the database does not. |
| Impact | **Confirmed:** an `xray` file set as the clinic logo made `file_is_public()` true, so it would be served on the public site. |
| Recommendation | Guard trigger: these columns refuse `xray`, `clinical_photo`, `consent`, `document`, `invoice_pdf`. `file_is_public()` also returns false for those kinds. Existing rows are checked first. |
| Migration risk | Low |
| Verification | New test; 11, 12, 37, 38 keep passing. |

### SEC-08: the API role can write the migration ledger

| Field | |
|---|---|
| Severity | Low |
| Location | `schema_migrations` (dbmate), created before 0002, so `GRANT … ON ALL TABLES` (0002) gave `app_user` and `app_worker` SELECT/INSERT/UPDATE |
| Problem | The ledger decides which migrations dbmate applies. |
| Impact | **Confirmed:** `app_user` inserted a version row. A forged row makes dbmate skip a migration, for example a later security fix. |
| Recommendation | `REVOKE ALL ON schema_migrations FROM app_user, app_worker`. dbmate runs as the admin role. |
| Migration risk | Low |
| Verification | New test. |

### INT-01: a doctor can be scheduled at a branch they don't work at

| Field | |
|---|---|
| Severity | Low |
| Location | `doctor_schedules (tenant_id, doctor_id, branch_id)`; bookings are checked by `appointments_validate_doctor()` (0012), schedules are not |
| Problem | Business-level, not tenant-level, integrity. |
| Impact | **Confirmed.** Slot search can offer times the booking then refuses. |
| Recommendation | BEFORE INSERT/UPDATE trigger requiring a `doctor_branches` row. Existing rows are checked first; the migration stops with a message rather than deleting data. |
| Migration risk | Low (the user's dev DB may hold such rows; it would then say which) |
| Verification | New test; 18 keeps passing. |

### SCH-02: a finished appointment can be moved

| Field | |
|---|---|
| Severity | Low |
| Location | `appointments_transition()` (0001/0069) fires on status changes only. "Only pending/confirmed can move" lives in `manage-appointments.usecase.ts:115-117`. |
| Problem | Time, doctor or branch can change on `checked_in`, `in_progress`, `completed`, `cancelled`, `no_show`. |
| Impact | **Confirmed:** a `completed` appointment moved a day. This rewrites clinical and attendance history. |
| Recommendation | BEFORE UPDATE OF starts_at, ends_at, doctor_id, branch_id guard: only `held`, `pending` or `confirmed` may move. Check the API first for legitimate later-status edits. |
| Migration risk | Low |
| Verification | New test; 02, 18, 40 keep passing. |

### SCH-03: hold expiry uses the API clock

| Field | |
|---|---|
| Severity | Low |
| Location | `hold-slot.usecase.ts:43-45` writes `hold_expires_at` from the Node clock; `release_expired_holds()` and `finalize` compare with the database `now()` |
| Problem | Clock skew between API hosts and the database shifts the 10-minute hold. |
| Impact | A hold could expire early or late. |
| Recommendation | Write `now() + interval '10 minutes'` in SQL. |
| Migration risk | Low (API only) |
| Verification | API booking e2e. |

### FIN-02: a concurrent duplicate payment gets an error instead of the first result

| Field | |
|---|---|
| Severity | Low |
| Location | `billing.service.ts:179-184`: the idempotency key is looked up before the invoice row lock |
| Problem | Two requests with the same key both miss the lookup; the second hits `UNIQUE (tenant_id, idempotency_key)`. |
| Impact | No double charge (the database refuses it). The retry sees 409 `conflict` instead of the recorded payment. |
| Recommendation | Look up the key after locking the invoice, as `refund()` already does (lines 240-249). |
| Migration risk | Low (API only) |
| Verification | Concurrency test with two sessions; API e2e. |

### PERF-01: `data_exports` policy uses the non-indexable form

| Field | |
|---|---|
| Severity | Low |
| Location | Policy `tenant_isolation` on `data_exports` (0034): `NOT (tenant_id IS DISTINCT FROM current_tenant_id())` (confirmed in the catalogue) |
| Problem | 0004 replaced this form everywhere because it cannot use an index. |
| Impact | Small (few rows per clinic), but every read of the table is a full scan. |
| Recommendation | Recreate it with `=`. |
| Migration risk | Low |
| Verification | 32_data_export_deletion; EXPLAIN shows the index. |

### BR-01: no member in the context means no branch limit

| Field | |
|---|---|
| Severity | Low (report only) |
| Location | `member_branch_ids()` (0015) returns NULL (no limit) when `app.member_id` is unset (confirmed). `TenantDb.runAs` calls with only `userId`, e.g. `expenses.service.ts:131`. |
| Problem | Fail-open by design for the website and jobs. |
| Impact | Only signed-link reads, whose link was issued after a branch-checked request. |
| Recommendation | Pass `memberId` in those `runAs` calls when touched next. No schema change. |
| Migration risk | – |
| Verification | – |

### Informational (no change)

- **FIN-01.** `visit_procedures.commission_minor = price_minor * commission_bp / 10000` rounds down (integer division). This is deterministic, and payouts sum the frozen values. Documented as the rule.
- **Plan limits** (`plans.limits`; doctors added in 0007). Enforced only in the API, but race-safe: `PlanLimits.assertCanAdd` takes `pg_advisory_xact_lock(hashtext('plan'), tenant)` in the write transaction, and every insert path calls it. A database copy of the rule adds triggers for no gain today.
- **Refresh tokens.** Rotation claims with `UPDATE … WHERE revoked_at IS NULL RETURNING`. Reuse revokes the family. A replay within the 10 s race grace (`REFRESH_RACE_GRACE_MS`) is treated as a race and not as reuse; that is a deliberate trade-off.
- **OTP.**
  - Sends capped at 3 per 10 min per target and purpose, under an advisory lock.
  - Attempts claimed atomically, at most 5 per code; per-IP Redis limits.
  - About 15 guesses per 10 min per target against a 6-digit code.
- **`app_backup`** (LOGIN, BYPASSRLS, `pg_read_all_data`) reads everything by design (docs/ops/backups.md). Its password belongs in the vault, never in the app's env.
- **14 tables unused by the API** (inventory_*, labs, lab_orders, reviews, posts, site_pages, payment_gateways, doctor_payouts, suppliers, notification_templates, consent_templates, patient_consents, …). Kept, as decided in R11. They are covered by RLS.
- **Webhooks and gateways** are not implemented (`tenant_for_payment()` dropped in 0061). Idempotent webhook handling is a future design item; `webhook_events UNIQUE (provider, event_id)` is ready for it.

## 7. Performance recommendations

- **RLS.**
  - Policies use `tenant_id = current_tenant_id()`. `current_tenant_id()` is STABLE, so it is evaluated once per scan as an index qual.
  - Every RLS table has an index starting with `tenant_id` (0004 and the table migrations); 01_tenant_isolation checks the services plan uses it.
  - Branch policies wrap `member_branch_ids()` in `(SELECT …)`, which makes it an InitPlan evaluated once per statement.
- **Hot paths** already have composite indexes in the right order:
  - calendar: `appointments (tenant_id, doctor_id, starts_at)`, `(tenant_id, branch_id, starts_at)`, `(tenant_id, starts_at)` (0050);
  - patient search: trigram GIN on `(tenant_id, full_name)` plus the normalised name (0019/0020) and phone indexes (0056/0057);
  - lists: visits, invoices and drafts (0040–0043);
  - ledgers: `payments (tenant_id, paid_at)`, `(tenant_id, patient_id, paid_at)`.
- **Unindexed foreign keys.** The catalogue lists 110 FKs whose columns lead no index. Almost all are "who did it" columns (`created_by`, `received_by`, …) pointing at `tenant_members`, which is never deleted: `app_user` has no DELETE and members are disabled. Others point at parents that `app_user` cannot delete either (appointments, visits, doctors, branches, installments). Where the parent can be deleted (roles, services, files, treatment plan items), the child already has an index starting with `tenant_id`, so the FK check is a per-clinic scan. The only bulk delete is the nightly `purge_clinic()`, where per-clinic scans are acceptable. **No index is added.** Each would cost writes on hot tables (appointments, payments, visits) with no query to show for it.
- **Connection pooling.**
  - Pool of 10 per API process, 3 for the platform role. `statement_timeout` 15 s, `connectionTimeoutMillis` 5 s.
  - Per-request transactions with `set_config(…, true)` are safe behind PgBouncer in **transaction** mode. Session mode is not needed. Statement mode must not be used.
- **Large clinics.**
  - Exports page through a cursor (R11).
  - Reports run as caller-rights functions under RLS.
  - Partition `audit_log` and `notifications` by month at about 1M rows (already noted in 0001).

## 8. RLS and permissions audit (catalogue, `dental_test`)

**Roles:**

| Role | Super | BYPASSRLS | Login | Use |
|---|---|---|---|---|
| app_user | no | **no** | yes | clinic API |
| app_platform | no | no | yes | platform panel only |
| app_worker | no | **yes** | yes | jobs |
| app_definer | no | **yes** | no | owns SECURITY DEFINER functions |
| app_backup | no | yes | yes | backups (`pg_read_all_data`) |

All 86 tables are owned by `postgres` (the migration role). `app_user` owns nothing, so `FORCE` RLS is not needed against it but is set anyway.

**Tables with `tenant_id` but no RLS:**

| Table | `app_user` can | Assessment |
|---|---|---|
| `legal_acceptances` (tenant nullable) | SELECT 5 columns, INSERT | SEC-07 |
| `platform_audit_log` | – | platform only |
| `platform_tenant_notes` | – | platform only |
| `refresh_tokens` | SELECT, INSERT, UPDATE | global sessions |
| `webhook_events` | – | worker only |

**Other non-RLS tables:**

| Table | `app_user` can | Assessment |
|---|---|---|
| `users` | column SELECT/INSERT/UPDATE (no password hash, no TOTP secret) | SEC-07 |
| `otp_codes`, `auth_events` | SELECT, INSERT, UPDATE | global auth tables (hashed codes) |
| `plans`, `templates`, `service_catalog`, `legal_documents` | read only | |
| `leads` | INSERT columns | |
| `platform_settings` | – | |
| `schema_migrations` | **SELECT, INSERT, UPDATE** | SEC-08 |

**Writes `app_user` keeps on sensitive RLS tables:**

| Table | Privileges | Note |
|---|---|---|
| `domains` | I | SEC-03 |
| `subscriptions` | I | SEC-04 |
| `usage_counters` | I | SEC-04 |
| `tenants` | I + column UPDATE | sign-up and profile |
| `audit_log` | I | own clinic only |
| `roles` | I, U, D | |
| `tenant_members` | I, U | |
| `invitations` | I, U | |
| `files` | I, U, D | |
| `tenant_counters` | I, U | |
| `notifications`, `outbox_events` | I, U | |

**Definer functions.** All 39 are owned by `app_definer`, carry `search_path = public, pg_temp` (one has `pg_catalog, public, pg_temp`), and none is executable by PUBLIC. Who may run them:

| Role | Functions |
|---|---|
| app_user (14) | `release_expired_holds`, `resolve_tenant_by_host`, `domain_allowed_for_tls`, `memberships_for_user`, `slug_available`, `login_candidate`, `open_invitation`, `doctor_busy_intervals`, `patient_merge_counts`, `merge_patients`, **`request_clinic_deletion`** (SEC-01), `visit_procedure_billed_elsewhere`, `member_access_state`, `billing_instructions` |
| app_worker | `release_all_expired_holds`, `release_expired_holds`, `expire_trials`, `expire_subscriptions`, `billing_instructions` |
| app_platform | every `platform_*` function, `login_candidate`, `billing_instructions` |

Functions that bind to the caller's clinic: `merge_patients`, `patient_merge_counts`, `doctor_busy_intervals`, `release_expired_holds` and `visit_procedure_billed_elsewhere` (`current_tenant_id()`). Functions that trust a caller argument: `request_clinic_deletion` (SEC-01). The `platform_*` functions call `platform_assert_admin(p_actor)` and are reachable only by `app_platform`. `memberships_for_user(p_user)` and `member_access_state(p_member)` return a user's or member's own facts by id; they are part of sign-in and the per-request check (low value to an attacker, kept).

**Invoker functions executable by PUBLIC.** There are 27, for example `recalc_invoice`, `check_in_by_code`, `next_tenant_counter`, `issue_invoice` and `cash_day_totals`. They run with the caller's rights under RLS, so they give no more than the caller already has. This is accepted. New functions in this work revoke PUBLIC anyway.

**Default privileges** (`postgres` in `public`):
- tables: `app_user` SELECT/INSERT/UPDATE (DELETE removed in 0046), `app_worker` all four;
- sequences: `app_user` and `app_worker` USAGE/SELECT.

A new table is therefore writable by the API until its migration revokes privileges or enables RLS. That is the rule every table migration already follows.

## 9. Business logic risks

| Area | Held by | Risk left |
|---|---|---|
| Double booking (doctor, room) | DB exclusion constraints, statuses `NOT IN (cancelled, no_show, expired)` | An expired, unreleased hold blocks until `release_expired_holds()`. All 4 API booking paths call it in the same transaction and a 60 s job sweeps the rest (confirmed). |
| Doctor works at the branch | DB (bookings, 0012) | Schedules not checked (INT-01) |
| Working hours, time off, holidays | API, with `override_reason` + `appointments:override` | By design (staff may override) |
| Appointment state machine | DB trigger (0001/0069) | Moves after check-in (SCH-02) |
| Invoice totals, status, immutability | DB triggers + locks | – |
| Payments (currency, patient, branch, invoice state) and over-payment | DB triggers + `paid_minor <= total_minor` | – |
| Refund limits under concurrency | DB lock on the payment + sum check (05_concurrency: two sessions) | – |
| Idempotency | DB unique keys (payments, refunds, platform payments) | FIN-02 (wrong response, not a double charge) |
| Installments, payment plans | DB deferred constraint triggers (0012/0024) | – |
| Commission and payouts | DB (frozen bp, payout derive and overlap) | FIN-01 rounding (documented) |
| Last owner | DB trigger + advisory lock | – |
| Owner role, self-widening | API only | SEC-02 |
| Plan limits | API under an advisory lock | – (race-safe) |
| Subscriptions | Platform definer functions | SEC-04 |
| Clinical immutability | DB (visit amendments, history versions, tooth records append-only) | – |
| Patient merge | Definer, bound to the clinic, rows locked in order | – |

## 10. Testing results (actually executed)

**Environment:** Docker Desktop, `postgres:16-alpine` (PostgreSQL 16.14), database `dental_test` rebuilt from migrations 0001–0069 plus the seeds.

1. **Existing suite** (`pnpm db:test`): **40 files, 693 checks, all passed** (2026-11-22).
2. **Catalogue queries:** the results in §7–§8.
3. **Probes as `app_user`**, each a rolled-back transaction. Before any fix:

| Probe | Result |
|---|---|
| ARC-01: `set_config` to clinic B (id from `resolve_tenant_by_host`) | clinic B patient visible |
| SEC-01: `request_clinic_deletion(owner B, clinic B)` with no context | clinic B → `cancelled` |
| SEC-02: receptionist sets own `role_id` = owner role | succeeded |
| SEC-02: receptionist inserts an owner invitation | succeeded |
| SEC-02: receptionist adds `audit:read`, `payments:refund` to own role | succeeded |
| SEC-03: insert `custom/active` domain | routes to clinic A, TLS allowed |
| SEC-04: insert subscription row; insert usage counter | both succeeded |
| SEC-05: x-ray file as clinic logo | `file_is_public` = true |
| SEC-06: `member_access_state` result | no `is_active` column |
| SEC-08: insert into `schema_migrations` | succeeded |
| INT-01: schedule doctor A1 at Maadi (not their branch) | succeeded |
| SCH-02: move a `completed` appointment by one day | succeeded |
| Stale hold: overlapping booking without release / with release | blocked / succeeded |
| BR-01: Maadi receptionist / no member set | `{Maadi}` / no restriction |

**The brief's 12 scenarios:**

| # | Scenario | Covered by | Gap filled in |
|---|---|---|---|
| 1 | Clinic A cannot access clinic B patients | 01_tenant_isolation | – |
| 2 | Clinic A cannot modify clinic B appointments | 01 (update/insert across clinics), 15 | explicit appointment update/delete test (phase 1) |
| 3 | One global doctor works in several clinics | – | new test: one user, two memberships, two roles, context per clinic (phase 1) |
| 4 | Doctor cannot be assigned to an unauthorised branch | 13 (bookings), 15 | schedules: INT-01 (phase 2) |
| 5 | Two concurrent requests cannot double-book a doctor | 02 (one session) | two-session test (phase 3) |
| 6 | Two concurrent requests cannot over-refund | 05_concurrency (two sessions) | – |
| 7 | An expired hold does not block a valid booking | 02, 15 + probe above | two-session variant (phase 3) |
| 8 | A user cannot escalate their own permissions | 28 (catalogue only) | SEC-02 (phase 1) |
| 9 | A clinic cannot access another clinic's private files | 12, 19, 27 | explicit `files` / `patient_files` cross-clinic test (phase 1) |
| 10 | A disabled membership cannot access clinic data | 15 (branch tables empty), 17 (`member_access_state`), API guard | DB note: a disabled member still sees non-branch tables if a request ever ran with it; the API refuses it on every request |
| 11 | A clinic cannot touch another clinic's usage counters | RLS (no test) | test + SEC-04 (phase 1) |
| 12 | Unauthorised users cannot access platform data | 29_platform_admin | – |

API e2e was not run in this phase: nothing changed.

**After phase 1** (migrations 0070–0073, review `docs/reviews/2026-11-22-schema-v4-phase-1-security.md`):
- `pnpm db:test`: 41 files, 746 checks passed. The new `41_v4_security.sql` turns every phase-1 probe above into a refused action.
- Each new migration's `down`, then `up` again, ran on `dental_test`.
- API: 60 suites, 478 tests passed.

**After phase 2** (migrations 0074–0076, review `docs/reviews/2026-11-22-schema-v4-phase-2-integrity.md`):
- `pnpm db:test`: 42 files, 762 checks passed.
- Each new migration's `down`, then `up` again, ran on `dental_test`.
- API: 60 suites, 478 tests passed.

INT-01 became a deferred foreign key `doctor_schedules (doctor_id, branch_id) → doctor_branches` instead of a trigger.

**After phase 3** (API only, review `docs/reviews/2026-11-22-schema-v4-phase-3-scheduling-money.md`):
- `pnpm db:test`: 44 files, 775 checks passed. `43_v4_concurrency.sql` covers scenarios 5 and 7 with two sessions, plus the duplicate payment key.
- API: 60 suites, 478 tests passed, including a payment sent twice at the same moment and a hold expiry read back from the database.

**Phases 4–5** (review `docs/reviews/2026-11-22-schema-v4-phase-5-readiness.md`):
- No index added.
- Dev DB migrated to 0076; its schema dump equals the migration-built one.
- `pnpm typecheck` passed; `pnpm db:test` 775 checks passed.
- Snapshot in `database/schema_v4.sql`; deploy and rollback in `docs/database/schema-v4-migration-guide.md`.

## 11. Implementation plan (v4 = the live schema + these changes)

Each phase ends with a report and waits for approval. New migrations go in `packages/db/migrations/` (0070+). They follow the repo's rules:
- an explanatory header and a `migrate:down` section;
- `app_user`-only exemptions, as in 0030;
- `NOT VALID` and `VALIDATE` in separate files;
- `CONCURRENTLY` alone in a file;
- definer `search_path = public, pg_temp`, and EXECUTE revoked from PUBLIC;
- existing data checked first: the migration stops with a message and never rewrites rows.

**Phase 1: security**

| Migration / change | Findings | Impact |
|---|---|---|
| 0070 `owner_role_guard` | SEC-02 | 3 triggers. Sign-up and acceptance paths exempt as described. No data change. |
| 0071 `clinic_role_inserts` | SEC-03, SEC-04, SEC-08 | 2 insert guards and 2 REVOKEs. |
| 0072 `public_image_kinds` | SEC-05 | Guard trigger on 7 tables. `file_is_public()` replaced in place. Stops if an existing row already points at a clinical file. |
| 0073 `caller_bound_definers` | SEC-01, SEC-06 | `request_clinic_deletion()` replaced in place. `member_access_state()` dropped and re-created with one more column. |
| API: `clinic-data.repository.ts` | SEC-01 | `requestDeletion` runs in `runAs(tenantId, …, { userId })`. |
| API: `jwt-auth.guard.ts` | SEC-06 | Refuses `user_active = false`. |
| Test `41_v4_security.sql` | | Scenarios 2, 3, 8, 9, 11 and every phase-1 probe. |

Deploy order: migrations first, then the API. Migration 0073 keeps the old columns, so an old API keeps working against the new function. The new API needs 0073.

**Phase 2: referential integrity**

| Migration | Findings | Impact |
|---|---|---|
| 0074 `doctor_schedule_branch` | INT-01 | Trigger. Stops if an existing schedule is at a foreign branch. |
| 0075 `appointment_move_guard` | SCH-02 | Trigger on `appointments` (BEFORE UPDATE OF 4 columns: no cost on status-only updates). |
| 0076 `data_exports_policy` | PERF-01 | Policy recreated. |
| Test `42_v4_integrity.sql` | | |

**Phase 3: scheduling and financial integrity.** API only:
- SCH-03: hold expiry from the database clock;
- FIN-02: idempotency key read after the invoice lock;
- test `43_v4_concurrency.sql`, with two dblink sessions: double booking, expired hold, duplicate idempotency key;
- API e2e for booking and payments.

**Phase 4: clinical data and privacy.** The audit found the clinical side already strict:
- private kinds can never be public;
- signed, member-bound, 5-minute file links proxied through the API, with an audit row;
- history versions, visit amendments and append-only tooth records;
- merge as a clinic-bound definer.

SEC-05 (phase 1) closes the one gap. SEC-07 is reported for decision. Field-level encryption of `visits.clinical_notes` / `patient_medical_history.notes` stays an option noted in 0001 (cost: no SQL search on those fields).

**Phase 5: performance.** No index added (§7).

**Phase 6: testing and production readiness.**
- Full `pnpm db:test` and API e2e against `dental_test`, plus `pnpm typecheck`.
- Each new migration's `down`, then `up` again, on `dental_test`.
- `database/schema_v4.sql` (a `pg_dump --schema-only` snapshot, for reference only).
- `docs/database/schema-v4-migration-guide.md` (deploy order, rollback, dev-DB notes).
- A review in `docs/reviews/`.
- Then `pnpm db:migrate` on the dev DB.

## 12. Recommended architecture beyond v4 (decisions for later)

1. **Signed tenant context (ARC-01).**
   - A table `context_keys` readable only by `app_definer`.
   - `enter_tenant(tenant, member, user, issued_at, sig)` (definer) verifies `hmac(…, key)` and stores the context plus a per-transaction proof. `current_tenant_id()` returns the clinic only when the proof matches `pg_current_xact_id()`.
   - Policies change to `(SELECT current_tenant_id())`, so the check runs once per statement.
   - The public site needs its own path: a hostname must open only public rows. That means actor-aware policies, or definer functions for the public pages.
   - Benefit: SQL injection no longer crosses clinics. Cost: every request path, every policy, and the worker.
2. **Least-privilege worker (WRK-01).** Per-clinic jobs under `SET LOCAL ROLE app_user` plus `enterTenant()`.
3. **`users` exposure (SEC-07).** RLS keyed on shared membership, or definer reads only.
4. **Schema size.** If the 14 unused tables have no roadmap date, dropping them would shrink the attack and maintenance surface. Kept per the R11 decision; listed here for review.
