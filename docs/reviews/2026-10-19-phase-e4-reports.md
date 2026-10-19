# Phase E4 review — reports (2026-10-19)

Scope: SRS REPORT-001…005. REPORT-006 (home screen per role) stays in Phase F. Branch: `v4/phase-e4-reports`
(on top of E3).

## What changed

- **Database (migration 0026, additive):**
  - read-only functions `report_money`, `report_expenses`, `report_attendance`, `report_procedures`,
    `report_outstanding`, `report_overdue_installments`, plus `clinic_timezone()`;
  - the functions run with the **caller's rights** (not `SECURITY DEFINER`). Row-level security keeps them inside the
    clinic, and the `branch_access` policies keep a branch-limited member to their branches. EXECUTE is given to
    `app_user` only;
  - system roles that lack their default report right get it: reception `reports:read:daily`, doctor
    `reports:read:own`. Clinics made at sign-up already had these; the dev seed's hand-written roles did not.
    Nothing else is changed or removed;
  - no new indexes: the report indexes of design item E-11 already existed (0023, 0025).
- **API, new `reports` module:**
  - `GET /reports/revenue|expenses|attendance|performance|outstanding` with `?from&to&branchId`, plus `GET
    /reports/branches` for the branch picker;
  - the database returns detailed rows, and `reports-rules.ts` adds them up, so every total is the sum of the rows
    shown under it;
  - new error codes: `today_only`, `invalid_period`, `period_too_long` (a year at most), `not_a_doctor`,
    `branch_not_found`. Each has an Arabic text.
- **Dashboard:**
  - `#/reports` (nav «التقارير») has five tabs;
  - period presets (today, this month, last month, this year) or exact dates, and the branch or all branches;
  - the page is its own A4 printout: the controls do not print, and the clinic, report, period and branch are printed
    on top.
- **Seed:** receptionist + `reports:read:daily`, doctor + `reports:read:own` (the B.1 defaults).

## Rules applied (please confirm or change)

1. **Who sees what (B.1):**
   - `reports:read` (owner, accountant) sees everything;
   - reception sees **today's** revenue and collections only, at its own branches;
   - a doctor sees **their own** attendance and performance, with no collections.
2. **Days:**
   - money is dated like the cash box, on the clinic's business day: invoices by issue date, payments and refunds by
     the time they were recorded. So a day's collections match that day's cash box;
   - appointments and visits are dated like the calendar, in the branch's zone. The SRS says "branch's timezone" for
     reports, but CLR-04 put the cash day on the clinic's zone. Every branch is in Cairo today, so the two are the
     same.
3. **Revenue:**
   - invoiced = issued invoices that are not void;
   - a **reversed** payment (entered in error) never counts;
   - refunds are shown apart and net = collected − refunded;
   - waivers and write-offs are listed apart. They lower what is owed but are not collections.
4. **Expenses:**
   - the total counts approved and pending expenses, the same as the expenses screen;
   - **rejected** expenses are shown apart (the cash did leave the drawer);
   - voided ones are left out.
   - The cash-basis line is net collections − expenses.
5. **Attendance:**
   - lapsed website holds are not appointments;
   - cancellation rate = cancelled ÷ all appointments;
   - no-show rate = no-shows ÷ appointments that came due and were not cancelled. Still-pending or confirmed ones are
     left out, so a period that runs into the future does not lower the rate.
6. **Performance:** procedure value is the performed price before invoice discounts, on the visit date, credited to
   the doctor who did it. Collections are per branch only, because payments are not tied to a doctor. No commissions.
7. **Outstanding** is a picture of now, so the period does not apply:
   - one line per patient, with their branches together;
   - overdue installments show the days overdue and what remains;
   - lists stop at 500 lines, but the totals always cover everyone.

## Migration and its risks

- Only functions and a role-rights grant. No table, column or data changes. The down migration drops the functions
  and leaves the granted rights in place, as 0025 did. It was run on the test database (rollback, then up again)
  and works.
- **Applied to your dev database** (it only adds functions). The receptionist and doctor roles there now have their
  report rights. Members who are already signed in get them when their session token next refreshes.
- Performance: money ranges become time ranges, so the `(tenant, branch, time)` indexes are used. Appointments and
  visits are narrowed by a wide UTC window first, then filtered by local date.

## Tests (run 2026-10-19)

| Check | Result |
| --- | --- |
| `pnpm --filter @dental/db test` | 26 files, **428 checks passed**. New `25_reports.sql` (24 checks):<br>• fixed money today: the invoice, cash and card payments, refund and write-off move the report by exactly their amounts;<br>• a payment at 00:05 local time counts on today, not on the UTC day before;<br>• a reversed payment drops out;<br>• fixed appointments a month ago: one of each outcome plus a lapsed hold, and one procedure;<br>• every sum equals an independent sum of the same records;<br>• a Maadi-only member gets Maadi rows only from all six functions, the same figures the owner sees for Maadi;<br>• another clinic sees nothing |
| API (`pnpm --filter @dental/api test`) | 28 suites, **283 tests passed**. New unit `reports-rules.spec.ts` (15) and e2e `reports.e2e-spec.ts` (9):<br>• payments and refunds through the API move the figures by their amounts, and every breakdown adds up to the totals;<br>• reception: today only, other reports refused;<br>• Maadi member: Maadi only, Nasr City `branch_not_found`;<br>• clinic B: nothing;<br>• doctor: own figures only;<br>• period limits |
| Dashboard / website unit | 70 / 20 passed (new `reports-model.test.ts`) |
| `pnpm build`, `pnpm typecheck`, `pnpm lint` | passed. The website build first failed with a Next.js "no direct app page entry" invariant. It passed after deleting the stale `apps/web/.next`; no website file was changed |
| CI | not run yet (branch not pushed) |
| Browser | `#/reports` signed in as the owner on your dev data: revenue (13,100 invoiced, 7,500 collected, 200 refunded, net 7,300 this month), expenses (200 rent; collections − expenses 7,100), attendance (5 appointments by doctor), performance (5 completed, 3 procedures worth 1,900 at Nasr City), outstanding (2 patients, 4,800; one overdue installment, 1,000). Read only. The phone-width check did not take (the window would not resize) |

## Not done in this phase

- REPORT-006 (home screen per role): Phase F, as in the roadmap.
- Excel export: deferred (Part D).
- The full click-through at phone width: Phase G.
