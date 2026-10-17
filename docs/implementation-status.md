# Implementation status

The tracker for every requirement in `docs/SRS.md`. **Where this file and the SRS disagree, this file wins.**
It is updated at the end of every phase. A status changes only with evidence: code, plus a test that ran and passed.

Last updated: 2026-10-17, end of Phase C (review: `docs/reviews/2026-10-17-phase-c-security.md`).

## Last verification run (2026-10-17, end of Phase C)

| Check | Result |
| --- | --- |
| Database tests (`pnpm db:test`) | 17 files, **215 checks passed** |
| API e2e + unit (`pnpm --filter @dental/api test`) | 14 suites, **155 tests passed** |
| Dashboard unit (vitest) | 37 passed |
| Website unit (vitest) | 20 passed |
| `pnpm lint` | passed |
| `pnpm typecheck` | passed |
| `pnpm build` | passed |
| CI on GitHub | workflow in place; first run not yet observed (not pushed) |

## Clinic workflow (SRS §3)

| # | Step | Status | Missing for "done" |
| --- | --- | --- | --- |
| 1 | Sign up | IMPLEMENTED | terms acceptance (AUTH-01) |
| 2 | Clinic setup | IMPLEMENTED | currency display setting (L10N-005) |
| 3 | Branch setup | PARTIALLY | holidays, rooms (APPT-005/006) |
| 4 | Staff and doctor setup | PARTIALLY | invitations, members (ACCESS-001/002/005); branch access is enforced |
| 5 | Services and pricing | IMPLEMENTED | — |
| 6 | Booking | PARTIALLY | reschedule (APPT-001) |
| 7 | Check-in | PARTIALLY | waiting list (APPT-003) |
| 8 | Clinical visit | NOT_IMPLEMENTED | VISIT-001/002 |
| 9 | Chart and treatment plan | NOT_IMPLEMENTED | CHART-001, TPLAN-* |
| 10 | Procedures | NOT_IMPLEMENTED | VISIT-003 |
| 11 | Prescription | NOT_IMPLEMENTED | VISIT-004 |
| 12 | Invoice | NOT_IMPLEMENTED (DB only) | BILLING-*, DISC-* |
| 13 | Payments | NOT_IMPLEMENTED (DB only) | PAY-* |
| 14 | Follow-up | PARTIALLY | APPT-007, VISIT-005 |
| 15 | Expenses and cash | NOT_IMPLEMENTED | EXP-*, CASH-* |
| 16 | Reporting | NOT_IMPLEMENTED | REPORT-* |

## Part B — approved new requirements

| ID | Title | Status | Phase | Evidence / note |
| --- | --- | --- | --- | --- |
| AUTH-101 | Email verification at sign-up | IMPLEMENTED | C | `signup.service.ts`, `POST /auth/verify-email`; `identity.e2e-spec.ts` (code by email, none by SMS, lockout, resend limits) |
| AUTH-102 | Password reset by email | NOT_IMPLEMENTED | D1 | No endpoint |
| ACCESS-001 | Staff invitation by email | NOT_IMPLEMENTED | D1 | `invitations`, `invitation_by_token()` DB only |
| ACCESS-002 | Member management | NOT_IMPLEMENTED | D1 | — |
| ACCESS-003 | Branch-scoped access | IMPLEMENTED | C | Restrictive RLS (migration 0015) + `branch_forbidden` in scheduling; `15_branch_access.sql`, `access.e2e-spec.ts`. Cash sessions get the policy when they exist (E) |
| ACCESS-004 | Permission catalogue + separation | IMPLEMENTED | C | Migration 0014; `16_permissions_and_users.sql`. New permissions are enforced as their features arrive (`patients:block` now) |
| ACCESS-005 | Access changes on the next request | NOT_IMPLEMENTED | D1 | Permissions live in the 15-min JWT; a disabled member already loses branch-scoped rows |
| APPT-001 | Reschedule | NOT_IMPLEMENTED | D2 | — |
| APPT-002 | Staff booking validation | IMPLEMENTED | C | API (`doctor_inactive`, `doctor_not_at_branch`) + trigger (0012); `access.e2e-spec.ts`, `13_money_integrity.sql` |
| APPT-003 | Waiting list | PARTIALLY | D2 | Day list shows `checked_in` |
| APPT-004 | Doctor's day | PARTIALLY | D2 | No "my appointments" filter |
| APPT-005 | Holidays, doctor time off | NOT_IMPLEMENTED (read only) | D2 | Honoured by availability (`dayContext()`), no CRUD |
| APPT-006 | Rooms and chairs | NOT_IMPLEMENTED (DB only) | D2 | Room exclusion constraint exists |
| APPT-007 | Follow-up booking from a visit | NOT_IMPLEMENTED | D4 | — |
| APPT-008 | — | WITHDRAWN | — | Covered by AUDIT-003 |
| APPT-009 | Booking settings screen | NOT_IMPLEMENTED | D2 | `tenant_settings` defaults only |
| PATIENT-001 | Arabic-normalised search | NOT_IMPLEMENTED | D3 | Trigram + ILIKE only |
| PATIENT-002 | Possible-duplicate warning | NOT_IMPLEMENTED | D3 | — |
| PATIENT-003 | Merge duplicates | NOT_IMPLEMENTED (DB only) | D5 | `merged_into_id` honoured by reads |
| PATIENT-004 | Clinical documents and images | NOT_IMPLEMENTED | D3 | Media handles website images only |
| PATIENT-005 | Medical history versions + alerts | PARTIALLY | D3 | History saved and audited (`patients.service.ts`); no versions |
| VISIT-001 | Clinical visit | NOT_IMPLEMENTED (DB only) | D4 | `visits` |
| VISIT-002 | Finalize and amend notes | NOT_IMPLEMENTED | D4 | Needs CLR-06 |
| VISIT-003 | Procedures performed | NOT_IMPLEMENTED (DB only) | D4 | `visit_procedures`, billed-once trigger tested |
| VISIT-004 | Prescriptions | NOT_IMPLEMENTED (DB only) | D4 | — |
| VISIT-005 | Follow-up list (manual) | NOT_IMPLEMENTED (DB only) | D4 | `recalls` |
| CHART-001 | Dental chart | NOT_IMPLEMENTED (DB only) | D4 | `tooth_records` append-only grant |
| TPLAN-001 | Create/edit treatment plan | NOT_IMPLEMENTED (DB only) | D4 | — |
| TPLAN-002 | Plan status | NOT_IMPLEMENTED | D4 | Needs CLR-11 |
| TPLAN-003 | Planned vs. performed | NOT_IMPLEMENTED | D4 | Separate tables exist |
| TPLAN-004 | Plan summary | NOT_IMPLEMENTED | D4/E | — |
| BILLING-001 | Draft invoice | NOT_IMPLEMENTED (DB only) | E | `invoices_derive()`, `04_billing.sql` |
| BILLING-002 | Issue invoice + numbering | NOT_IMPLEMENTED | E | No `issue_invoice()` |
| BILLING-003 | Void invoice | NOT_IMPLEMENTED (DB only) | E | Void rules tested |
| BILLING-004 | Arabic invoice/receipt print | NOT_IMPLEMENTED | E | Needs CLR-17 |
| BILLING-005 | Patient balance | NOT_IMPLEMENTED (DB only) | E | `balance_minor` generated |
| PAY-001 | Record a payment (methods) | PARTIALLY (DB only) | E | Method CHECK has cash/card/wallet/bank_transfer/instapay; no reference column |
| PAY-002 | Partial and multiple payments | PARTIALLY (DB only) | E | Tested in `04_billing.sql`, `05_concurrency.sql` |
| PAY-003 | Immutable payments | IMPLEMENTED (DB) | C | `payments_guard()`, refunds not editable (0012); `13_money_integrity.sql`. The reversal path is built with billing (E-01) |
| PAY-004 | Installment plans | PARTIALLY (DB only) | E | Status derivation and totals (0012) tested; no API |
| PAY-005 | Refunds | PARTIALLY (DB only) | E | No method/branch; needs CLR-05 |
| PAY-006 | Adjustments | BLOCKED | E | CLR-12 |
| DISC-001 | Fixed/percent discount + reason | NOT_IMPLEMENTED | E | Amount columns only |
| DISC-002 | Authorization limits | NOT_IMPLEMENTED | E | CLR-02 |
| DISC-003 | Discount approval | NOT_IMPLEMENTED | E | CLR-02 |
| EXP-001 | Record an expense | NOT_IMPLEMENTED (minimal table) | E | — |
| EXP-002 | Expense categories | NOT_IMPLEMENTED | E | — |
| EXP-003 | Expense approval | NOT_IMPLEMENTED | E | CLR-03 |
| EXP-004 | Expense corrections | NOT_IMPLEMENTED | E | — |
| CASH-001…004 | Cash sessions, expected cash, close, reopen | NOT_IMPLEMENTED | E | No tables; CLR-04 |
| REPORT-001…005 | Reports | NOT_IMPLEMENTED | E | — |
| REPORT-006 | Home per role | PARTIALLY | F | Setup checklist only (`screens/overview.tsx`) |
| L10N-001 | Arabic only | PARTIALLY | F | Website Arabic-only; dashboard has AR/EN switch (`App.tsx`) |
| L10N-002 | RTL everywhere | PARTIALLY | F | Website `dir="rtl"`; dashboard follows the switch |
| L10N-003 | Arabic errors | PARTIALLY | F | 42 of 57 API codes translated; Zod messages English |
| L10N-004 | Arabic emails | PARTIALLY | F | Booking emails bilingual |
| L10N-005 | Currency | PARTIALLY | F | EGP hard-coded in UI; `tenants.currency` exists |
| L10N-006 | Dates and times | PARTIALLY | F | Branch timezone used; digits inconsistent (CLR-08) |
| L10N-007 | Arabic data | PARTIALLY | D3/F | Arabic stored and searched; no normalisation; no export yet |
| L10N-008 | Remove multilingual infrastructure | NOT_IMPLEMENTED | F | `i18n.ts` (~520 AR/EN entries), toggle in `App.tsx` |
| AUDIT-001 | Financial audit | IMPLEMENTED (DB) | C | Triggers on invoices, lines, payments, refunds, plans, installments, expenses (0013); `14_audit_triggers.sql`. New money tables (discounts, cash) add the same trigger in E |
| AUDIT-002 | Clinical audit | PARTIALLY | D4 | Patient record + medical history audited (`audit-log.ts`) |
| AUDIT-003 | Operational audit | PARTIALLY | C/D | Bookings, moves, status changes audited by trigger (0013); settings, doctors/services, staff in D |
| SEC-101 | Cross-record consistency | IMPLEMENTED | C | 0012; `13_money_integrity.sql` |
| SEC-102 | Responsible-staff FKs | IMPLEMENTED | C | 0012 (9 columns, validated) |
| SEC-103 | Least privilege on `users` | IMPLEMENTED | C | 0016 `login_candidate()`; `16_permissions_and_users.sql`, identity e2e |
| OPS-001 | Green build and CI | IMPLEMENTED (local) | C | build/typecheck/lint/test green; `.github/workflows/ci.yml` (first GitHub run not yet observed) |

## Part A — original requirements

Change annotations (superseded, refined, deviation) are in SRS §A.0. Statuses:

| Status | IDs |
| --- | --- |
| IMPLEMENTED | AUTH-03, AUTH-04 (M part), AUTH-05, AUTH-09, WEB-03, BOOK-01, BOOK-02, BOOK-03 (email deviation), BOOK-05, BOOK-06, BOOK-07 (email deviation), BOOK-09 (doctor), BOOK-10, BOOK-11, NTF-04, BIL-02, BIL-08, NFR-01, NFR-10 (DB) |
| PARTIALLY_IMPLEMENTED | AUTH-01, ONB-01, ONB-02, WEB-01, WEB-02, WEB-05, WEB-06, WEB-10, BOOK-04, BOOK-09 (room), DSH-01, DSH-02, DSH-03, DSH-10, DSH-12, DSH-13, DSH-15, NTF-01, NTF-03, BIL-01, NFR-02, NFR-03, NFR-12, NFR-14, NFR-16 |
| NOT_IMPLEMENTED | LND-01, LND-02, LND-03, LND-04, LND-05, AUTH-06 (→ AUTH-102), AUTH-08 (→ ACCESS-001), DSH-04 (→ CHART-001), DSH-05 (→ TPLAN-*), DSH-06 (→ VISIT-*), DSH-07 (→ BILLING/PAY/DISC), DSH-08 (→ EXP-*), DSH-11 (→ REPORT-*), DSH-16, DSH-18 (→ PAY-004), DSH-19 (→ VISIT-005), BIL-04…07, ADM-01, ADM-02, ADM-04, NFR-04, NFR-08, NFR-15 |
| SUPERSEDED | AUTH-02 for sign-up (→ AUTH-101, done: the phone-code endpoints were removed), WEB-04 (→ L10N-001), NFR-09 bilingual parts (→ L10N-*), §7.1 item 6 |
| DEFERRED | AUTH-04 Google, AUTH-07, ONB-03, WEB-07, WEB-08, WEB-09, BOOK-08, BOOK-12, DSH-09, DSH-14, DSH-17, DSH-20, NTF-02, NTF-05, BIL-03, ADM-03, ADM-05, ADM-06 |
| NEEDS_VERIFICATION | NFR-05, NFR-06, NFR-07, NFR-11, NFR-13 |

## Change log

| Date | Phase | Change |
| --- | --- | --- |
| 2026-10-17 | A | Audit (`docs/implementation-audit.md`) |
| 2026-10-17 | B | SRS v4, database design, roadmap, this tracker. Decision D-01 (email verification, no SMS) |
| 2026-10-17 | C | Migrations 0012–0016; AUTH-101, ACCESS-003/004, APPT-002, PAY-003, AUDIT-001, SEC-101/102/103, OPS-001 done; AUDIT-003 partly. CLR-05 default and branch-access option B applied |
