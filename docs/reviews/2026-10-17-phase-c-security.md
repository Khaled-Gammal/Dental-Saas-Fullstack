# Phase C review — security and data integrity (2026-10-17)

Scope: the Phase C items of `docs/roadmap.md`, closing the High/Medium audit findings SEC-01, 02, 03, 06, 07, 09, 10
and F-OPS-01/02 (`docs/implementation-audit.md`), plus AUTH-101 (decision D-01: email verification, no SMS).
Decisions applied: CLR-05 default (refunds: owner + accountant; reception may reverse its own same-day entry) and the
branch-access design C-07 option B (restrictive RLS).

## What changed

| Requirement | Change | Where |
| --- | --- | --- |
| PAY-003 | A payment that left `pending` cannot change amount, currency, method, date, patient, invoice, installment, branch or receiver, cannot go back to pending, and cannot be deleted. Refunds cannot be edited or deleted by the API role. Notes stay editable (audited) | migration 0012 `payments_guard()`; `REVOKE UPDATE, DELETE ON refunds` |
| SEC-101 | Payment branch = invoice branch; installment payments carry the plan's invoice; a plan on an invoice needs an issued invoice with the same total; down payment + installments = plan total (deferred check at commit); visit = its appointment's patient/doctor/branch; a procedure completes only its own patient's plan item; plan estimate derived from items | 0012 |
| APPT-002 | Staff bookings (override or not) need an active doctor who works at the branch: API answers `doctor_inactive` / `doctor_not_at_branch`; the database refuses it too | `manage-appointments.usecase.ts`, 0012 `appointments_validate_doctor()` |
| SEC-102 | Responsible-staff columns (payments, refunds, expenses, invoices, visits, payment plans, patients, medical history, files) reference a member of the same clinic; existing rows pre-checked, then `NOT VALID` + `VALIDATE` | 0012 |
| AUDIT-001, AUDIT-003 (bookings) | Database triggers write `audit_log` for every insert/update/delete of invoices, lines, payments, refunds, plans, installments, expenses, and for bookings, moves and status changes (website holds that are only reserved/released are skipped). Free text recorded as "changed" only. Actor from `app.user_id` / `app.actor_type` (member, patient for website bookings, system for jobs) | 0013; `withTenant`/`enterTenant` in `packages/db`, `TenantDb` |
| ACCESS-004 | Permission catalogue of SRS B.1 in `default_role_permissions()`; existing clinics' system roles gain the new rights (nothing removed). New: `patients:merge`, `patients:block`, `invoices:void`, `payments:refund`, `payments:reverse`, `discounts:apply`, `expenses:read`. Rights still pending a decision are owner-only | 0014 |
| SEC-10 | Changing `isBlocked` needs `patients:block` (doctors can no longer block) | `patients.service.ts` |
| ACCESS-003 | Restrictive RLS `branch_access` on appointments, visits, invoices, payments, expenses, lab orders, waitlist, inventory (own `branch_id`) and on invoice lines, refunds, plans, installments, procedures, prescriptions (through the parent). `member_branch_ids()`, `branch_allowed()`. API answers `403 branch_forbidden` for another branch in lists, availability, booking and check-in; single records of another branch answer 404. Slot search reads busy times through `doctor_busy_intervals()` (times only) so a doctor busy at another branch is never offered; `release_expired_holds()` now reaches every branch | 0015; scheduling repository + use case |
| SEC-103 | `app_user` cannot read `users.password_hash` or `totp_secret_enc`; sign-in uses `login_candidate()` (one account per call) | 0016; `identity.repository.ts` |
| AUTH-101 | Sign-up emails a 6-digit code (5 min, 5 tries, 3 sends / 10 min); `POST /auth/verify-email`, `POST /auth/otp/resend {email}`; login refused with `email_not_verified` (code re-sent) until verified; accounts verified by phone before stay valid. `/auth/verify-phone` removed. Production no longer refuses to start without an SMS provider | identity module; dashboard `screens/auth.tsx` |
| OPS-001 | Removed four dashboard files no screen imported (`screens/doctors.tsx`, `services.tsx`, `pages.tsx`, `hours-editor.tsx`; they broke `typecheck` and `build`). CI workflow moved to `.github/workflows/ci.yml`, now with `pnpm lint`, frozen lockfile and pnpm cache | dashboard, `.github/` |

Seed: the receptionist role gets `patients:block`; a new demo member `reception.maadi@demo.test` is limited to Maadi.

## Migrations and their risks

| Migration | Risk | Notes |
| --- | --- | --- |
| `20261026000012_money_and_record_integrity` | Low | No API path wrote money yet. Replaces `payments_validate()` / `payment_plans_validate()` bodies (down restores the 0001 bodies). FK pre-check stops with a message instead of changing data |
| `20261026000013_audit_triggers` | Low | Adds one audit row per money/booking change: more `audit_log` volume (partitioning at ~1M rows is already in NFR-13) |
| `20261026000014_permission_catalogue` | Low | **Behaviour change on existing databases:** seeded roles gain rights (e.g. receptionist `clinical:read`, as the SRS matrix says). Rollback keeps granted rights on purpose |
| `20261026000015_branch_access` | Medium | Every query on branch-scoped tables gets the policy predicate (evaluated once per statement; child tables use an `EXISTS` on the parent). Nobody is branch-limited until members are restricted, so current users see no difference. `release_expired_holds()` now runs as `app_definer` with an explicit clinic filter |
| `20261026000016_users_least_privilege` | Medium | Any future `selectAll()` on `users` from the API now fails; identity e2e covers today's queries |

All five were rolled back and re-applied on the test database. The dev database was migrated (no generated type
changes).

## Tests (run 2026-10-17)

| Suite | Result |
| --- | --- |
| `pnpm build` (db, api, web, dashboard) | passed |
| `pnpm typecheck` (5 packages) | passed |
| `pnpm lint` (api, dashboard, web) | passed |
| Database tests | **215 checks passed** (68 new: `13_money_integrity` 26, `14_audit_triggers` 11, `15_branch_access` 17, `16_permissions_and_users` 14) |
| API e2e + unit | **14 suites, 155 tests passed** (new `access.e2e-spec.ts`: branch-limited receptionist, override fix, block permission; identity suite switched to email codes and checks that no SMS is sent) |
| Dashboard / website unit | 37 / 20 passed |

Not verified: the CI workflow's first run on GitHub (nothing was pushed).

## Not done in Phase C (with their phase)

- ACCESS-005 (access changes on the next request): with the members module, D1. Until then a disabled member keeps
  rights up to 15 minutes, but `member_branch_ids()` already returns no branches for a disabled member.
- AUDIT-003 for settings, doctors/services and staff changes: D1/D2 (bookings are done).
- Payment **reversal** (the correction path PAY-003 points to) is built with the billing API in Phase E (E-01).
- Rows written by triggers carry no IP / user agent (the request audit rows from the API still do).
- `api-test.txt` (an old committed test log) is still in the repository.

## Decisions still open

CLR-02, 03, 04, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17 (`docs/SRS.md` Part C). Phase D needs CLR-06, 10, 11,
13, 14, 15, 16.
