# Final implementation report — v4: clinic workflow, finance, Arabic only (2026-10-19)

This closes the 2026-10-17 brief: phases A (audit) to G (verification). Every phase was built on its own branch,
reviewed, and stopped for approval before the next. Per-phase details are in `docs/reviews/`. The status of every
requirement is in `docs/implementation-status.md`, which is the source of truth.

## 1. What was delivered

| Phase | Content | Branch (last commit) | CI |
| --- | --- | --- | --- |
| A, B | Audit; SRS v4, database design, roadmap, status tracker | — | — |
| C | Security and integrity: immutable payments, database audit trails, permission catalogue, branch-scoped access, least privilege, email verification at sign-up | `v4/phase-c-security` | green |
| D1–D5 | Staff invitations and roles; scheduling (moves, waiting list, holidays, time off, rooms, booking rules); Arabic patient search, duplicate warning, history versions, clinical files; clinical visits, notes, procedures, prescriptions, dental chart, treatment plans, follow-ups; patient merge | `v4/phase-d1-staff` … `v4/phase-d5-merge` | green |
| E1–E4 | Invoices and payments (methods, partial, reversal, refund, receipts); discounts with limits and approval, installments, waivers; expenses with approval and the daily cash box; reports (revenue, expenses, attendance, performance, balances) | `v4/phase-e1-billing` … `v4/phase-e4-reports` (d113a5d) | green |
| F1–F4 | Arabic only: dashboard without a language switch; Arabic errors, validation and emails; clinic currency and a 12-hour clock everywhere; website Arabic only; home screen per role | `v4/phase-f1-arabic` … `v4/phase-f4-home` (976427b) | green (F4: 39295231986) |
| G | Full test run, browser sweep at phone and desktop widths, four fixes, a flaky test fixed, this report | `v4/phase-g-verification` (266aa0d) | green (39307625328) |

The 16 steps of the clinic workflow (SRS §3) all work end to end: sign up → clinic and branch setup → staff and
doctors → services → booking → check-in → visit → chart and plan → procedures → prescription → invoice → payments →
follow-up → expenses and cash → reports.

## 2. Requirements

Of the 59 approved new requirements (SRS Part B), 56 are **IMPLEMENTED** and 1 is withdrawn (APPT-008, covered by
AUDIT-003). The rest are not complete:

| Requirement | What is missing |
| --- | --- |
| EXP-001 Record an expense | The supporting document (photo or PDF of the receipt). It needs private file upload for expenses |
| BILLING-005 Patient balance | Shown on the patient profile and payment screen, **not yet at check-in** |
| TPLAN-004 Plan summary | Estimate, done, remaining and next visit are shown; **invoiced, paid and balance per plan are not** |
| L10N-007 Arabic data | Arabic is stored, searched and printed; **export (CSV) does not exist yet** |
| L10N-008 Remove multilingual code | Done for everything a user sees. **By your choice**, the unused English half of the dashboard texts and the internal `lang` parameters are still in the code |

Also carried as "not verified": printing prescriptions, invoices and receipts **on paper** in Chrome, Edge and Safari
(VISIT-004, BILLING-004). Their screen layouts are checked.

Deferred on purpose (SRS Part D): WhatsApp and SMS, payment gateways, laboratory tracking, doctor commissions, Excel
export, automatic recalls, inventory, consent signing, the super-admin panel.

## 3. Database migrations (0012–0027)

All are additive: no table or column is dropped or renamed, and no existing data is rewritten except the noted
back-fills. Every migration has a tested down migration, and every one was applied to your dev database without a
rollback.

| Migration | Content | Risk to know |
| --- | --- | --- |
| 0012–0016 | Immutable payments, cross-record consistency, audit triggers, permission catalogue, branch access, users least privilege | Branch-limited members see only their branches everywhere |
| 0017–0018 | Staff access (`access_version`), scheduling setup | A role change takes effect on the next request |
| 0019–0020 | Arabic-normalised patient name (generated column), trigram index | Index built on existing data |
| 0021–0022 | Clinical workflow; patient merge | Visits and chart entries are never deleted |
| 0023–0025 | Billing and payments, discounts and installments, expenses and cash box | **A closed cash day refuses any payment dated into it until the owner reopens it** (CLR-04) |
| 0026 | Report functions (caller's rights); missing default report rights for system roles | — |
| 0027 | Websites Arabic only (`sites.locales = {ar}`) | Nothing reads the column |

## 4. Verification in this phase (run 2026-10-19)

| Check | Result |
| --- | --- |
| Database tests (`pnpm db:test`) | 27 files, **431 checks passed** |
| API unit + e2e (`pnpm --filter @dental/api test`) | 30 suites, **296 tests passed** |
| Dashboard unit | 17 files, **75 passed** |
| Website unit | 5 files, **23 passed** |
| `pnpm lint`, `pnpm typecheck` | passed |
| Builds | API and dashboard built locally. The website build runs in CI, which passed for F2, F3 and F4; it can't run locally next to your website dev server, see §5 |
| Browser sweep | The dashboard loaded in a 390 px (phone) and a 1280 px (desktop) frame as the owner, on your dev data, through 33 screens: home, profile, branches (edit, hours, rooms), appointments (list, new), patients (list, new, profile, edit), follow-ups, doctors (edit, schedule, time off), services, staff, gallery, holidays, booking rules, invoices (list, new, invoice, A4 print), discounts, expenses, cash box, reports, and a visit. On each screen a script checked for horizontal overflow, English words and error messages. Nothing was saved |

What the sweep found, and what was done:

1. **Fixed:** the patient profile and the visit page were 78 px wider than a phone screen. The single-column grid could
   not shrink below its content (`1fr` → `minmax(0, 1fr)`). Both now fit at 390 px.
2. **Fixed:** `#/invoices/new` opened without a patient said «غير موجود». It now explains that an invoice starts from
   the patient's profile or visit, and links to the patients list. Every button in the app already passes the
   patient.
3. **No English interface text** at either width. The only Latin words were data: the demo names (Omar Khaled, Dr.
   Ahmed Salah…), the invoice number prefix "SMA", and a demo room named "Chair". Brand and clinic names may be
   English (your 2026-10-19 note).
4. Desktop: no overflow, no errors.
5. **Website, after your restart**, at 390 px: home, booking page and an unknown address are right to left with no overflow; times read «10:00 م», prices «300 ج.م». **Fixed:** the footer badge said "Powered by Dental SaaS" (now «بواسطة منصة الأسنان»), and an unknown address showed the framework's English 404 (now an Arabic page, `app/not-found.tsx`).

**CI:** the first two runs of this branch failed in `calendar.e2e-spec.ts` (400 and 409 on bookings), although no API code
had changed. The cause was in the test: several suites book the same seeded doctors on random far Saturdays, and when
one of them runs first on the same day (jest orders files differently on CI), the calendar tests found too few free
slots. The suite now picks a Saturday that both doctors have mostly free, and its "my day" check no longer assumes
the day is empty. It passed three runs in a row locally on the same database, and CI is green (39307625328).

## 5. Open items for you

1. **The website dev task stopped after your restart:** it started at 21:07 and ended about 30 seconds later, while the
   API and dashboard kept running. Started on its own it works (used for the check above), so restart `pnpm dev` once
   more, and if it stops again, the reason is in that terminal.
2. **Merging:** the work is on stacked branches, C → G, each one on top of the previous. Merging `v4/phase-g-verification`
   into `main` brings all of it. I have not opened a pull request; tell me if you want one.
3. **Confirm the open defaults** listed in the F4 review ("my day" rule; no-shows shown for the month only).
4. **Optional:** remove the unused English dashboard texts and the `lang` parameters (L10N-008). This is a bulk
   scripted edit that needs your explicit go-ahead.
5. **Next work, if you want it:** expense receipts (EXP-001), the balance at check-in (BILLING-005), invoiced and paid
   per treatment plan (TPLAN-004), CSV export (L10N-007), and paper print checks.
