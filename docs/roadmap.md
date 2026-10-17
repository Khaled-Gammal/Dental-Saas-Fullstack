# Roadmap

Last updated 2026-10-17. Requirement IDs: `docs/SRS.md`. Progress per requirement: `docs/implementation-status.md`.

Work goes **one phase at a time**. Each phase ends with a report: files changed and why, requirements completed
and not completed, migrations and their risks, tests that actually ran and their results, and decisions needed.
Then the next phase waits for review.

## 1. v4 phases (clinic workflow, finance, Arabic only)

| Phase | Content | Exit criteria | Status |
| --- | --- | --- | --- |
| **A — Audit** | Repository, SRS and schema audit | `docs/implementation-audit.md` | ✅ done 2026-10-17 |
| **B — Documentation** | SRS v4, database design, roadmap, status tracker | The four documents reviewed | ✅ done 2026-10-17 |
| **C — Security and data integrity** | OPS-001 (dashboard typecheck/build, CI workflow), PAY-003 + AUDIT-001 (immutable money, financial audit), SEC-101/102/103, ACCESS-004 (permission catalogue), ACCESS-003 (branch access, design reviewed first), APPT-002 (staff booking fix), AUDIT-003 (appointment moves), AUTH-101 (email verification at sign-up, no SMS) | `pnpm typecheck lint test build` green; a DB test for every new rule; branch-isolation tests | ✅ done 2026-10-17 (`docs/reviews/2026-10-17-phase-c-security.md`; ACCESS-005 and the rest of AUDIT-003 moved to D1) |
| **D — Clinic workflow** | ✅ D1–D5 done 2026-10-17 (`docs/reviews/2026-10-17-phase-d1-staff.md`, `…-phase-d2-scheduling.md`, `…-phase-d3-patients.md`, `…-phase-d4-clinical.md`, `…-phase-d5-merge.md`). D1 staff: ACCESS-001/002/005, AUTH-102, AUDIT-003 (settings, staff). D2 scheduling: APPT-001, 003–006, 009 (APPT-007 moves to D4: it needs visits). D3 patients: PATIENT-001, 002, 004, 005 (the visit-screen alert of PATIENT-005 moves to D4). D4 clinical: VISIT-001…005, CHART-001, TPLAN-001…004, AUDIT-002, APPT-007, PATIENT-005 visit alert. D5: PATIENT-003 (merge) | Workflow steps 1–11 and 14 of SRS §3 work end to end in the browser, in Arabic | ✅ built and tested; the full click-through in the browser is still to do (Phase G) |
| **E — Financial features** | E1 billing & payments (BILLING-001…005, PAY-001/002/003/005) ✅ 2026-10-17 (`docs/reviews/2026-10-17-phase-e1-billing.md`). E2 discounts, installments, adjustments (DISC-001…003, PAY-004, PAY-006) ✅ 2026-10-17 (`…-phase-e2-discounts.md`). E3 expenses and cash days (EXP-001…004, CASH-001…004) ✅ 2026-10-17 (`…-phase-e3-cash.md`; expense documents deferred). E4 reports (REPORT-001…005). CLR-02/03/04/09/12/17 defaults accepted 2026-10-17 | Steps 12, 13, 15, 16 work; money tests include two-session concurrency; Arabic printouts | E1, E2, E3 done |
| **F — UX and Arabic only** | L10N-001…008, REPORT-006 (home per role), RTL review of every screen, empty/loading/error states | The Arabic-only acceptance criteria (SRS L10N-*) pass | — |
| **G — Final verification** | Full test run, browser checks at phone and desktop widths, final report | Final implementation report (brief §13) | — |

Large phases are split into the sub-phases shown (D1…D5), each reviewed before the next. Risky schema changes
(branch access, Arabic search back-fill) are proposed for review before they are written.

### Decisions each phase needs

| Phase | Decisions (SRS Part C) |
| --- | --- |
| D | CLR-06 (note finalization), CLR-10 (doctor visibility), CLR-11 (plan acceptance), CLR-15 (merge), CLR-16 (procedure price) |
| E | CLR-02 (discount limits/approval), CLR-03 (expense approval), CLR-04 (cash session), CLR-12 (adjustments), CLR-17 (print format) |
| F | CLR-07 (English content), CLR-08 (digits/clock), CLR-09 (currency) |
| Before D | CLR-13 (pause the website-content roadmap), CLR-14 (consents, super admin) |

## 2. Website-content roadmap

`docs/roadmap-website-content.md` (gallery done; offers, success stories, public pages, homepage, QA pending).
Proposed: **pause phases 2–6 until v4 Phase E is done (CLR-13).** Website "offers" are display-only marketing and
are not the billing discounts of DISC-*.

## 3. Deferred (not in v4)

| Item | SRS | Earliest | Notes |
| --- | --- | --- | --- |
| WhatsApp Business API, WhatsApp automation | NTF-01, brief §8 | After v4, on approval | Paid service. The clinic's WhatsApp number stays display-only; staff message patients manually |
| SMS of any kind (verification, reminders), paid messaging | NTF-01/05, AUTH-02 | After v4, on approval | Email replaces it (decision D-01). The `SMS_SENDER` port stays and is unused |
| Payment gateways (Paymob, Fawry, Stripe), online booking payment, gateway keys | BOOK-04, BIL-03, NFR-04 | On approval | v4 records payments manually |
| Automatic bank / wallet / InstaPay reconciliation | — | Not planned | — |
| Dental laboratory tracking | DSH-17 | After v4 | Tables exist |
| Doctor commissions and payouts | DSH-20 | After v4 | Tables and triggers exist and are tested |
| Advanced patient financing | — | Not planned | Installments (PAY-004) cover v4 |
| Advanced analytics, Excel export | DSH-11 | After v4 | v4 has REPORT-001…006 with print |
| Automatic recalls | DSH-19 | After v4 | v4 has the manual follow-up list |
| Inventory | DSH-09 | V2 | — |
| Consent signing | DSH-16 | Pending CLR-14 | MVP in v3 |
| Super-admin panel | ADM-* | Pending CLR-14 | MVP in v3 |
| SaaS subscription billing | BIL-03…07 | With a gateway | — |
| Waitlist, patient self-service links | BOOK-12, BOOK-08 | V1/V2 | — |
| Notification templates, in-app notifications | NTF-02, NTF-01 | V1 | Arabic templates only |
| Google sign-in, 2FA | AUTH-04, AUTH-07 | V1 | — |
| Landing page, pricing, leads, demo | LND-* | Not scheduled | Arabic only when built |
| Patient import, data export, tenant deletion | ONB-03, NFR-08 | Not scheduled | — |
| Egyptian Tax Authority e-invoicing | v3 §7.2 | Open question | — |

**Not on the roadmap at all: English localization.** The product is Arabic only (L10N-001); English will not be
added as a future feature unless that is explicitly requested.
