# Implementation audit

Date: 2026-10-17 · Phase A (audit only — no code, schema or SRS changes were made)

> **Status update (end of Phase C, 2026-10-17):** SEC-01, SEC-02, SEC-03, SEC-06, SEC-07, SEC-09, SEC-10, F-OPS-01
> and F-OPS-02 are fixed (migrations 0012–0016; `docs/reviews/2026-10-17-phase-c-security.md`). SEC-08 is partly
> fixed (money and bookings audited). This document is kept as the audit of the starting point; current status is in
> `docs/implementation-status.md`.
Scope: the whole repository at commit `b6b7d6e` (branch `main`, clean working tree), the SRS and the reference
schema, measured against the new project brief (Egypt-focused clinic workflow and financial features) and the
Arabic-only requirement.

---

## 1. Method and evidence

Every status below comes from reading the code, the migrations and the tests. A table in the schema, a line in the
SRS or a ticked checkbox was never taken as proof that a feature works.

| Source | Location | Notes |
| --- | --- | --- |
| SRS | `D:\Freelance\Dental Clinic SaaS — SRS & Database Schema.md` (outside the repo) | 757 lines, dated 2026-10-14. The README says "Requirements … are in the SRS doc", but the file is not in the repository. |
| Reference schema | `D:\Freelance\dental_saas_schema_3.sql` (outside the repo) | Identical to `packages/db/migrations/20261014000001_initial_schema.sql` except for the booking/check-in code columns, `override_reason` and `check_in_by_code()`, which only the migration has. |
| Migrations | `packages/db/migrations/` (11 files) | All additive after 0001. 0002 grants, 0003 sign-up, 0004 RLS/privilege hardening, 0005–0011 feature rules. |
| DB tests | `packages/db/test/*.sql` (13 files) | Run as `app_user` under RLS. They cover isolation, booking, check-in codes, billing triggers, real two-session concurrency, sign-up, onboarding, catalogue, no-show, gallery and images. |
| API e2e tests | `apps/api/test/*.e2e-spec.ts` (8 files, 109 cases) | They need Postgres and Redis. |
| Unit tests | API domain specs, dashboard vitest, web vitest | No database needed. |
| Prior reviews | `docs/reviews/*.md`, `docs/roadmap-website-content.md` | Their "left for later" lists were cross-checked and are referenced below. |

### What ran in this session

| Check | Result |
| --- | --- |
| `pnpm --filter @dental/db build` | passed |
| `typecheck` — db, api, web | passed |
| `typecheck` — dashboard | **failed**: 4 errors in `screens/doctors.tsx`, `screens/services.tsx`, `screens/pages.tsx` (see F-OPS-01) |
| `lint` — api, dashboard, web | passed |
| Dashboard unit tests (vitest) | 8 files, 37 tests passed |
| Web unit tests (vitest) | 4 files, 20 tests passed |
| API unit tests (jest, `src/` only) | 5 suites, 46 tests passed |
| **Database tests** (`pnpm db:test`, rebuilt `dental_test` from all 11 migrations + seed) | 13 files, **147 checks passed** (isolation 19, booking 10, check-in code 10, billing 28, concurrency 6, sign-up 15, onboarding 14, catalogue 9, patients/no-show 7, booking codes 5, gallery 9, entity images 15) |
| **API e2e + unit tests** (`pnpm --filter @dental/api test`, Postgres 16 + Redis in Docker) | 13 suites, **146 tests passed** |

The database rules listed as IMPLEMENTED below are backed by these passing runs (Docker was started later in the
same session). The findings in §3 come from reading the code. They are gaps the existing tests do not cover,
not test failures.

### Status legend

`IMPLEMENTED` works, with code and tests as evidence · `PARTIALLY_IMPLEMENTED` some of it exists, important parts
missing · `NOT_IMPLEMENTED` nothing meaningful beyond (possibly) a table · `NEEDS_VERIFICATION` not enough evidence
· `BLOCKED` waits for a dependency or a business decision.

"Schema only" means the table, constraints and triggers exist, but no API endpoint, service or screen uses them.

---

## 2. Summary

The project is a well-built **foundation**. It covers tenancy, identity, clinic setup, the public website, online
booking, reception check-in and the patient register, with database-enforced rules and good tests. Everything
**after check-in** in the clinic workflow is schema only: visits, clinical notes, dental chart, treatment plans,
procedures, prescriptions, consents, invoices, payments, expenses and reports. So are staff management and the
super-admin panel.

The SRS's "MVP acceptance criteria" (§7.1) are all ticked `[x]`. Several are not true of the code: invoices and
Arabic receipts, consent signing, the super-admin panel, backup/restore, and "dashboard works in Arabic and
English" is now superseded. Treat §7.1 as a target list, not a status.

| Workflow step (brief §6) | Status |
| --- | --- |
| Clinic setup | IMPLEMENTED (profile, logo, brand colour, publish) |
| Branch setup | IMPLEMENTED (branches, weekly hours with split shifts, main branch) — holidays and rooms have no API |
| Staff and doctor setup | PARTIALLY — doctors + schedules done; **no staff invite / members / roles management** |
| Services and pricing | IMPLEMENTED (the clinic's own services, prices, durations, doctor assignment, delete; catalogue removed 2026-10-21) |
| Appointment booking | IMPLEMENTED for website + staff booking; **no reschedule, no rooms, no calendar week view** |
| Patient check-in | IMPLEMENTED (booking code / QR / manual with reason) |
| Clinical visit | NOT_IMPLEMENTED (schema only) |
| Dental chart and treatment plan | NOT_IMPLEMENTED (schema only) |
| Procedures | NOT_IMPLEMENTED (schema only) |
| Invoice | NOT_IMPLEMENTED in API/UI; database rules IMPLEMENTED and tested |
| Payments | NOT_IMPLEMENTED in API/UI; database rules IMPLEMENTED and tested |
| Follow-up appointment | PARTIALLY — a staff booking can be made; no link to a visit, no recall/follow-up list |

| Approved Egypt-focused feature (brief §7) | Status |
| --- | --- |
| F1 Multiple payment methods | PARTIALLY — DB enum has cash, card, wallet, bank_transfer, instapay; no API/UI; reference and staff fields weak |
| F2 Partial payments and installments | PARTIALLY — DB triggers implemented and tested; no API/UI; plan totals not enforced |
| F3 Clinic expenses | NOT_IMPLEMENTED — a minimal `expenses` table; no method, approval or responsible-staff fields; no API |
| F4 Discounts and approval permissions | NOT_IMPLEMENTED — amount columns only; no percentage, reason, limits or approval |
| F5 Daily cash reconciliation | NOT_IMPLEMENTED — no tables |
| F6 Treatment plan tracking | NOT_IMPLEMENTED — schema only; planned vs. performed separation exists in the schema |
| F7 Localized (now Arabic-only) experience | PARTIALLY — website Arabic-only RTL; dashboard bilingual with a language switch; English leaks in errors and emails |

---

## 3. Critical security and data-integrity findings

No **Critical** finding was confirmed: tenant isolation is enforced by forced RLS, composite foreign keys and a
non-bypass API role, and it is covered by DB and e2e tests. The findings below are ordered by priority. Phase C
should close the High ones before any financial or clinical endpoint is built on top of them.

| ID | Priority | Finding | Evidence | Recommended action |
| --- | --- | --- | --- | --- |
| SEC-01 | **High** | **Finalized money can be changed or deleted silently.** `app_user` has full `UPDATE`/`DELETE` on `payments`, `refunds` and `expenses` (0002 grants). No trigger stops changing `amount_minor`, `method`, `paid_at`, `patient_id` or `received_by` of a succeeded payment, or deleting it. The invoice totals are then recomputed, so the change looks consistent but leaves no trace. No financial table writes to `audit_log`. | `20261014000002_roles_and_grants.sql`; `payments_validate()` only checks patient/currency/invoice state | Guard trigger: a succeeded payment's money fields are immutable and payments/refunds are never deleted (status moves only, e.g. void with reason). Add a DB audit trigger on invoices, invoice_items, payments, refunds, expenses and payment plans. `refunds_changed()` must still update `refunded_minor`, so do this by column-aware guards, not a blanket `REVOKE UPDATE`. |
| SEC-02 | **High** | **Branch-level access (SRS 2.3) is not enforced anywhere.** `tenant_members.all_branches` and `member_branches` exist but no API code reads them. Any member sees and changes every branch's appointments and patients. This is latent today only because no restricted member can be created (no invitations), and it must exist before staff management ships. | `grep member_branches apps/api` → no hits | Decide the enforcement layer (service-layer filter plus a DB helper `member_branch_ids()`, or branch-aware RLS on branch-scoped tables). Add tests for "branch-limited receptionist cannot see branch B". |
| SEC-03 | Medium | **A staff booking with an override reason skips the doctor–branch and active-doctor checks.** `doctorsFor()` returns no doctor, so there are no slots, `onGrid` is false, and with `appointments:override` the insert goes ahead for any doctor at any branch, including a deactivated doctor. The database does not tie `appointments.doctor_id` to `doctor_branches`. | `manage-appointments.usecase.ts` `create()`; `kysely-scheduling.repository.ts` `doctorsFor()` / `insertStaffAppointment()` | Validate that the doctor is active and works at the branch before the override path; optionally a DB trigger. |
| SEC-04 | Medium | **Permissions live in the JWT for up to 15 minutes.** A disabled member or a downgraded role keeps the old rights until the access token expires. This was already deferred in the weeks 1–2 review. | `jwt-auth.guard.ts`, `session.service.ts` | Before staff management: re-check member status and role version per request (cache in Redis), or keep the TTL short and revoke refresh families on role change. |
| SEC-05 | Medium | **Clinical records have no finalize/amend model.** `visits.clinical_notes`, `diagnosis` and the other fields are plain updatable columns. Nothing marks a note as signed, and there is no amendment history, so "do not silently overwrite finalized clinical records" is impossible today. `tooth_records` is append-only (good). | `visits` in 0001 | Add `finalized_at/finalized_by` and a `visit_note_amendments` (or versioned notes) table. Block updates after finalization by trigger. Needs D-06. |
| SEC-06 | Medium | **Cross-entity consistency gaps** the database does not check: (a) `visits.patient_id/doctor_id/branch_id` vs. its appointment; (b) `payments.branch_id` vs. the invoice branch; (c) a payment with both `invoice_id` and `installment_id` whose plan belongs to another invoice; (d) installments + down payment ≠ plan total; (e) plan total vs. invoice total; (f) `treatment_plans.total_estimate_minor` is not derived from its items. | 0001 `visits`, `payments_validate()`, `payment_plans_validate()` | Add validating triggers (additive) before the clinical and billing APIs, with DB tests. |
| SEC-07 | Medium | **"Responsible staff" is not referentially guaranteed.** `payments.received_by`, `refunds.created_by`, `expenses.created_by`, `visits.created_by` and `invoices.created_by` have no FK to `tenant_members` (unlike `appointments.booked_by`). | 0001 | Add composite FKs `(tenant_id, x) → tenant_members` with `NOT VALID`, then validate. |
| SEC-08 | Medium | **Audit trail covers patients only** (view/create/update/medical history) plus sign-up. Appointment status changes, settings, doctors/services, and every future clinical or financial change are not audited (DSH-15 is MVP). | `shared/audit/audit-log.ts` call sites | Audit appointment moves now. Make audit part of the definition of done for the clinical and billing modules (DB triggers for money). |
| SEC-09 | Medium | **The API role can read the whole `users` table** (all clinics' staff emails, phones, password hashes). It has no RLS by design, and a review found no injectable SQL (the two `sql.raw`/`sql.ref` uses take constant column names), but one future injection bug would expose every account. | 0002/0004 grants; `public-site.repository.ts:7`, `media/stored-image.ts:12` | Column-level `SELECT` on `users` (no `password_hash`) for `app_user`, with password checks through a `SECURITY DEFINER` function. Low effort, worth doing in Phase C. |
| SEC-10 | Low | A doctor (`patients:write`) can set `is_blocked` on a patient, although the code comment says only reception and owners should. | `patients.schemas.ts`, `default_role_permissions()` | Separate permission (e.g. `patients:block`) or role check. |
| SEC-11 | Low | A suspended clinic's members keep working normally until their tokens expire (`memberships` only excludes `cancelled`). BIL-05 (read-only dashboard) is V1. | `session.service.ts` | Record as deferred with BIL-05. |
| SEC-12 | Low | Sign-up and booking emails, and some API problem titles, mix Arabic and English (see §6). Not a security issue, listed for completeness. | — | Phase F. |

Checked and found sound (code reading, backed by the passing DB and e2e tests):

- Forced RLS on every tenant table, with the `=` policy form (0004) so tenant indexes are used. `tenants` has its own
  self policy. With no tenant set, no clinic rows are visible.
- `SECURITY DEFINER` functions are owned by `app_definer` (`BYPASSRLS`, `NOLOGIN`), use `SET search_path = public`,
  have `EXECUTE` revoked from `PUBLIC`, and return narrow columns.
- Tables without RLS are `users`, `otp_codes`, `refresh_tokens`, `auth_events`, `webhook_events`,
  `platform_audit_log` and the platform catalogues. `app_user` cannot write plans, templates, catalogue,
  `platform_role`, `tenants.status` or subscriptions.
- Refresh tokens: hashed, rotated, reuse ends the family, absolute lifetime, httpOnly cookie on `/auth`.
- OTP: hashed, 5 tries, 5 minutes, send rate limit. Login lockout after 10 failures in 15 minutes, events logged.
- Production refuses to start with dev login, dev SMS, local storage or weak secrets.
- Logs: codes and message bodies are never logged; phones and emails are masked.
- Media: uploads are decoded and re-encoded (EXIF stripped); signed links cover tenant + file + size + expiry;
  public images are served only while `file_is_public()` is true.

---

## 4. Findings by feature

Columns: **SRS** = requirement IDs from the original SRS · **Where** = code and tables · **Exists / Missing / Issues**
· **Action** · **Priority** (for the new brief).

### 4.1 Identity, tenancy and access

| Feature | Status | SRS | Where | Exists | Missing / issues | Action | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Self-service sign-up + clinic provisioning | PARTIALLY_IMPLEMENTED | AUTH-01, AUTH-03 | `identity/signup.service.ts`, `provision_tenant()` (0003), `test/06_signup.sql`, `identity.e2e-spec.ts` | One transaction: user, tenant, roles, owner, main branch, trial, site, subdomain | Terms acceptance (AUTH-01, NFR-15) is not recorded | Add terms version + acceptance timestamp | Medium |
| Phone verification (OTP) | **BLOCKED** | AUTH-02 | `otp.service.ts`, `dev-sms.sender.ts`, `config.ts` | 6-digit code, 5 tries, 5 min, 3 sends / 10 min | Only a dev SMS sender exists, and production refuses `SMS_PROVIDER=dev`. The brief forbids adding an SMS provider. Email-link verification (AUTH-02) is not implemented | Decision D-01 | **High** |
| Login (email or phone + password) | IMPLEMENTED | AUTH-04 (M part) | `login.service.ts`, `identity.e2e-spec.ts` | scrypt hashes (SRS says argon2id — documented deviation), lockout, generic errors | Google sign-in is V1 | — | — |
| Sessions (JWT + rotating refresh cookie) | IMPLEMENTED | AUTH-05 | `session.service.ts`, `token.service.ts` | 15 min access, 30 day refresh, reuse detection, max session age | Permissions stale for up to 15 min (SEC-04) | Phase C/staff | Medium |
| Forgot / reset password | NOT_IMPLEMENTED | AUTH-06 (M) | — | `otp_codes.purpose` allows `reset_password` | No endpoint or screen | Email-based reset (no SMS, see D-01) | High |
| Staff invitations, members, roles | NOT_IMPLEMENTED | AUTH-08, DSH-10 (M) | `invitations`, `invitation_by_token()` (schema only) | Seeded system roles with permission arrays | No invite, accept, disable, role change or branch assignment. A real clinic cannot add a receptionist | Build members module (email invite) | **High** (blocks the receptionist/doctor/accountant workflow) |
| Login audit + lockout | IMPLEMENTED | AUTH-09 | `auth-events.repository.ts`, `rate-limiter.service.ts` | — | — | — | — |
| 2FA (TOTP) | NOT_IMPLEMENTED | AUTH-07 (V1) | `users.totp_secret_enc` | — | — | Deferred | Low |
| Tenant isolation (RLS) | IMPLEMENTED | §3.3, NFR-01, §6.10 | 0001/0004, `TenantDb`, `test/01_tenant_isolation.sql`, e2e cross-clinic cases | See §3 | — | — | — |
| Branch-level access | NOT_IMPLEMENTED | §2.3 | `member_branches` (schema only) | — | SEC-02 | Phase C design + implementation | **High** |
| Role permission checks | PARTIALLY_IMPLEMENTED | §2.2, §2.3 | `permissions.guard.ts`, `default_role_permissions()` | Guard on every write; "own" checks for doctors on appointments | Permission names differ from the matrix (`settings:write` is used for doctors, services and website publish; gallery uses `website:write`). The SRS matrix has no discount, refund, expense-approval or reconciliation rights. No custom roles UI | Define the financial permissions in Phase B (SRS) | High |
| Super-admin panel | NOT_IMPLEMENTED | ADM-01, 02, 04 (M) | `platform_audit_log`, `users.platform_role` (schema only) | — | Everything | Not in this brief; record in roadmap | Low (for this brief) |
| Plan limits | IMPLEMENTED | BIL-08 | `shared/plans/plan-limits.service.ts` | branches, doctors, patients, storage; under advisory lock | `staff` limit waits for members | With members module | Low |
| SaaS subscription billing | NOT_IMPLEMENTED | BIL-03…07 (V1) | `subscriptions`, `platform_invoices` | Trial row created at sign-up | Checkout, states, grace | Out of scope (paid gateway) | — |

### 4.2 Clinic setup

| Feature | Status | SRS | Where | Exists | Missing / issues | Action | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Clinic profile (names, phones, WhatsApp number, social, specialties, about, logo, brand colour) | IMPLEMENTED | ONB step 1, DSH-12 | `clinic-setup/profile/*`, `screens/profile.tsx`, `onboarding.e2e-spec.ts` | — | `tenants.currency`, `timezone` and `default_locale` are not editable. The UI hard-codes EGP (§6) | Show/keep currency as a clinic setting (D-09) | Medium |
| Branches + weekly hours (split shifts) | IMPLEMENTED | ONB step 2 | `branches.*`, `hours.ts`, `branch_hours_no_overlap` (0005) | Main branch switch, main cannot be deactivated, plan limit | Map pin and chairs count are not in the form | — | Low |
| Holidays | NOT_IMPLEMENTED (read only) | BOOK-02, DSH-12 | `holidays`; read by `dayContext()` | Availability honours holidays | No API or screen to add one | Add CRUD | Medium |
| Rooms / chairs | NOT_IMPLEMENTED | §6.4, BOOK-09 (room) | `rooms`, `appointments_no_room_overlap` | Exclusion constraint | No API, no assignment on appointments | Add with the calendar work | Medium |
| Doctors + branches + weekly schedule | IMPLEMENTED | ONB step 3 | `clinic-setup/doctors/*`, `catalog.e2e-spec.ts` | Schedule overlap rejected by DB, photo, plan limit | Doctor time off has no API (availability already honours it). Invite to log in (needs members) | Add time-off CRUD | Medium |
| Services + prices + durations + doctor assignment | IMPLEMENTED | ONB step 4 | `clinic-setup/services/*`, `catalog.e2e-spec.ts` | Price range; doctors per service (until 2026-10-21 only the seed wrote `doctor_services`); delete: removed if unused, else hidden (`services_deleted_is_off`) | No service categories UI (table exists) | — | Low |
| Booking settings (auto-confirm, OTP, notice, horizon, step, cancel window) | NOT_IMPLEMENTED (defaults only) | DSH-12 | `tenant_settings` | Rows created at sign-up; read by booking | No API or screen to change them | Add settings screen | Medium |
| Onboarding wizard + checklist | PARTIALLY_IMPLEMENTED | ONB-01, ONB-02 | `onboarding.controller.ts`, `screens/overview.tsx` | Live checklist derived from data | No template/section step (ONB step 5) | Website-content roadmap | Low |

### 4.3 Website and online booking

| Feature | Status | SRS | Where | Exists | Missing / issues | Action | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Clinic website by subdomain | IMPLEMENTED | WEB-01 (1 template), WEB-03, WEB-05, WEB-06 | `apps/web`, `public-site.*`, `website.*` | Live catalogue, draft/publish theme, robots/sitemap, cache purge | Section editor, SEO fields, custom domains are not built | Website-content roadmap (phases 2–6) | Low (for this brief) |
| Gallery + images | IMPLEMENTED | WEB-01 gallery | `media/*`, `gallery/*`, 0010/0011, `gallery.e2e-spec.ts`, `entity-images.e2e-spec.ts` | — | Open items in the phase-1 review | — | — |
| Online booking (branch → service → doctor → slot → hold → details → email code → booked) | IMPLEMENTED | BOOK-01, 02, 05, 06, 07, 09, 10, 11 | `scheduling/*`, `apps/web/components/site/booking/wizard.tsx`, `booking.e2e-spec.ts`, `02_booking.sql` | Exclusion constraint, 10-minute holds released by query and by the 1-minute job, patient match | BOOK-03 says phone OTP; the code uses **email** OTP (deliberate, matches the email-only notification decision) | Record the deviation in the SRS | — |
| Pay online / deposit | NOT_IMPLEMENTED | BOOK-04 (V1) | `payment_gateways` | `at_clinic` only | — | Deferred (gateway) | — |
| Patient cancel/reschedule link | NOT_IMPLEMENTED | BOOK-08 (V1) | `manage_token_hash` | — | — | Deferred | Low |
| Waitlist | NOT_IMPLEMENTED | BOOK-12 (V2) | `waitlist_entries` | — | — | Deferred | — |
| Booking emails + reminders (24 h, 2 h) | IMPLEMENTED | BOOK-07, NTF-03, NTF-04 | `worker/outbox-relay.ts`, `appointment-notifications.ts`, `notifications` | Outbox in the same transaction, dedupe keys, retries | Emails are bilingual Arabic + English (§6). Templates are not editable (NTF-02, V1) | Arabic-only (Phase F) | Medium |

### 4.4 Appointments and reception

| Feature | Status | SRS | Where | Exists | Missing / issues | Action | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Status lifecycle | IMPLEMENTED | §4.10, BOOK-05 | `domain/appointment-status.ts`, `appointments_transition()`, `availability.spec.ts` | Same table in TS and in the trigger; doctors may only start/complete their own | `checked_in → cancelled` is allowed (matches the SRS diagram) | — | — |
| Staff booking (dashboard / phone / walk-in / WhatsApp source) | IMPLEMENTED with a bug | §4.10, DSH-02 | `manage-appointments.usecase.ts`, `screens/appointments/new.tsx` | Inside schedule, or outside with reason + `appointments:override` | SEC-03 | Fix in Phase C | Medium |
| Concurrent booking | IMPLEMENTED | BOOK-09 | `appointments_no_doctor_overlap`, `05_concurrency.sql`, filter maps 23P01 → 409 `slot_taken` | — | — | — | — |
| Expired holds | IMPLEMENTED | BOOK-10 | `release_expired_holds()`, `release_all_expired_holds()`, worker | — | — | — | — |
| Check-in (code / QR / manual with reason) | IMPLEMENTED | §4.11 / check-in code design | `check_in_by_code()`, `03_check_in_code.sql`, `10_booking_codes.sql` | Single-use under concurrency, codes cleared on final states | `check_in_method = 'walk_in'` is never used: a walk-in is booked then arrived manually | Simplify in Phase D | Low |
| Day list (reception) | IMPLEMENTED | DSH-02 (part) | `screens/appointments/list.tsx` | One day, filter by branch, status actions | No week view, no per-doctor/chair columns, no drag-to-reschedule | Phase D/F | Medium |
| Waiting room view | PARTIALLY_IMPLEMENTED | brief §10 | day list shows `checked_in` | — | No queue ordered by arrival, no waiting time | Phase D | Medium |
| Reschedule | NOT_IMPLEMENTED | §4.10 "moves", DSH-02 | — | — | No endpoint: staff must cancel and rebook | Phase D | **High** (receptionist core task) |
| Cancellation | IMPLEMENTED | §4.10 | `transition(..., 'cancel')` | Reason optional, `cancelled_by = clinic` | Reason is optional (business decision?) | Confirm in SRS | Low |
| No-show (manual + automatic 2 h after end) | IMPLEMENTED | §4.10 | `mark_no_shows()` (0008), worker, `09_patients_no_show.sql` | — | No no-show rate report | Reports | Low |
| Doctor's daily list | PARTIALLY_IMPLEMENTED | §2.1, brief §6 | day list | Doctors see the clinic's day | No "my appointments" filter; whether doctors may see all is a decision (D-10) | Phase D | Medium |

### 4.5 Patients and clinical

| Feature | Status | SRS | Where | Exists | Missing / issues | Action | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Patient registration, profile, guardian, marketing consent | IMPLEMENTED | DSH-03 | `patients/*`, `screens/patients/*`, `patients.e2e-spec.ts` | File numbers from the clinic counter, PDPL consent time, plan limit | — | — | — |
| Patient search (name, phone, file no., Arabic-Indic digits) | IMPLEMENTED | DSH-03 | `patient-rules.ts` `classifySearch()`, trigram index | ILIKE + trigram similarity | **No Arabic normalisation** (أ/إ/ا, ة/ه, ى/ي): "احمد" does not match "أحمد" by ILIKE (deferred in the week-6 review) | Normalised search column (Phase D) | **High** (Arabic-only acceptance criterion 4) |
| Duplicate detection on manual create | NOT_IMPLEMENTED | DSH-03 | — | Booking flow matches phone + name (BOOK-11) | Reception can create the same person twice with no warning | "Possible duplicates" check on create | Medium |
| Patient merge | NOT_IMPLEMENTED | DSH-03 (M) | `merged_into_id`, `merged_at` (schema only) | Reads already hide merged records | No merge operation (re-pointing appointments, invoices, etc.) | Phase D (careful, audited) | Medium |
| Medical history, allergies, medications | IMPLEMENTED | DSH-03 | `saveMedicalHistory()`, `screens/patients/medical-history.tsx` | `clinical:read/write`; audit records that a field changed, never its value | Overwrite in place: the audit says "changed", the previous list is lost | Keep history (versions) with the clinical work | Medium |
| Patient attachments (X-rays, documents) | NOT_IMPLEMENTED | DSH-03, NFR-03 | `files` kinds, `patient_files` | Storage port, signed URLs (images only) | Upload of PDFs/X-rays, private-only kinds, download authorization | Phase D (after D-06) | Medium |
| Visits + clinical notes | NOT_IMPLEMENTED | DSH-06 (M) | `visits` (schema only) | One visit per appointment (unique) | API, doctor workspace, finalize/amend (SEC-05), consistency (SEC-06a) | Phase D | **High** |
| Dental chart (FDI, surfaces, history) | NOT_IMPLEMENTED | DSH-04 | `tooth_records` (append-only grant) | FDI and surface CHECKs | API and chart UI | Phase D | High |
| Treatment plans | NOT_IMPLEMENTED | DSH-05 | `treatment_plans`, `treatment_plan_items` (schema only) | Planned items separate from `visit_procedures` | API/UI; estimate not derived (SEC-06f); patient approval record | Phase D (F6) | High |
| Procedures performed | NOT_IMPLEMENTED | DSH-06 | `visit_procedures` | Price snapshot, link to plan item, billed-once trigger | API/UI | Phase D | High |
| Prescriptions (printable) | NOT_IMPLEMENTED | DSH-06 | `prescriptions`, `prescription_items` | — | API, Arabic printable layout | Phase D | Medium |
| Consents (template + signature) | NOT_IMPLEMENTED | DSH-16 (M) | `consent_templates`, `patient_consents` | Snapshot of signed text | Everything | Phase D or later (decision) | Medium |
| Recalls / follow-up list | NOT_IMPLEMENTED | DSH-19 (V1) | `recalls` (schema only) | — | The brief allows "manual reminders and internal follow-up lists" | Phase D (simple list) | Medium |
| Patient record audit | IMPLEMENTED | NFR-03, DSH-15 | `audit-log.ts`, `GET /patients/:id/activity` | Views deduplicated over 10 min | Owner-only (`audit:read`) | — | — |

### 4.6 Billing and finance

The database layer here is good. `invoices_derive()`, `invoice_items_validate()`, `payments_validate()`,
`refunds_validate()` and the installment/payout triggers recompute every total, lock the parent row and refuse
overpayment, wrong currency, wrong patient and editing an issued invoice. All of this is covered by
`04_billing.sql` and the two-session `05_concurrency.sql`. **None of it is reachable**: there is no billing
module, no endpoint and no screen.

| Feature | Status | SRS | Where | Exists | Missing / issues | Action | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Invoices (draft → issued → partially_paid / paid / void) | PARTIALLY (DB only) | DSH-07 (M), NFR-10 | `invoices`, `invoice_items`, triggers | Derived totals, lock after issue, void with reason, numbering counter | API/UI; invoice numbers are assigned by the caller (no `issue_invoice()` function); printable Arabic invoice/receipt | Phase E | **High** |
| F1 Payment methods | PARTIALLY (DB only) | DSH-07 | `payments.method` CHECK: cash, card, wallet, bank_transfer, instapay, online, insurance | Amount, currency, date, notes, `received_by` | **Reference** is only `provider_ref` (unique per provider, meant for gateways), so a bank-transfer or wallet reference needs its own column. `received_by` has no FK (SEC-07). Money fields mutable (SEC-01). No branch-vs-invoice check (SEC-06b) | Phase C (integrity) + Phase E (API/UI) | **High** |
| F2 Partial payments | PARTIALLY (DB only) | DSH-07 | `invoices_derive()` | Many payments per invoice, balance, status, tested | API/UI; payment history view; patient balance across invoices | Phase E | High |
| F2 Installments with due dates | PARTIALLY (DB only) | DSH-18 (V1) | `payment_plans`, `installments` | Paid/status derived from payments, plan completes, overdue computable | Sum of installments vs. plan total not enforced (SEC-06d); plan vs. invoice total (SEC-06e); installment ↔ invoice link (SEC-06c); "waived" has no reason or approver | Phase C + E | High |
| F2 Refunds | PARTIALLY (DB only) | DSH-07 | `refunds` + triggers | ≤ payment, succeeded only, serialized | No **refund method** (cash vs. card), branch or approval. Cash reconciliation cannot count cash refunds | Phase C/E (D-05) | High |
| F2 Authorized adjustments | NOT_IMPLEMENTED | — | — | Void (when nothing is paid) | No credit note or write-off concept | Decision D-12 | Medium |
| F4 Discounts | NOT_IMPLEMENTED | DSH-07 | `invoices.discount_minor`, `invoice_items.discount_minor`, `treatment_plan_items.discount_minor` | Fixed amounts only, locked after issue | Percentage, reason, per-role limits, approval, audit | Phase E (D-02) | High |
| F3 Expenses | NOT_IMPLEMENTED (minimal table) | DSH-08 (V1) | `expenses`, `expense_categories`, `suppliers` | Branch, category, supplier, amount, date, description, receipt file | Payment method, approval status/approver, responsible staff FK, void/correction instead of edit, API/UI, category seeding (rent, salaries, supplies, equipment, lab) | Phase E (D-03) | High |
| F5 Daily cash reconciliation | NOT_IMPLEMENTED | — (new) | — | — | Tables (cash session per branch/day or per drawer), opening balance, expected vs. actual, difference, closer, lock | Phase E (D-04) | High |
| Doctor commissions / payouts | NOT_IMPLEMENTED (DB only) | DSH-20 | `doctor_payouts`, triggers | Tested | **Deferred by the brief** | Roadmap | — |
| Clinic payment gateways | NOT_IMPLEMENTED | BOOK-04, DSH-12 | `payment_gateways` | — | **Deferred by the brief** | Roadmap | — |

### 4.7 Reporting and dashboard home

| Feature | Status | SRS | Where | Missing | Priority |
| --- | --- | --- | --- | --- | --- |
| Dashboard home | PARTIALLY_IMPLEMENTED | DSH-01 (M) | `screens/overview.tsx` | Shows setup progress, plan and role only: no today's appointments, revenue, pending bookings | Medium |
| Owner reports (revenue, collections, expenses, attendance/no-shows, balances, branch/doctor performance) | NOT_IMPLEMENTED | DSH-11 (V1) | — | Everything; depends on billing | High (brief §6 owner role) |
| Export (Excel/CSV) | NOT_IMPLEMENTED | DSH-11, NFR-08 | — | — | Low |

### 4.8 Inventory, labs, other

`inventory_*`, `labs`, `lab_orders`, `reviews`, `posts`, `faqs`, `notification_templates` and
`in_app_notifications` are schema only (NOT_IMPLEMENTED). The brief defers lab tracking. Inventory is V2 in the SRS.

### 4.9 Operations and quality

| ID | Priority | Finding | Evidence | Action |
| --- | --- | --- | --- | --- |
| F-OPS-01 | **High** | **The dashboard does not typecheck, so `pnpm build` fails** (`build` = `tsc --noEmit && vite build`). The errors are in `screens/doctors.tsx`, `screens/services.tsx` and `screens/pages.tsx`, older screens that `App.tsx` no longer imports and whose translation keys were removed. | Typecheck output in §1; `grep` shows no imports | Phase C: delete the three unused files after a final import check (they are 746 lines of dead code). |
| F-OPS-02 | Medium | CI is not active: `ci.yml` sits at the repo root, and `setup-ci.cmd` (which moves it to `.github/workflows/`) was never run. CI would currently fail on F-OPS-01. | repo root | Run the setup script after F-OPS-01 (a repo action, needs your OK). |
| F-OPS-03 | Low | `api-test.txt`, an old e2e log showing a failing run, is committed. | repo root | Remove it from the repo. |
| F-OPS-04 | Medium | The SRS and the reference schema live outside the repository. | §1 | Phase B: bring the SRS into `docs/SRS.md` (original preserved) so code and requirements change together. |
| F-OPS-05 | NEEDS_VERIFICATION | Backups / PITR / restore drill (NFR-07; ticked in SRS §7.1). | No ops config in the repo | Confirm with hosting decision. |

---

## 5. SRS ↔ implementation inconsistencies

| # | SRS says | Code does | Recommendation |
| --- | --- | --- | --- |
| 1 | §7.1 every MVP criterion `[x]` | Invoices/receipts, consents, super admin and backups are not built; "AR and EN" is superseded | Phase B: §7.1 becomes a tracked checklist driven by `implementation-status.md` |
| 2 | AUTH-02, BOOK-03, NTF-01: SMS and WhatsApp OTP/notifications | Email only (booking OTP and notifications); sign-up still uses phone OTP via a dev sender | Record email-only as an approved deviation; resolve sign-up with D-01 |
| 3 | NFR-02 argon2id | scrypt (Node built-in), parameters stored in the hash | Record as an accepted deviation (or migrate later) |
| 4 | §3.1 / LND-01 / WEB-04 / NFR-09 / DSH-16: bilingual AR/EN | Website Arabic-only; dashboard bilingual | Superseded by the Arabic-only requirement (mark as superseded, not deleted) |
| 5 | §2.2 permission names (module-level) | `settings:write`, `website:write`, `clinical:*`, `appointments:override` | Phase B: one permission catalogue in the SRS that matches `default_role_permissions()` |
| 6 | §6.11 "room must be in the branch" | Enforced by FK, but there is no room API | — |
| 7 | §8.5 `packages/contracts` (OpenAPI → client), `eslint-plugin-boundaries` | No contracts package; the boundary rule is a custom ESLint import ban for `withTenant` only | Record as not done |
| 8 | §6.1 "Invoices are voided, never deleted" | Drafts can be deleted (by design). Payments and refunds can be deleted (SEC-01) | Fix SEC-01 |

---

## 6. Arabic-only audit

**Requirement:** the whole system is Arabic only, RTL everywhere, no language switcher, and no English localization
now or as a future feature. English stays only in code, identifiers, logs and developer docs.

| Area | Current state | Gap | Removal / change plan (Phase F) |
| --- | --- | --- | --- |
| Public website (`apps/web`) | `<html lang="ar" dir="rtl">`, `ar-EG` number/date/currency formats, Arabic copy, Arabic plurals | A few English strings in API route handlers ("Not found", "Booking is temporarily unavailable", "Image unavailable"); the landing page link text "Clinic dashboard"; content falls back to `_en` columns when `_ar` is empty | Translate the strings; keep the `_en` fallback only as a last resort for old data (D-07) |
| Dashboard language switch | `App.tsx` keeps `lang` state in `localStorage`, toggles `dir`/`lang`; `AuthLayout` and `AppShell` render a toggle | Must be removed | Remove the toggle and the stored preference; fix `lang="ar" dir="rtl"` in `index.html` |
| Dashboard dictionary | `i18n.ts`: about 520 `{ ar, en }` entries; `t(key, lang)` passed through every screen; `LangContext` | Duplicate English strings | Collapse to Arabic-only strings, keeping `t(key)` so screens change mechanically. Remove `Lang`, `LangContext` and the `lang` props. No external i18n framework is installed, so nothing else depends on it |
| Content fields in forms | Doctors, services and branches forms ask for Arabic **and** English names, titles and addresses | English content inputs | Remove the English inputs from forms; **keep** the `_en` columns (no schema rename/drop) and existing data (D-07) |
| `pickName(lang, ar, en)` (`packages/ui/text.ts`) | Picks by language | — | Arabic first, English only as fallback |
| API error messages | `detail` is English; the dashboard maps 42 of 57 error codes to Arabic and falls back to the English text for the other 15 (`busy`, `clinic_not_found`, `date_out_of_range`, `no_clinic`, `no_session`, `not_found`, `otp_used`, `phone_not_verified`, `refresh_race`, `service_not_bookable`, `session_expired`, `session_revoked`, `slot_unavailable`, `user_not_found`, `weak_password`) and for DB-mapped titles | English shown to users | Translate every code on the client (keep the stable `code` and the English `detail` for developers), and add a test that fails when a new code has no Arabic text |
| Validation messages | Zod field errors (`errors[].message`) are English; client-side form checks are Arabic | English field errors can reach users | Map by `code` and path on the client, or Arabic Zod messages server-side |
| Emails | Booking/OTP/reminder emails carry Arabic **and** English text; subjects are mixed ("رمز تأكيد الحجز \| Booking verification code") | Bilingual | Arabic-only bodies and subjects |
| Seeded/system names | Roles have `name_ar`; catalogue and plans have `name_ar` | — | Use Arabic only in UI |
| Locale columns | `users.locale`, `tenants.default_locale`, `patients.preferred_locale`, `sites.locales` (`{ar,en}` default) | Not user-facing | Keep the columns (no rename). Default/fix to `ar`; stop offering a choice in forms. `sites.locales` default `{ar,en}` → set `{ar}` with an additive migration (D-07) |
| Currency | Website hard-codes `EGP` (`apps/web/lib/site.ts`); dashboard hard-codes "ج.م" and "بالجنيه" | Not configurable, although `tenants.currency` exists | One `formatMoney(minor, currency)` helper in `@dental/ui`, using `tenants.currency` (default EGP, shown as "جنيه مصري" / "ج.م") |
| Dates and times | `ar-EG` formats, mostly in the branch timezone; patient activity is fixed to `Africa/Cairo`; digits are Latin in the dashboard (`ar-EG-u-nu-latn`) and Arabic-Indic on the website (`ar-EG`) | Inconsistent digits between site and dashboard | Choose one convention (D-08) and move it to shared helpers |
| Arabic search | Trigram + ILIKE, no normalisation | See 4.5 | Normalised column |
| Printing / export | Nothing printable exists yet | Receipts, invoices and prescriptions must be Arabic RTL | Part of Phase E/D deliverables |
| Calendar component | `react-day-picker` with `dir`; month labels via `toLocaleString('default')` | Browser-locale month names | Force `ar-EG` |

Acceptance criteria 1–9 of the Arabic-only requirement are **not met yet**. Criterion 1 fails on the
dashboard switch. Criterion 6 fails on untranslated codes and Zod messages. Criterion 4 is partial because of
Arabic normalisation. Criterion 7 has no reports or printables yet.

---

## 7. Decisions needed (business — I will not guess these)

| ID | Question | Why it matters | Proposed default |
| --- | --- | --- | --- |
| D-01 | ~~Sign-up phone verification: no SMS provider may be added. Verify the owner by email code instead?~~ | — | **Decided 2026-10-17: email code at sign-up, no SMS for now** (SRS AUTH-101) |
| D-02 | Discounts: who may discount, up to what limit (% and/or amount per role), and how a manager approves (enters credentials on the same screen, or approves a pending request)? Line-level, invoice-level or both? | Defines permissions, tables and UX | Per-role max % (receptionist 0–10 %, owner unlimited); above the limit a manager approves in-app; reason always required; both levels |
| D-03 | Expenses: which need approval (all, above an amount, certain categories)? Who approves? Can an approved expense be edited? | Approval workflow | Owner/accountant-created expenses are auto-approved; receptionist expenses above a clinic-set amount wait for owner approval; approved expenses are corrected by void + new |
| D-04 | Cash reconciliation: one cash box per branch per day, or per staff shift/drawer? Who opens/closes? Can a closed day be reopened? | Table design | One session per branch per business day; closed by receptionist or accountant; reopen only by owner with a reason (audited) |
| D-05 | Refunds: must they go back by the original method? Can a card payment be refunded in cash? Who may refund? | Cash totals and permissions | Refund method recorded explicitly; owner/accountant only; cash refunds count against the cash box |
| D-06 | Clinical notes: when does a visit lock (doctor clicks "finalize", visit completed, or after N hours)? Who may amend (author only, any doctor, owner)? | Finalize/amend model | Locked on "finalize" or when the appointment is completed; only the author or owner amends, with a reason; originals kept |
| D-07 | Existing English content (`name_en`, `bio_en` …): hide from forms and show only as fallback, or clear? Set `sites.locales` to `{ar}`? | Arabic-only migration | Hide inputs, keep data as fallback, set `{ar}` |
| D-08 | Digits: Arabic-Indic (٠١٢٣) or Latin (0123) in the dashboard and printables? The website uses Arabic-Indic, the dashboard Latin | Consistency | Latin digits everywhere (common in Egyptian clinic software, safer for phone numbers), Arabic text |
| D-09 | Currency: EGP only, or should a clinic be able to choose another currency (`tenants.currency` exists)? | Formatting and invoices | Configurable per clinic, default EGP; one currency per clinic |
| D-10 | Doctors: see the whole clinic's schedule or only their own appointments? Should a doctor see invoices/balances of their patients? | Permission matrix (SRS says "RW (own)" appointments, "R (own)" invoices) | All appointments read-only, own appointments writable; balances visible, payments not editable |
| D-11 | Treatment plans: how is patient approval recorded (staff tick + date, or signature)? | Plan status `accepted` | Staff marks accepted, with date and staff member; signature later with consents |
| D-12 | "Authorized adjustments" for installments/balances: waive an installment, write off a balance, credit note? | Model choice | Waive / write-off with reason and owner approval, both recorded as adjustment rows (no editing of payments) |
| D-13 | Order of work: the website-content roadmap's Phase 2 (Offers, display-only) is pending. Pause it in favour of this plan? Note that website "offers" are marketing only and are separate from billing discounts (F4) | Scheduling | Pause website phases 2–6; resume after Phase E |
| D-14 | Consents (DSH-16, MVP in the SRS) and super admin (ADM, MVP) are not in the brief. Defer both? | Scope | Defer both, record them in the roadmap |

---

## 8. Unrelated findings (recorded, not to be fixed now)

- Website-content open items from the phase-1 review: dev S3 server choice, CDN cache after hiding, branch photo on
  create, one unreproduced reorder.
- `POST /clinic/website/publish` bumps the version even with no change (week-3 review).
- Focus return after closing editors (week-3 review).
- `zonedToUtc` is duplicated between dashboard and API (week-6 review).
- ts-jest warns about `isolatedModules` with the hybrid module kind (harmless, noisy).
- "Any doctor" booking picks the first free doctor (phase-3 review).

---

## 9. Proposed implementation plan

Small, reviewable phases, as the brief asks. Each phase ends with: files changed, reasons, migrations and their
risks, tests actually run, and decisions needed. Then a stop for your review.

### Phase B — Documentation (next; no code)

1. `docs/SRS.md`: import the original SRS unchanged as **A. Existing requirements** (IDs kept). Add
   **B. Approved new requirements** (Egypt financial features F1–F6, the clinic workflow, Arabic-only) with new stable
   IDs (`PAY-`, `INST-`, `DISC-`, `EXP-`, `CASH-`, `TPLAN-`, `VISIT-`, `L10N-`). Each gets role, preconditions,
   behaviour, validation, permissions, errors, acceptance criteria, entities and status. Add **C. Needs
   clarification** (D-01…D-14) and **D. Deferred**. Bilingual requirements are marked *superseded by L10N-001*,
   not deleted.
2. `docs/database-design.md`: current schema by module, RLS/grants/definer map, and the proposed additive changes
   for SEC-01/05/06/07 and F1–F6, each with its migration risk.
3. `docs/roadmap.md`: deferred items (WhatsApp, SMS, gateways, labs, commissions, financing, advanced analytics,
   inventory, super admin, consents if D-14), plus the website-content phases.
4. `docs/implementation-status.md`: the requirement-by-requirement tracker that replaces SRS §7.1 ticks.

### Phase C — Critical security and data integrity (after B is approved)

| Item | Kind | Risk |
| --- | --- | --- |
| F-OPS-01 delete the three unused dashboard screens | code | none (not imported) |
| SEC-01 payment/refund/expense immutability guards + financial audit trigger | migration + DB tests | Low: no API writes money yet, so no existing data path breaks |
| SEC-07 responsible-staff FKs (`NOT VALID` → validate) | migration | Low (dev data only today; validate checks existing rows) |
| SEC-06 consistency triggers (visits ↔ appointment, payment branch, installment ↔ invoice, installment sum) | migration + DB tests | Low (tables unused by the API) |
| SEC-03 staff override booking checks | code + e2e | Low |
| SEC-09 column-level `SELECT` on `users` | migration | Medium: every identity query must be re-checked; covered by identity e2e |
| SEC-02 branch-level access: design note + enforcement helper + tests | code (+ maybe RLS) | Medium: touches every branch-scoped query; I will propose the design for review before writing it |
| SEC-08 audit appointment status changes | code | Low |

Before Phase C, I need your answers to D-01,
D-05, D-06 and D-12, which affect the integrity triggers.

### Phase D — Core clinic workflow

Staff invitations and members (email invite), reschedule, holidays/time-off/rooms, waiting room, Arabic-normalised
search, duplicate warning, visits and doctor workspace with finalize/amend, dental chart, treatment plans (F6),
procedures, prescriptions (printable), follow-up list. Patient merge and attachments can be a later sub-phase.

### Phase E — Financial features

Billing module (hexagonal, per SRS §8.11): invoices from procedures/services, issue with numbering, F1 payment
recording with references, F2 partial payments and installments, refunds, F4 discounts with limits and approval,
F3 expenses with approval, F5 daily cash reconciliation, Arabic printable receipt/invoice, owner financial reports.

### Phase F — UX and Arabic-only

Remove the language switch and the English dictionary, Arabic-only emails and errors, currency/date helpers, RTL
review of every screen, dashboard home for each role.

### Phase G — Final verification

Full `pnpm test` (DB + e2e + unit), lint, typecheck, build, browser checks in RTL, and the final report.
