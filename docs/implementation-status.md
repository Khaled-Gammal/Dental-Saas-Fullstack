# Implementation status

The tracker for every requirement in `docs/SRS.md`. **Where this file and the SRS disagree, this file wins.**
It is updated at the end of every phase. A status changes only with evidence: code, plus a test that ran and passed.

Last updated: 2026-10-19, end of Phase G (final report: `docs/reviews/2026-10-19-phase-g-final.md`).

## Last verification run (2026-10-19, Phase G)

| Check | Result |
| --- | --- |
| Database tests (`pnpm db:test`) | 27 files, **431 checks passed** |
| API e2e + unit (`pnpm --filter @dental/api test`) | 30 suites, **296 tests passed** |
| Dashboard unit (vitest) | 17 files, 75 passed |
| Website unit (vitest) | 23 passed |
| `pnpm lint` | passed |
| `pnpm typecheck` | passed |
| `pnpm build` | passed |
| CI on GitHub | **success**: runs 39055317969 (D2), 39056413149 (D3), 39060899597 (`v4/phase-d4-clinical`, d6eb1f4), 39061929809 (`v4/phase-d5-merge`, c687e15), 39064242614 (`v4/phase-e1-billing`, fb47040; the first E1 run failed on an order-dependent test, fixed), 39066575882 (`v4/phase-e2-discounts`, c817d40), 39069462390 (`v4/phase-e3-cash`, ccc0942), 39286909563 (`v4/phase-e4-reports`, d113a5d), 39289331406 (`v4/phase-f1-arabic`, 4e3870e), 39291399273 (`v4/phase-f2-arabic-messages`, 1835e68), 39292552125 (`v4/phase-f3-website`, 69e0d88), 39295231986 (`v4/phase-f4-home`, 976427b), 39307625328 (`v4/phase-g-verification`, 266aa0d; the two runs before failed on a flaky calendar test, fixed) |
| Browser check | **dashboard: done (Phase G)**. 33 screens as the owner at 390 px and 1280 px in a same-origin frame, with scripted checks for overflow, English words and errors. Two fixes (profile and visit overflow at phone width; the bare new-invoice link). No English interface text. Website: home, booking page and 404 at 390 px; fixed the English "Powered by" badge and the framework's English 404 (now `app/not-found.tsx`). Paper printing: not verified |

## Clinic workflow (SRS §3)

| # | Step | Status | Missing for "done" |
| --- | --- | --- | --- |
| 1 | Sign up | IMPLEMENTED | terms acceptance (AUTH-01) |
| 2 | Clinic setup | IMPLEMENTED | — (currency setting added in E1) |
| 3 | Branch setup | IMPLEMENTED | — |
| 4 | Staff and doctor setup | IMPLEMENTED | — |
| 5 | Services and pricing | IMPLEMENTED | — |
| 6 | Booking | IMPLEMENTED | patient self-service links (BOOK-08, deferred) |
| 7 | Check-in | IMPLEMENTED | — |
| 8 | Clinical visit | IMPLEMENTED | — |
| 9 | Chart and treatment plan | IMPLEMENTED | — |
| 10 | Procedures | IMPLEMENTED | — |
| 11 | Prescription | IMPLEMENTED | print check on paper (Chrome, Edge, Safari) |
| 12 | Invoice | IMPLEMENTED (E1, E2) | — |
| 13 | Payments | IMPLEMENTED (E1, E2, E3) | back-dating a payment (not offered; payments are dated now) |
| 14 | Follow-up | IMPLEMENTED | — |
| 15 | Expenses and cash | IMPLEMENTED (E3, H2) | — |
| 16 | Reporting | IMPLEMENTED (E4, F4) | Excel export (deferred) |

## Part B — approved new requirements

| ID | Title | Status | Phase | Evidence / note |
| --- | --- | --- | --- | --- |
| AUTH-101 | Email verification at sign-up | IMPLEMENTED | C | `signup.service.ts`, `POST /auth/verify-email`; `identity.e2e-spec.ts` (code by email, none by SMS, lockout, resend limits) |
| AUTH-102 | Password reset by email | IMPLEMENTED | D1 | `password-reset.service.ts`; `staff.e2e-spec.ts` (code by email, old sessions end, no enumeration) |
| ACCESS-001 | Staff invitation by email | IMPLEMENTED | D1 | `modules/staff`, migration 0017 `open_invitation()`; dashboard `#/staff/new`, `#/invite/<token>`; `staff.e2e-spec.ts`, `17_staff_access.sql` |
| ACCESS-002 | Member management | IMPLEMENTED | D1 | `PATCH /staff/members/:id`, last-owner guard (API + trigger); dashboard `#/staff/<id>/edit` |
| ACCESS-003 | Branch-scoped access | IMPLEMENTED | C | Restrictive RLS (migration 0015) + `branch_forbidden` in scheduling; `15_branch_access.sql`, `access.e2e-spec.ts`. Cash sessions get the policy when they exist (E) |
| ACCESS-004 | Permission catalogue + separation | IMPLEMENTED | C | Migration 0014; `16_permissions_and_users.sql`. New permissions are enforced as their features arrive (`patients:block` now) |
| ACCESS-005 | Access changes on the next request | IMPLEMENTED | D1 | `access_version` + `member_access_state()` checked in `JwtAuthGuard`; `staff.e2e-spec.ts` |
| APPT-001 | Reschedule | IMPLEMENTED | D2 | `POST /appointments/:id/move`, `appointment.rescheduled` worker handler; dashboard `#/appointments/<id>/edit`; `calendar.e2e-spec.ts` |
| APPT-002 | Staff booking validation | IMPLEMENTED | C | API (`doctor_inactive`, `doctor_not_at_branch`) + trigger (0012); `access.e2e-spec.ts`, `13_money_integrity.sql` |
| APPT-003 | Waiting list | IMPLEMENTED | D2 | Appointments "قائمة الانتظار" view (`calendar-model.ts` `waitingList`, unit-tested) |
| APPT-004 | Doctor's day | IMPLEMENTED | D2 | `GET /appointments?mine=true`; doctors open on "مواعيدي" |
| APPT-005 | Holidays, doctor time off | IMPLEMENTED | D2 | `/holidays`, `/doctors/:id/time-off` (conflicts listed, nothing cancelled); dashboard `#/holidays`, `#/doctors/<id>/timeoff` |
| APPT-006 | Rooms and chairs | IMPLEMENTED | D2 | `/branches/:id/rooms`, room via the move endpoint; dashboard `#/branches/<id>/rooms` |
| APPT-007 | Follow-up booking from a visit | IMPLEMENTED | D4 | visit "book the next appointment" pre-fills patient/doctor/branch/next planned item; `POST /plans/:id/items/:itemId/schedule`; a cancelled or missed booking puts the item back (trigger); `clinical.e2e-spec.ts` |
| APPT-008 | — | WITHDRAWN | — | Covered by AUDIT-003 |
| APPT-009 | Booking settings screen | IMPLEMENTED | D2 | `/clinic/booking-settings`; dashboard `#/booking` |
| PATIENT-001 | Arabic-normalised search | IMPLEMENTED | D3 | migrations 0019 `ar_normalize()`, `patients.full_name_norm` (generated) + 0020 trigram index; `patients.repository.ts`; `19_patients_search_history_files.sql`, `patients-d3.e2e-spec.ts` |
| PATIENT-002 | Possible-duplicate warning | IMPLEMENTED | D3 | `GET /patients/duplicates` (main, alternative or guardian phone; same normalised name; close name + same birth date); warning on the new-patient form, never a block; e2e |
| PATIENT-003 | Merge duplicates | IMPLEMENTED | D5 | migration 0022 `merge_patients()` (one transaction, every table, clinic-checked, app_definer), `patient_merge_counts()`; `GET /patients/:id/merge-preview`, `POST /patients/:id/merge` (patients:merge); `#/patients/<id>/merge`; `21_patient_merge.sql`, `patients-merge.e2e-spec.ts` |
| PATIENT-004 | Clinical documents and images | IMPLEMENTED (patient level) | D3 | `patient-files.*`, `clinical-files.ts` (type from the bytes, 20 MB, 5-minute links bound to clinic + file + user, audited opening), archive with reason, `files_clinical_private`; dashboard files card; unit + e2e. Visit link waits for D4 |
| PATIENT-005 | Medical history versions + alerts | IMPLEMENTED | D3/D4 | Versions: `patient_medical_history_versions` (append-only, trigger, back-filled), `GET /patients/:id/medical-history/versions` (clinical:read, audited); profile alerts. D4: allergies, pregnancy and conditions on top of the visit screen (`GET /visits/:id` includes the history) |
| VISIT-001 | Clinical visit | IMPLEMENTED | D4 | `modules/clinical`, `POST /visits` (own appointment, checked in; walk-in), trigger starts the appointment; dashboard `#/visits/<id>/view`, "فتح الزيارة" on the day list; e2e + `20_clinical_workflow.sql` |
| VISIT-002 | Finalize and amend notes | IMPLEMENTED | D4 | CLR-06 default: `visits_guard` refuses changing a final note, completion finalizes; `visit_amendments` append-only; author or owner amends with a reason |
| VISIT-003 | Procedures performed | IMPLEMENTED | D4 | CLR-16 price range (API + `visit_procedures_workflow`), plan item done, fixed once the visit is final or the procedure billed |
| VISIT-004 | Prescriptions | IMPLEMENTED (print not verified on paper) | D4 | issued, never edited (REVOKE + trigger), correction replaces once; `#/prescriptions/<id>/print` A5/A4, RTL |
| VISIT-005 | Follow-up list (manual) | IMPLEMENTED | D4 | `/recalls` (due, upcoming, closed), call log, book, dismiss; follows its appointment (trigger); `#/followups`; no automatic messages |
| CHART-001 | Dental chart | IMPLEMENTED | D4 | `GET/POST /patients/:id/chart`, append-only, visit entries checked against the patient; FDI chart never mirrored (checked in the browser) |
| TPLAN-001 | Create/edit treatment plan | IMPLEMENTED | D4 | `/patients/:id/plans`, `/plans/:id/items`; estimate derived; `#/plans/<id>/view` |
| TPLAN-002 | Plan status | IMPLEMENTED | D4 | CLR-11 default (member + time); `treatment_plans_guard`; progress derived from items |
| TPLAN-003 | Planned vs. performed | IMPLEMENTED | D4 | item done through a procedure only; accepted items fixed, cancelled kept |
| TPLAN-004 | Plan summary | IMPLEMENTED | D4/H1 | estimate, done, remaining, next visit (D4); H1: invoiced, paid and balance per plan from issued invoices of its procedures, shared invoices pro rata (`planBilling`, unit-tested), shown to members who may see the billing; `clinical.e2e-spec.ts` |
| BILLING-001 | Draft invoice | IMPLEMENTED | E1 | `modules/billing`, `POST /invoices` from unbilled procedures and service lines; `#/invoices/new` |
| BILLING-002 | Issue invoice + numbering | IMPLEMENTED | E1 | migration 0023 `issue_invoice()` ({prefix}-{year}-{seq}, gap-free, tax half up), number locked; `22_billing_payments.sql` |
| BILLING-003 | Void invoice | IMPLEMENTED | E1 | `POST /invoices/:id/void` (invoices:void, reason, nothing paid) |
| BILLING-004 | Arabic invoice/receipt print | IMPLEMENTED (print not verified on paper) | E1 | `#/invoices/<id>/print` (A4), `#/payments/<id>/print` (A5) |
| BILLING-005 | Patient balance | IMPLEMENTED | E1/H1 | `GET /patients/:id/billing` (profile, payment screen); H1: `GET /balances?patientIds=` (invoices:read, or :own for the doctor's patients) shows «عليه …» on the day list and waiting list and in the code check-in confirmation; `clinical.e2e-spec.ts` |
| PAY-001 | Record a payment (methods) | IMPLEMENTED | E1 | receiver = signed-in member, idempotency key, reference CHECK; dated now; refused on a closed cash day or in the future (E3) |
| PAY-002 | Partial and multiple payments | IMPLEMENTED | E1 | status derived; `billing.e2e-spec.ts` |
| PAY-003 | Immutable payments | IMPLEMENTED | C/E1 | `payments_guard()` (0012, 0023: succeeded → reversed with reason, nothing else); owner, or the receiver the same day (CLR-05) |
| PAY-004 | Installment plans | IMPLEMENTED (invoices) | E2 | `POST /invoices/:id/plan` (schedule = balance, dates in order), one active plan per invoice, installment payments, move a date, `GET /installments/overdue`; invoice page and "أقساط متأخرة" tab |
| PAY-005 | Refunds | IMPLEMENTED | E1 | method (may differ), branch, time, reason; payments:refund (owner, accountant); cash refunds reduce expected cash (E3) |
| PAY-006 | Adjustments | IMPLEMENTED | E2 | migration 0024 `balance_adjustments` (append-only; waiver of an installment, write-off ≤ balance); `invoices.adjusted_minor`, balance = total − paid − adjusted; owner only (payments:adjust) |
| DISC-001 | Fixed/percent discount + reason | IMPLEMENTED | E2 | line and invoice; percent → amount half up, follows the lines on a draft; reason required (DB) |
| DISC-002 | Authorization limits | IMPLEMENTED | E2 | `roles.max_discount_bp/minor` (CLR-02 defaults, also at sign-up); measured on every change; `#/discounts` |
| DISC-003 | Discount approval | IMPLEMENTED | E2 | pending blocks issuing (DB), no self-approval (DB), approve/reject with note, audited; owner queue |
| EXP-001 | Record an expense | IMPLEMENTED | E3/H2 | migration 0025; branch, category, amount, date (not future), method + reference rule, supplier, description; the recorder is the responsible member; `#/expenses`. H2 (migration 0028): supporting document `POST /expenses/:id/document` (PDF/JPEG/PNG/WebP by bytes, private, attached once by `expenses:write`, not on a void expense), 5-minute member-bound links `/expense-files/…` in their own signing scope; `27_expense_documents.sql`, `finance.e2e-spec.ts` |
| EXP-002 | Expense categories | IMPLEMENTED | E3 | 8 Arabic categories per clinic (back-filled, and at sign-up); owner adds and deactivates; never deleted |
| EXP-003 | Expense approval | IMPLEMENTED | E3/H2 | CLR-03: owner/accountant approved on entry; owner approves/rejects with a note; no self-approval (DB). Owner 2026-10-20 (migration 0029): reception has no expense access (`expenses:write:cash` retired, reception limit removed from the API and screen); pending ones recorded before still wait for the owner |
| EXP-004 | Expense corrections | IMPLEMENTED | E3 | money fields immutable (DB); void with reason, stays listed; status only moves forward |
| CASH-001…004 | Cash sessions, expected cash, close, reopen | IMPLEMENTED | E3 | CLR-04: one session per branch per business day (`cash:operate`: reception, accountant); expected = opening + cash in − cash refunds − cash expenses, other methods listed apart; a difference needs a note; nothing dated into a closed day (DB, race-safe); owner reopens with a reason, earlier figures kept; `#/cash` |
| REPORT-001…005 | Reports | IMPLEMENTED | E4 | migration 0026 `report_money/expenses/attendance/procedures/outstanding/overdue_installments()` (caller's rights, so RLS and branch access apply); `modules/reports` `GET /reports/{revenue,expenses,attendance,performance,outstanding,branches}`; reception today's revenue only, doctors their own attendance/performance; `#/reports` with A4 print; `25_reports.sql` (fixed data, sums = records, Maadi-only member), `reports.e2e-spec.ts`, `reports-rules.spec.ts` |
| REPORT-006 | Home per role | IMPLEMENTED | F4 | `GET /reports/home` builds only the blocks the member's rights cover (`homeSections`): reception today's appointments, waiting list, collections, cash box; doctor own day, waiting for them, own follow-ups due; owner/accountant today and month (invoiced, net collections, expenses, no-shows for both, owner's choice 2026-10-19) and outstanding/overdue. `screens/home-figures.tsx`; setup checklist only for the owner until done. `reports-rules.spec.ts`, `reports.e2e-spec.ts` (each block equals the matching report) |
| L10N-001 | Arabic only | IMPLEMENTED | F1/F3 | Dashboard (F1): always Arabic, no switch, no stored language, `arabic-only.test.ts`. Website (F3): the 404 English line and the platform page's English removed, Arabic metadata; `lib/__tests__/arabic.test.ts`. Brand and clinic names may be Latin (owner, 2026-10-19). Left: the English dictionary half in code (L10N-008) |
| L10N-002 | RTL everywhere | IMPLEMENTED | F/G | Dashboard: 33 screens checked at 390 px and 1280 px (G). Website: home, booking and an unknown address checked at 390 px after the restart (RTL, no overflow, 12-hour times, clinic currency) |
| L10N-003 | Arabic errors | IMPLEMENTED (dashboard) | F2 | every API error code has an Arabic text (`api-error-codes.test.ts` scans the API source and fails on a code without one); an unknown code shows Arabic for its HTTP status, never the English `detail`; field problems carry the Zod `rule` + limits (`zod-body.pipe.ts`) and read in Arabic (`validation-text.ts`). Website booking messages: F3 |
| L10N-004 | Arabic emails | IMPLEMENTED | F2 | every email Arabic only (verification and reset codes, booking confirmation and code, clinic notice, reminders, move, invitation); RTL HTML part + plain text (`arabic-mail.ts`, `smtp-email.sender.ts`); one date wording; worker test fails on English |
| L10N-005 | Currency | IMPLEMENTED | E1/F2/F3 | dashboard follows the clinic currency (F2); the public site payload now carries `currency` and the website prices use it (`formatMoney`, shared) |
| L10N-006 | Dates and times | IMPLEMENTED | F2/F3 | CLR-08: Latin digits and a 12-hour clock with ص/م in the dashboard, emails and website (hours, open now, booking times; `clock12`, shared). Structured data keeps 24-hour times (schema.org) |
| L10N-007 | Arabic data | PARTIALLY | F | Arabic stored and searched with normalisation (PATIENT-001); no export yet |
| L10N-008 | Remove multilingual infrastructure | IMPLEMENTED | F1/F3/F5 | F1: switch, stored language, English inputs (data kept, CLR-07). F3: `sites.locales = {ar}`. F5 (owner approved 2026-10-19): the dictionary holds Arabic only, `t(key)` without a language, the `lang` props, `Lang` type and language context removed from the dashboard (62 files), names via `arName()` (Arabic first, English only where no Arabic exists). `_en` and locale columns and their data stay |
| AUDIT-001 | Financial audit | IMPLEMENTED (DB) | C | Triggers on invoices, lines, payments, refunds, plans, installments, expenses (0013); `14_audit_triggers.sql`. New money tables (discounts, cash) add the same trigger in E |
| AUDIT-002 | Clinical audit | IMPLEMENTED | D4 | triggers on visits, amendments, procedures, chart, plans, items, prescriptions, follow-ups record what changed with clinical text as `true`; visit, prescription and chart views audited |
| AUDIT-003 | Operational audit | IMPLEMENTED | C/D1 | Triggers on bookings (0013) and on clinic, settings, branches, hours, holidays, rooms, doctors, schedules, time off, services, members, member branches, invitations, roles (0017) |
| SEC-101 | Cross-record consistency | IMPLEMENTED | C | 0012; `13_money_integrity.sql` |
| SEC-102 | Responsible-staff FKs | IMPLEMENTED | C | 0012 (9 columns, validated) |
| SEC-103 | Least privilege on `users` | IMPLEMENTED | C | 0016 `login_candidate()`; `16_permissions_and_users.sql`, identity e2e |
| OPS-001 | Green build and CI | IMPLEMENTED | C | build/typecheck/lint/test green; `.github/workflows/ci.yml`, GitHub run 39055317969 green |

## Part A — original requirements

Change annotations (superseded, refined, deviation) are in SRS §A.0. Statuses:

| Status | IDs |
| --- | --- |
| IMPLEMENTED | DSH-07 (BILLING/PAY/DISC), DSH-18 (PAY-004), DSH-03 (PATIENT-*), DSH-04 (CHART-001), DSH-06 (VISIT-*), AUTH-03, AUTH-04 (M part), AUTH-05, AUTH-06 (email, AUTH-102), AUTH-08 (email, ACCESS-001), AUTH-09, WEB-03, BOOK-01, BOOK-02, BOOK-03 (email deviation), BOOK-05, BOOK-06, BOOK-07 (email deviation), BOOK-09 (doctor), BOOK-10, BOOK-11, NTF-04, BIL-02, BIL-08, NFR-01, NFR-10 (DB) |
| PARTIALLY_IMPLEMENTED | DSH-05 (TPLAN-*; invoicing in E), DSH-19 (manual list VISIT-005; automatic recalls deferred), AUTH-01, ONB-01, ONB-02, WEB-01, WEB-02, WEB-05, WEB-06, WEB-10, BOOK-04, BOOK-09 (room), DSH-01, DSH-02, DSH-10, DSH-12, DSH-13, DSH-15, NTF-01, NTF-03, BIL-01, NFR-02, NFR-03, NFR-12, NFR-14, NFR-16 |
| NOT_IMPLEMENTED | LND-01, LND-02, LND-03, LND-04, LND-05, DSH-11 (→ REPORT-*), DSH-16, BIL-04…07, ADM-01, ADM-02, ADM-04, NFR-04, NFR-08, NFR-15 |
| SUPERSEDED | AUTH-02 for sign-up (→ AUTH-101, done: the phone-code endpoints were removed), WEB-04 (→ L10N-001), NFR-09 bilingual parts (→ L10N-*), §7.1 item 6 |
| DEFERRED | AUTH-04 Google, AUTH-07, ONB-03, WEB-07, WEB-08, WEB-09, BOOK-08, BOOK-12, DSH-09, DSH-14, DSH-17, DSH-20, NTF-02, NTF-05, BIL-03, ADM-03, ADM-05, ADM-06 |
| NEEDS_VERIFICATION | NFR-05, NFR-06, NFR-07, NFR-11, NFR-13 |

## Change log

| Date | Phase | Change |
| --- | --- | --- |
| 2026-10-17 | A | Audit (`docs/implementation-audit.md`) |
| 2026-10-17 | B | SRS v4, database design, roadmap, this tracker. Decision D-01 (email verification, no SMS) |
| 2026-10-20 | H2b | Owner: expenses are the owner's and the accountant's only; reception keeps bookings, patients, patient payments and the cash box. Migration 0029 (retires `expenses:write:cash`, bumps the access version of the members concerned) |
| 2026-10-20 | H2 | EXP-001 supporting document. Migration 0028 (`expenses_guard`: document attached once; private files of the clinic; one expense per file) |
| 2026-10-19 | H1 | BILLING-005 at check-in (`GET /balances`), TPLAN-004 invoiced/paid/balance per plan. No migration |
| 2026-10-19 | F5 | Owner confirmed the "my day" rule and asked for no-shows today as well as the month (home). L10N-008 cleanup approved and done: Arabic-only dictionary and no `lang` plumbing in the dashboard. No migration |
| 2026-10-19 | G | Full run (431 DB, 296 API, 75 dashboard, 23 website), browser sweep of 33 dashboard screens at two widths; fixed the profile/visit overflow at phone width and the bare new-invoice link. Final report |
| 2026-10-19 | F4 | REPORT-006 home per role (`GET /reports/home`, `screens/home-figures.tsx`). No migration. Phase F complete except the optional L10N-008 code cleanup |
| 2026-10-19 | F3 | Migration 0027 (sites Arabic only). Website: clinic currency on prices, 12-hour Latin-digit times, Arabic booking fallback, no English text; specialty and money and clock helpers shared in `@dental/ui/text` |
| 2026-10-19 | F2 | Arabic for every API error and validation message (automated check), Arabic-only RTL emails, clinic currency everywhere in the dashboard, 12-hour times, specialty labels shared with the website. No migration |
| 2026-10-19 | F1 | CLR-07/08 answered (defaults; brand names may be in Latin letters). Dashboard Arabic only: switch and stored language removed, English inputs hidden (data kept), name fields accept Latin brand names (`dir="auto"`), Arabic-only dictionary test. No migration |
| 2026-10-19 | E4 | Migration 0026 (report functions; system roles get their missing default `reports:*` rights); REPORT-001…005 done. Seed: receptionist reports:read:daily, doctor reports:read:own |
| 2026-10-17 | E3 | Migration 0025; EXP-002…004, CASH-001…004 done; EXP-001 partial (no supporting document). Seed: receptionist expenses:write:cash + cash:operate, accountant cash:operate. Demo script: E3 block |
| 2026-10-17 | E2 | Migration 0024; DISC-001…003, PAY-004 (invoices), PAY-006 done. Seed: receptionist discounts:apply. Demo data script `seed:demo-billing` |
| 2026-10-17 | E1 | Migration 0023; BILLING-001…004, PAY-001/002/003/005 done; BILLING-005 partly. CLR-02, 03, 04, 09, 12, 17 defaults accepted. Seed: receptionist payments:reverse, doctor invoices:read:own |
| 2026-10-17 | D5 | Migration 0022; PATIENT-003 done (merge with CLR-15 default); D4 CI green |
| 2026-10-17 | D4 | Migration 0021; VISIT-001…005, CHART-001, TPLAN-001…003, APPT-007, AUDIT-002, PATIENT-005 done; TPLAN-004 partly. Seed: doctor role gains clinical:read and treatments:write:own; demo accountant added |
| 2026-10-17 | D3 | Migrations 0019–0020; PATIENT-001, 002, 004 done; PATIENT-005 versions done (visit alert in D4); OPS-001 verified on GitHub |
| 2026-10-17 | D2 | Migration 0018; APPT-001, 003, 004, 005, 006, 009 done; CI also runs on `v4/**` pushes |
| 2026-10-17 | D1 | Migration 0017; ACCESS-001/002/005, AUTH-102, AUDIT-003 done. Defaults accepted for CLR-06, 10, 11, 13, 14, 15, 16 |
| 2026-10-17 | C | Migrations 0012–0016; AUTH-101, ACCESS-003/004, APPT-002, PAY-003, AUDIT-001, SEC-101/102/103, OPS-001 done; AUDIT-003 partly. CLR-05 default and branch-access option B applied |
