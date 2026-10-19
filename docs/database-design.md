# Database design

PostgreSQL 16. Last reviewed 2026-10-17 against migrations `20261014000001` … `20261026000016`
(215 database checks passed after Phase C). Requirement IDs refer to `docs/SRS.md`; finding IDs (`SEC-xx`) to
`docs/implementation-audit.md`.

Sections 1–5 describe the database **as it is**. Section 6 lists the planned changes: **6.1 (Phase C) is applied**
(migrations 0012–0016); 6.2–6.4 are still proposals that become migrations only in their phase, after review.

---

## 1. Conventions (in force)

| Topic | Rule |
| --- | --- |
| Migrations | Plain SQL in `packages/db/migrations`, run by dbmate, `-- migrate:up` / `-- migrate:down`. After every migration: `pnpm db:types` (Kysely types) and a DB test in `packages/db/test` |
| Change style | **Additive and backward compatible.** No `DROP TABLE`, no dropping or renaming columns, no rewriting data in place. New foreign keys `NOT VALID` first, then `VALIDATE`. Data resets (`db:reset`) are for development only |
| IDs | `uuid` (`gen_random_uuid()`; UUIDv7 from the app is allowed) |
| Money | `bigint` minor units + `char(3)` currency. Percentages in basis points (`1000` = 10 %) |
| Enums | `text` + `CHECK` (adding a value = replacing the CHECK) |
| Same-clinic integrity | Every tenant table has `UNIQUE (tenant_id, id)`, and children use composite FKs `(tenant_id, parent_id)`, so a row can never point into another clinic |
| Time | `timestamptz` (UTC). Clinic timezone in `tenants.timezone`, optional `branches.timezone`. Weekly hours as `time` + `weekday` (0 = Sunday). Date-only facts (`date_of_birth`, `spent_on`, `due_date`) are `date` |
| Text | UTF-8. Arabic accepted everywhere; `_ar` / `_en` column pairs for public short texts (kept, see L10N-008) |
| Deletion | Soft delete only on `tenants` and `patients`. Medical and financial rows are never hard-deleted: invoices are voided, drafts may be deleted |
| Derived values | Money totals, paid amounts, balances and statuses are computed by triggers; client-sent values are ignored |
| Append-only | `audit_log`, `platform_audit_log`, `tooth_records` (`app_user` has no UPDATE/DELETE) |

## 2. Database roles and privileges

| Role | Login | RLS | Used by | Privileges |
| --- | --- | --- | --- | --- |
| `postgres` (admin) | yes | bypass | migrations, seeds, tests setup | owner of tables |
| `app_user` | yes | **enforced** (`NOBYPASSRLS`, tables have `FORCE RLS`) | the API | DML on all tables by default privileges, then narrowed: no UPDATE/DELETE on `audit_log`, `platform_audit_log`, `tooth_records`; no UPDATE/DELETE on `subscriptions`, `usage_counters`, `platform_invoices`; read-only `plans`, `templates`, `service_catalog`, `platform_audit_log`, `platform_invoices`; `leads` insert only; `users` insert/update of listed columns only (never `platform_role`); `tenants` update of profile columns only (never `status`) |
| `app_worker` | yes | **bypass** | the worker (outbox relay, notifications, holds, no-shows, purges) | DML on all tables; EXECUTE on `release_all_expired_holds`, `mark_no_shows`, `purge_auth_data`, `purge_orphan_images` |
| `app_definer` | no | bypass | owns the `SECURITY DEFINER` lookups | SELECT on `tenants`, `tenant_members`, `roles`, `invitations`, `payments`, `domains`; SELECT/UPDATE on `appointments` |

**Default privileges grant DML on every new table to `app_user` and `app_worker`.** A new append-only or
restricted table must `REVOKE` explicitly in its own migration (checklist §7).

### 2.1 Functions that cross clinics (`SECURITY DEFINER`, owner `app_definer`, `search_path = public`, EXECUTE revoked from PUBLIC)

| Function | Caller | Returns |
| --- | --- | --- |
| `memberships_for_user(user)` | API (login) | clinics of one user with role key and statuses |
| `invitation_by_token(hash)` | API (unused yet) | one open invitation |
| `tenant_for_payment(provider, ref)` | API (unused yet; gateways deferred) | tenant + payment id |
| `resolve_tenant_by_host(host)` | API (public site, booking, media) | tenant id for a verified/active domain of a live clinic |
| `domain_allowed_for_tls(host)` | Caddy ask endpoint (not wired) | boolean |
| `slug_available(slug)` | API (sign-up) | boolean |
| `release_all_expired_holds()` | worker | count |
| `release_expired_holds(doctor)` (0015) | API (before each booking) | count; explicit clinic filter, reaches every branch |
| `doctor_busy_intervals(doctors, from, to)` (0015) | API (slot search) | busy times only, current clinic, every branch |
| `login_candidate(email, phone)` (0016) | API (sign-in) | one account incl. its password hash |

Functions running with the caller's rights (under RLS): `current_tenant_id()`, `provision_tenant(…)`,
`next_tenant_counter(key)`, `check_in_by_code(…)`, `file_is_public(file)`, `file_in_use(file)`,
`default_role_permissions(role)`, `is_reserved_slug(slug)`, `member_branch_ids()`, `branch_allowed(branch)`, and
the trigger functions (guards, consistency checks, `audit_row_change()`).

Request settings (transaction-local, set by `withTenant` / `enterTenant` in `packages/db`): `app.tenant_id`,
`app.user_id`, `app.member_id` (turns on branch restriction), `app.actor_type` (`member`, `patient` for website
bookings, empty = `system`).

`app_user` reads `users` through column grants only (no `password_hash`, no `totp_secret_enc`; 0016).

## 3. Row-level security

- Every table with a `tenant_id` column has RLS **enabled and forced** with policy `tenant_isolation`:
  `tenant_id = current_tenant_id()` for `USING` and `WITH CHECK` (rewritten from `IS NOT DISTINCT FROM` in 0004 so
  the tenant indexes are used).
- `tenants` has policy `tenant_self` (`id = current_tenant_id()`).
- `outbox_events` also allows `tenant_id IS NULL` rows when no tenant is set (platform events).
- `current_tenant_id()` reads `app.tenant_id`, set with `set_config(..., true)` (transaction-local) by
  `withTenant()` in `packages/db`. The API reaches the database only through `TenantDb` (`shared/database`); an
  ESLint rule forbids importing `withTenant` elsewhere.
- **Tables without RLS** (no `tenant_id`, or excluded on purpose): `users`, `otp_codes`, `auth_events`,
  `refresh_tokens` (has `tenant_id`, excluded), `webhook_events` (excluded), `platform_audit_log` (excluded),
  `plans`, `templates`, `service_catalog`, `leads`. They are reached only through `TenantDb.platform()` in the
  identity module.
- **Branch-level restriction** (0015, ACCESS-003): a `RESTRICTIVE` policy `branch_access` on appointments, visits,
  invoices, payments, expenses, lab_orders, waitlist_entries, inventory_stock, inventory_movements (own
  `branch_id`) and on invoice_items, refunds, payment_plans (when linked to an invoice), installments,
  visit_procedures, prescriptions, prescription_items (through the parent). `member_branch_ids()` is NULL (no
  restriction) without `app.member_id` or for all-branch members; empty for unknown or disabled members.
  Patients, branches and setup tables stay clinic-wide.

## 4. Schema by module (current)

"API" = the application reads/writes it today. "DB only" = tables, constraints and triggers exist (often tested),
nothing in the API uses them.

| Module | Tables | Used | Key invariants already enforced |
| --- | --- | --- | --- |
| Platform | `plans`, `templates`, `service_catalog`, `leads`, `webhook_events`, `platform_audit_log` | plans/templates/catalogue read; rest DB only | unique codes; `UNIQUE (provider, event_id)` |
| Identity | `users`, `refresh_tokens`, `otp_codes`, `auth_events` | API | email/phone unique, E.164 phone; OTP attempts ≤ 5; token hash unique; family id |
| Tenancy | `tenants`, `tenant_settings`, `subscriptions`, `platform_invoices`, `usage_counters`, `tenant_counters`, `roles`, `tenant_members`, `member_branches`, `invitations` | tenants, settings (read), subscriptions (insert at sign-up), counters, roles, members (read) | slug format + reserved words; one live subscription; one membership per user per clinic |
| Files | `files` | API (website images) | medical kinds (`xray`, `clinical_photo`, `consent`) can never be public; unique object key |
| Clinic setup | `branches`, `branch_hours`, `holidays`, `rooms`, `doctors`, `doctor_branches`, `doctor_schedules`, `doctor_time_off`, `service_categories`, `services`, `doctor_services` | API, except holidays / rooms / time off / categories (read or unused) | exactly one main branch, main is active; no overlapping branch shifts; no overlapping doctor shifts per weekday; service duration 5–480; catalogue service once per clinic; room belongs to its branch |
| Patients | `patients`, `patient_medical_history`, `patient_files` | API (patient_files DB only) | file number unique per clinic; guardian/merge never self; marketing opt-in has a timestamp; trigram + phone-prefix indexes |
| Scheduling | `appointments`, `waitlist_entries`, `recalls` | appointments API; others DB only | 9 statuses + transition trigger; **no overlapping doctor or room bookings (exclusion constraints)**; held rows need expiry; non-held need a patient; check-in code single use; website bookings have no staff author, staff bookings always do |
| Clinical | `visits`, `tooth_records`, `treatment_plans`, `treatment_plan_items`, `visit_procedures`, `prescriptions`, `prescription_items`, `consent_templates`, `patient_consents`, `labs`, `lab_orders` | **DB only** | one visit per appointment; FDI codes and surfaces; chart append-only; commission frozen per procedure |
| Billing | `invoices`, `invoice_items`, `payments`, `refunds`, `payment_plans`, `installments`, `doctor_payouts`, `payment_gateways`, `expense_categories`, `suppliers`, `expenses` | **DB only** | totals/paid/status derived; issued invoices locked; void only when unpaid; no overpay (row lock, tested with 2 sessions); currency + patient match; refunds ≤ payment, succeeded only; installment status from payments; payouts derived and frozen; procedure billed once outside void invoices |
| Inventory | `inventory_items`, `inventory_stock`, `inventory_movements` | DB only | stock ≥ 0; movement sign tied to type |
| Website | `sites`, `site_pages`, `domains`, `faqs`, `gallery_items`, `reviews`, `posts` | sites, domains, gallery API | theme colour `#rrggbb`; hostname owned only once verified; before/after needs consent; one featured photo per scope |
| Messaging, audit | `notification_templates`, `notifications`, `in_app_notifications`, `audit_log`, `outbox_events` | notifications, audit_log, outbox API/worker | notification dedupe key; audit append-only |

## 5. Gaps found in the current schema

Closed in Phase C (0012–0016): SEC-01 (immutable payments, money audit), SEC-02 (branch restriction), SEC-06
(cross-record consistency), SEC-07 (responsible-staff FKs), SEC-09 (password hashes), and the doctor/branch rule on
bookings. Still open:

| ID | Gap | Requirement |
| --- | --- | --- |
| SEC-05 | `visits` notes overwritable; no finalize/amend | VISIT-002 |
| — | `refunds` has no method, branch or date; `payments` has no reference column for transfers/wallets; `expenses` has no method, approval or void | PAY-001, PAY-005, EXP-* |
| — | No cash session tables | CASH-* |
| — | Discounts are amounts only (no type, percentage, reason, approval); no per-role limits | DISC-* |
| — | No normalised name for Arabic search | PATIENT-001 |
| — | Medical history kept as one overwritable row | PATIENT-005 |
| — | No function issues invoice numbers (the caller sets `number`) | BILLING-002 |
| — | `holidays` allows the same date twice for the same scope | APPT-005 |

---

## 6. Proposed changes (not applied)

Each item: what, why (requirement), sketch, migration risk, tests. SQL is a sketch for review, not the final
migration. Items that depend on an open decision are marked **(CLR-n)**.

### 6.1 Phase C — security and integrity — **applied 2026-10-17**

As built: C-01 → `enterTenant()` in `packages/db`; C-02 → 0012 (`payments_guard`, refunds REVOKE) + 0013
(`audit_row_change`, also on appointments, AUDIT-003); C-03 → 0012 (nine columns); C-04 → 0012; C-05 → 0016;
C-06 → 0014; C-07 → 0015 (option B, plus `doctor_busy_intervals()` and a definer `release_expired_holds()` so a
branch-limited member's slot search and hold release still see the doctor's other branches); C-08 → 0012
(`appointments_validate_doctor`). Review: `docs/reviews/2026-10-17-phase-c-security.md`. The text below is the
design as proposed.

**C-01 Request identity in the database session.** *Needed by C-02, C-07.*
`withTenant()` also sets `app.user_id` and `app.member_id` (transaction-local), so triggers know the actor.
Public website requests set neither. The worker sets `app.actor = 'system'`.
Risk: none (new settings; nothing reads them yet). Test: a trigger sees the member id set by the API.

**C-02 Immutable money + financial audit trigger.** *PAY-003, AUDIT-001, SEC-01.*
```sql
-- payments: a succeeded payment's facts never change; rows are never deleted
CREATE FUNCTION payments_guard() RETURNS trigger ...
  -- UPDATE: refuse changes to amount_minor, currency, method, paid_at, patient_id, invoice_id,
  --         installment_id, branch_id, received_by (and reference, C/E) once OLD.status <> 'pending';
  --         status/refunded_minor stay writable (refund triggers) and reversal fields (E-01)
  -- DELETE: refuse unless app.allow_hard_delete = 'on' (tenant hard delete, as invoices_guard_delete)
REVOKE UPDATE, DELETE ON refunds FROM app_user;   -- refunds_changed() updates payments, never refunds
CREATE FUNCTION audit_money() RETURNS trigger ... -- one row per INSERT/UPDATE/DELETE into audit_log:
  -- actor from app.user_id, action '<table>.<op>', changes = changed money/status columns only
CREATE TRIGGER ... AFTER INSERT OR UPDATE OR DELETE ON invoices, invoice_items, payments, refunds,
  payment_plans, installments, expenses ...
```
Risk: **low**. No API path writes these tables today. `refunds_changed()` and `payments_changed()` keep working
(they update allowed columns). The worker (`app_worker`) is still subject to the triggers (triggers ignore
BYPASSRLS), which is intended. The existing billing tests must still pass. Tests: update/delete of a succeeded
payment fails as `app_user`; a refund still updates the payment and invoice; every money change writes one audit row.

**C-03 Responsible-staff foreign keys.** *SEC-102.*
`ALTER TABLE payments ADD CONSTRAINT payments_received_by_fk FOREIGN KEY (tenant_id, received_by) REFERENCES
tenant_members (tenant_id, id) NOT VALID;` and the same for `refunds.created_by`, `expenses.created_by`,
`invoices.created_by`, `visits.created_by`, `payment_plans.created_by`, `patients.created_by`; then `VALIDATE
CONSTRAINT` in the same migration once a pre-check query shows no orphan values.
Risk: low. `NOT VALID` takes a short lock; `VALIDATE` scans without blocking writes. If the pre-check finds orphan
values in an environment, the migration stops with a clear message instead of changing data.

**C-04 Cross-record consistency triggers.** *SEC-101.*
- `visits_validate()`: when `appointment_id` is set, `patient_id`, `doctor_id`, `branch_id` must equal the
  appointment's.
- `payments_validate()` (replace function body, same trigger): `branch_id` = invoice branch; when both
  `invoice_id` and `installment_id` are set, the installment's plan must belong to that invoice; and when the plan
  has an invoice, an installment payment must carry it.
- `payment_plans_check_totals` — `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` on `payment_plans` and
  `installments`: `down_payment + Σ installments = total`, and `total = invoice.total_minor` when linked. Deferred so
  a plan and its installments can be inserted in one transaction.
- `treatment_plans_derive()`: `total_estimate_minor = Σ (price − discount)` of non-cancelled items, recomputed
  when items change (parent row locked first, as billing does).
- `visit_procedures_validate()`: a linked plan item belongs to a plan of the same patient.

Risk: low (tables unused by the API). One behaviour change: inserting installments that do not add up now fails at
commit. Tests: one negative and one positive case per rule, plus the existing `04_billing.sql`.

**C-05 Narrow access to password hashes.** *SEC-103.* **(medium risk — may move to Phase D)**
`REVOKE SELECT ON users FROM app_user; GRANT SELECT (id, email, phone, google_sub, full_name, avatar_url, locale,
email_verified_at, phone_verified_at, platform_role, is_active, last_login_at, created_at, updated_at) ON users TO
app_user;` plus `login_candidate(identifier, phone)`, a `SECURITY DEFINER` function returning id, password hash,
active and verified flags for **one** identifier. The API verifies scrypt hashes in Node, so the hash must still
reach it, but only one at a time.
Risk: medium. Every `users` query in the identity module must avoid `selectAll`. The identity e2e suite covers it.

**C-06 Permission catalogue.** *ACCESS-004.*
Replace `default_role_permissions()` with the B.1 catalogue. Then append, never remove, the new permissions on
existing clinics' **system** roles:
`UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || default_role_permissions(key))) WHERE is_system;`.
Permissions pending a decision are not granted to non-owners. Risk: low (additive). Test: the seeded doctor cannot
`payments:write`; B.1 matches the function.

**C-07 Branch access.** *ACCESS-003.* **Design for review before implementation.**
- `member_branch_ids()` (STABLE): `NULL` when `app.member_id` is unset (public website, worker) or the member has
  `all_branches`; otherwise the member's branch ids.
- **Option B (recommended): a restrictive RLS policy** on branch-scoped tables (`appointments`, `visits`,
  `invoices`, `payments`, `refunds`*, `payment_plans`*, `expenses`, `cash_sessions`, `holidays`, `rooms`,
  `branch_hours`; * through their parent's branch):
  `CREATE POLICY branch_access ON appointments AS RESTRICTIVE USING (member_branch_ids() IS NULL OR branch_id =
  ANY (member_branch_ids())) WITH CHECK (same);`
  It is ANDed with `tenant_isolation`, so a missed filter in code cannot leak another branch.
- Option A: service-layer filters only. Simpler, but one forgotten `WHERE` leaks data, and a missed filter is only
  caught by tests.
- Risk (B): medium. Every branch-scoped query gets the extra predicate. The function is evaluated once per
  statement (STABLE), and existing `(tenant_id, branch_id, …)` indexes cover the filter. Restrictive policies are
  additive and can be dropped in `migrate:down`. Tests: branch-limited receptionist cannot read or write branch B in
  each table; all-branch members and public booking unaffected; `EXPLAIN` shows index use.

**C-08 Staff booking rule in the database (optional backstop).** *APPT-002.*
`appointments_validate_doctor()`: on INSERT, or UPDATE of `doctor_id`/`branch_id`, by a staff source, the doctor is
active and in `doctor_branches` for the branch. Risk: low. Existing rows are not re-checked.

### 6.2 Phase D — clinic workflow

**D1 applied 2026-10-17 (migration 0017):** D-01 (`invitations.job_title`, `invitations.doctor_id`, one open
invitation per email `invitations_one_open_per_email`, definer `open_invitation(token_hash)`); D-02
(`tenant_members.access_version`, bumped by triggers on role/status/all_branches and on `member_branches`, read per
request through definer `member_access_state(member)`); plus `tenant_members_keep_owner()` (a clinic keeps one active
owner, serialized by an advisory lock) and the audit triggers of AUDIT-003 on clinic setup and staff tables
(`audit_row_change()` now also handles tables keyed by something other than `id`, and stays silent during a tenant
hard delete).

**D2 applied 2026-10-17 (migration 0018):** D-09 (`holidays_one_per_scope_date`, `holidays.created_by` FK, name length
CHECK); D-10 (`doctor_time_off.created_by` FK and a 366-day maximum length); `tenant_settings_reminder_offsets`
(at most four reminders, 15 minutes to 7 days); `doctor_busy_intervals()` gained an optional `p_exclude` (the
appointment being moved) and replaced the 3-argument form; `rooms_tenant_branch` index. Reschedules write an
`appointment.rescheduled` outbox event: the worker cancels the queued reminders of the old time and queues new
ones keyed by the new start (`reminder:<id>:<offset>:<epoch>`), plus a "your appointment moved" email.

**D3 applied 2026-10-17 (migrations 0019, 0020):** D-03 with one change: `patients.full_name_norm` is a **stored
generated column** (`GENERATED ALWAYS AS (ar_normalize(full_name)) STORED`) instead of a trigger plus batched
back-fill. It can never drift from `full_name`, needs no back-fill job and does not touch `updated_at`; the cost is
one rewrite of `patients` under an exclusive lock when the column is added (seconds at today's size; on a large
production table run it in a quiet window). The trigram index `patients_name_norm_trgm` is built `CONCURRENTLY`
in its own migration without a transaction; the old raw-name trigram index is kept for now. D-04 as proposed
(back-filled with each patient's current history as the first version; RLS; `REVOKE UPDATE, DELETE`). D-05 as
proposed, plus caption length and "archived together" CHECKs, and the 0001 `files_check` is replaced by
`files_clinical_private` (X-ray, clinical photo, consent **and document** files must be private).

**D4 applied 2026-10-17 (migration 0021):** D-06 (`visits.status` draft/final, `finalized_at`, `finalized_by`;
`visits_guard` refuses any change to a final note and every delete; `visit_amendments` append-only, only on final
visits; completing the appointment finalizes its draft visit, opening a visit starts a checked-in appointment), D-07
(`treatment_plans.accepted_by`; `treatment_plans_guard` allows only draft → proposed → accepted and cancel from an
open status; accepted ↔ in progress ↔ completed are derived from the items in `treatment_plans_derive`;
`treatment_plan_items_guard` fixes the items of an accepted plan, keeps cancelled items, and sets "done" only through a
procedure), D-08 (`recalls.created_by`). Also: `visit_procedures_workflow` (CLR-16 price range, plan item must be open
in an accepted plan, fixed once the visit is final or billed), `tooth_records_validate` (a visit's entries are its
patient's), prescriptions `replaces_id` (once), `issued_by`, `REVOKE UPDATE, DELETE` and lines only in the issuing
transaction; follow-ups and scheduled plan items go back on the list when their appointment is cancelled or missed,
and a completed appointment closes its follow-up (`appointments_clinical_follow`). Clinical audit triggers use
`audit_row_change` with the clinical text columns marked secret (logged as `true`). Every guard is silent during a
tenant hard delete. The clinical tables had no rows, so no data was rewritten. D-09 onwards: D-09/D-10 applied in D2;
the rest are still proposals.

**D5 applied 2026-10-17 (migration 0022):** `merge_patients(survivor, merged)` and `patient_merge_counts(patient)`,
SECURITY DEFINER owned by `app_definer` (BYPASSRLS), so the merge can move rows the API role may not change (recorded
payments, issued invoices, final visits, accepted plans, issued prescriptions, chart entries). Every statement names
the clinic (`current_tenant_id()`); a patient of another clinic is "not found". Rows move in dependency order
(appointments → invoices → installment plans → payments → visits → …) so each cross-record check passes. The four
guards (`payments_guard`, `invoices_derive`, `visits_guard`, `treatment_plans_guard`) allow a change of
`patient_id` alone only when `current_user = app_definer` and `app.patient_merge = on` (`patient_merge_only()`,
generated columns ignored); the API role setting that GUC changes nothing (tested). Medical history: lists combined with
`text_array_union` (case- and space-insensitive), survivor's flags and notes kept, the duplicate's history row removed
after its versions moved. The merged row gets `merged_into_id` + `merged_at`; guardians and earlier merges are
repointed. New grants to `app_definer`: SELECT/UPDATE on the moved tables and `installments`, INSERT on
`audit_log` and history versions, SELECT on the tables the fired triggers read. Rollback tested (down + up).

**E1 applied 2026-10-17 (migration 0023):** E-01 (`payments.reference`, `reversed_at/by`, `reversal_reason`, status `reversed`; `payments_guard` allows only succeeded → reversed with a reason and no refunds, then nothing; payment notes stay editable as before), E-02 (`payments_reference_required`), E-03 (`refunds.method` — defaulted to the payment's when a caller omits it, CLR-05 allows a different one — `branch_id` (always the payment's), `reference`, `refunded_at`), E-04 (`issue_invoice()`: draft only, at least one line, `{prefix}-{year}-{00001}` from `next_tenant_counter('invoice:'||year)` in the clinic time zone, tax half up from `tax_rate_bp`; `invoices_lock_number` keeps number and date fixed, starts invoices as drafts in the clinic currency). Also `invoices.voided_at/by`, and CLR-09: `tenants_currency_code` CHECK, `tenants_currency_lock` (no change once an invoice left draft), `GRANT UPDATE (currency)`. The dev database had no invoices, payments or refunds; nothing was rewritten.

**E2 applied 2026-10-17 (migration 0024):** E-05 (`invoices` and `invoice_items` + `discount_type`, `discount_bp`, `discount_reason`; a percent becomes an amount half up and an invoice percent follows its lines while draft; reason required when a discount exists; `discount_minor ≤ subtotal` once issued; one approval state per invoice `discount_status` none/within_limit/pending/approved/rejected with requester, decider, time and note; `invoices_discount_self_approval`; issuing refuses pending or rejected), E-06 (`roles.max_discount_bp/minor`, CLR-02 starting values for seeded roles now and at sign-up by trigger), E-07 (`installments.waived_at/by/reason`; `balance_adjustments` — waiver of an installment or write-off of a remainder, append-only, RLS by clinic and branch, audited; `invoices.adjusted_minor`; `balance_minor` redefined as total − paid − adjusted (one table rewrite, few rows); `invoices_check2` paid + adjusted ≤ total; one active plan per invoice; a plan completes when no installment is left to pay). E-08 onwards are E3–E4.

**E3 applied 2026-10-17 (migration 0025):** E-08 (`expenses` + `payment_method`, `reference`, `supplier_name`, `status` pending/approved/rejected/void, approver and time, `decision_note`, void reason/by/at, `updated_at`; `expenses_guard`: no future date, clinic currency, money fields never change, status only forward; no self-approval CHECK; method required for new rows (`NOT VALID`); reference rule of payments; REVOKE DELETE; audited), E-09 (`expense_categories.key`, `is_active`; `seed_expense_categories()` back-fills every clinic and runs for new ones from a `tenant_settings` insert trigger; safe to run again: a same-name category without a key takes it, a key in use is left alone; REVOKE DELETE), E-10 (`cash_sessions` and append-only `cash_session_reopenings` as designed, RLS + `branch_access`; `cash_day_totals(branch, date)`; `tenant_settings.reception_expense_limit_minor`). Two deliberate differences from the design: **no `cash_session_id` is stamped** on payments, refunds and expenses — a movement belongs to the session of its branch and its business date (`business_date()` in the clinic's zone), which CLR-04's one-session-per-day makes unambiguous and which needs no back-fill; and the closed-day rule is a trigger on each table (`*_within_open_day`, named to fire after the validate triggers) that share-locks the day's session row, while closing locks it FOR UPDATE before adding the day up — so a movement is either counted or refused, never lost. Rejected and pending expenses count on their day (the cash left the drawer); only a void changes it.

| ID | Change | Requirement | Risk |
| --- | --- | --- | --- |
| D-01 | `invitations` + `job_title text`, `doctor_id uuid` (composite FK to `doctors`), index on `(tenant_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL` | ACCESS-001 | low |
| D-02 | `tenant_members.access_version int NOT NULL DEFAULT 0`, bumped by trigger on role/status/branch change; the API compares it per request (cached briefly) | ACCESS-005 | low |
| D-03 | `ar_normalize(text) RETURNS text IMMUTABLE` (translate + regexp_replace for alef forms, ة, ى, ؤ, ئ, tatweel, harakat); `patients.full_name_norm` (applied as a stored generated column, see above); trigram index `(tenant_id, full_name_norm gin_trgm_ops)` built `CONCURRENTLY` | PATIENT-001 | **medium**: adding the column rewrites `patients` once under lock; the index is built concurrently (its own migration file, no transaction) |
| D-04 | `patient_medical_history_versions` (append-only: snapshot of lists/flags/notes, `saved_by`, `saved_at`) filled by trigger on `patient_medical_history` | PATIENT-005 | low; REVOKE UPDATE, DELETE |
| D-05 | `patient_files` + `archived_at`, `archived_by`, `archive_reason`; `files` kind `document` used for PDFs | PATIENT-004 | low |
| D-06 | `visits` + `status text CHECK (status IN ('draft','final')) DEFAULT 'draft'`, `finalized_at`, `finalized_by`; `visit_amendments` (visit_id, field, new_text, reason, author, created_at; append-only); `visits_guard()` refuses updates to clinical text when `status = 'final'` | VISIT-002 **(CLR-06)** | low (no rows yet) |
| D-07 | `treatment_plans` + `accepted_by` (member FK) | TPLAN-002 **(CLR-11)** | low |
| D-08 | `recalls` + `created_by` (FK); index for the due list exists | VISIT-005 | low |
| D-09 | `holidays` unique scope/date: `CREATE UNIQUE INDEX … (tenant_id, coalesce(branch_id, '00000000-…'), date)` | APPT-005 | low; a pre-check reports duplicates instead of failing blindly |
| D-10 | `doctor_time_off` + `created_by`; `rooms` unchanged | APPT-005/006 | low |

### 6.3 Phase E — financial features

| ID | Change | Requirement | Risk |
| --- | --- | --- | --- |
| E-01 | `payments` + `reference text`, `reversed_at`, `reversed_by` (FK), `reversal_reason`; status CHECK adds `reversed`; `invoices_derive()`/`payments_changed()` exclude reversed payments (they already sum only succeeded/refunded states); `payments_guard()` allows only `succeeded → reversed` with reason | PAY-001, PAY-003 **(CLR-05)** | low. The CHECK is replaced with `NOT VALID` + `VALIDATE` |
| E-02 | `payments_reference_required` CHECK: `method NOT IN ('bank_transfer','wallet','instapay') OR reference IS NOT NULL` (NOT VALID, then validate) | PAY-001 | low |
| E-03 | `refunds` + `method` (same CHECK as payments, minus online/insurance unless the payment was), `branch_id` (FK), `refunded_at timestamptz NOT NULL DEFAULT now()`, `cash_session_id` | PAY-005 **(CLR-05)** | low (`method` back-filled from the payment for existing rows, then `NOT NULL`) |
| E-04 | `issue_invoice(p_invoice uuid)`: locks the draft, refuses empty or pending-discount invoices, assigns `{prefix}-{year}-{seq}` from `next_tenant_counter('invoice:'||year)`, sets `issue_date`, `status = 'issued'` | BILLING-002 | low |
| E-05 | Discounts: `invoices` and `invoice_items` + `discount_type text CHECK IN ('amount','percent')`, `discount_bp int`, `discount_reason text`, `discount_status text CHECK IN ('none','approved','pending','rejected') DEFAULT 'none'`, `discount_set_by`, `discount_approved_by`; `discount_requests` (history of every request/decision, append-only); trigger: percent → amount (half-up), reason required when amount > 0; `issue_invoice` refuses `pending` | DISC-001…003 **(CLR-02)** | low |
| E-06 | `roles` + `max_discount_bp int NOT NULL DEFAULT 0 CHECK (0–10000)`, `max_discount_minor bigint` (NULL = no amount cap). Owner role unlimited by `*` | DISC-002 **(CLR-02)** | low; default 0 is the safe value |
| E-07 | `payment_plans` / `installments`: waiver fields (`waived_by`, `waived_reason`, `waived_at`); `balance_adjustments` table if CLR-12 chooses write-offs | PAY-004, PAY-006 **(CLR-12)** | low |
| E-08 | `expenses` + `payment_method`, `reference`, `status text CHECK IN ('pending','approved','rejected','void') DEFAULT 'approved'`, `approved_by`, `approved_at`, `void_reason`, `cash_session_id`, `updated_at`; guard: an approved expense's money fields are immutable (void + new instead). Existing rows become `approved` with `payment_method` left NULL (it is unknown, so nothing is guessed); "method required" is a CHECK added `NOT VALID`, so it applies to new rows without rewriting old ones | EXP-001…004 **(CLR-03)** | low (expenses unused by the API, dev seed only) |
| E-09 | `expense_categories` + `key text` (seeded system keys), `is_active`; `provision_tenant()` seeds the 8 Arabic categories; a back-fill inserts them for existing clinics (`ON CONFLICT DO NOTHING`) | EXP-002 | low |
| E-10 | `cash_sessions` (tenant, branch, `business_date`, `currency`, `opened_by/at`, `opening_minor`, `closed_by/at`, `counted_minor`, `expected_minor` (snapshot at close), `difference_minor` generated, `note`, `status` open/closed); unique `(tenant_id, branch_id, business_date)` and one open session per branch (partial unique); `cash_session_reopenings` (append-only); `cash_expected(session)` function; a trigger stamps `cash_session_id` on cash payments, refunds and expenses and refuses them when the session is closed | CASH-001…004 **(CLR-04)** | low (new tables). RLS + `branch_access` policy + REVOKE on the history table |
| E-11 | Report indexes: `payments (tenant_id, branch_id, paid_at)`, `refunds (tenant_id, branch_id, refunded_at)`, `expenses (tenant_id, branch_id, spent_on)`, `invoices (tenant_id, branch_id, issue_date)`, built `CONCURRENTLY` | REPORT-* | low. **Applied** with E1 (0023) and E3 (0025); E4 (0026) adds only read functions `report_*()` that run with the caller's rights |

### 6.4 Phase F — Arabic only

| ID | Change | Requirement | Risk |
| --- | --- | --- | --- |
| F-01 | `sites.locales` default `{ar}` and existing rows set to `{ar}` **(CLR-07)**. No column is dropped or renamed; `_en` columns and locale columns stay | L10N-008 | low (reversible in `migrate:down`) |
| F-02 | `tenants.currency` exposed in the clinic profile; trigger refuses a change once an issued invoice exists **(CLR-09)** | L10N-005 | low |

## 7. Checklist for every new migration

1. Additive only. No drops or renames; data back-fills idempotent and batched for large tables.
2. New tenant table: `tenant_id uuid NOT NULL`, `UNIQUE (tenant_id, id)`, composite FKs, `ENABLE` + `FORCE ROW
   LEVEL SECURITY`, `tenant_isolation` policy (the loop in 0001 ran once and does **not** cover new tables), an
   index starting with `tenant_id`, and `branch_access` when it is branch-scoped (C-07).
3. Default privileges give `app_user` full DML: `REVOKE` what the table must not allow (append-only, derived).
4. New FKs `NOT VALID` → `VALIDATE`; new CHECKs on populated tables the same way.
5. Indexes on large tables `CONCURRENTLY`, in a separate migration file (dbmate `transaction:false`).
6. `migrate:down` that undoes the change without losing pre-existing data.
7. `pnpm db:types`, DB test (positive and negative, as `app_user`), `pnpm test`.
8. Concurrency-sensitive rules (money, numbering, cash, bookings) get a two-session test like `05_concurrency.sql`.
