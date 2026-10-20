# Phase H1 review — balance at check-in and plan billing (2026-10-20)

Two follow-ups left open after Phase G, built on `v4/phase-h1-balances` (from `main` 7034745). No migration.

## What changed

1. **BILLING-005 at check-in** (was PARTIALLY_IMPLEMENTED: profile and payment screen only).
   - `GET /balances?patientIds=a,b` returns `{ patientId: balanceMinor }` for patients who owe something on issued or
     partly paid invoices (up to 200 distinct ids; bad ids are a 400).
   - Who sees it: `patients:read` plus `invoices:read`, or `invoices:read:own` limited to the patients the doctor has
     treated or booked — the same rule as `GET /patients/:id/billing`. Anyone else gets 403.
   - Dashboard: on the day list and the waiting list a patient who owes shows a «عليه …» badge; the code check-in
     confirmation adds «رصيد مستحق من فواتير سابقة» when the arrived patient owes something. Members without the
     billing permissions see neither and the request is not sent.
2. **TPLAN-004 invoiced, paid and balance per plan** (was PARTIALLY_IMPLEMENTED: estimate, done, remaining, next visit).
   - `GET /plans/:id` and `GET /patients/:id/plans` add `billing: { invoiced_minor, paid_minor, balance_minor }`.
   - The figures come from the invoice lines of the plan's procedures, on issued, partly paid and paid invoices
     (drafts are not billed yet; void invoices never were).
   - The plan summary card shows them under «الفواتير والمدفوعات», with a note on how a shared invoice is counted.
   - `billing` is `null` for members who may not see the patient's billing.

## Rules chosen — please confirm

| # | Rule | Why |
| --- | --- | --- |
| H1-1 | An invoice that holds plan work **and** other work counts toward the plan by the plan lines' share of the invoice subtotal; that share is applied to the total (after invoice discounts), to what was paid and to the balance, rounded per line (half up) | Payments are recorded per invoice, not per line, so there is no exact "paid for this line" figure |
| H1-2 | Plan billing is shown to `invoices:read`, and to `invoices:read:own` only for **the plan's own doctor** | A plan belongs to its doctor; another doctor who also treated the patient sees the plan but not its money |
| H1-3 | The day-list badge shows the **whole** outstanding balance of the patient (all their invoices), not only today's | The SRS describes BILLING-005 as the patient's balance; today's amount due is already shown at check-in |

## Files

- API: `modules/billing` (controller `BalancesController`, `BalancesQuery`, `BillingService.balances`,
  `BillingRepository.balances`), `modules/clinical` (`planBilling` in `clinical-rules.ts`,
  `PlansRepository.invoiceLines`, `PlansService.billingOf`).
- Dashboard: `queries.ts` (`useBalances`), `screens/appointments/list.tsx`, `screens/clinical/plans.tsx`, `App.tsx`,
  `types.ts`, `i18n.ts` (the old "comes with billing" note replaced).
- Docs: `SRS.md` (TPLAN-004, BILLING-005 → IMPLEMENTED), `implementation-status.md`.

## Tests (run 2026-10-20)

| Check | Result |
| --- | --- |
| `typecheck`, `lint` (API, dashboard) | passed |
| Database tests (`pnpm db:test`, rebuilds `dental_test`) | **431 checks passed** |
| API unit + e2e against the fresh `dental_test` | 30 suites, **300 tests passed** (4 new: three `planBilling` unit tests, one `clinical.e2e-spec.ts` case covering a shared invoice, a payment, the plan's own doctor, the plan list, `GET /balances` for reception and doctor, and a bad id) |
| Dashboard unit | 17 files, 75 passed |
| Website unit | 23 passed |

Run against the dev database instead, four older tests (onboarding, catalog, reports) fail because of data already
there (a service `rct` added in clinic A, a published brand colour, report rows left by earlier runs today). They
pass on the fresh test database; nothing in the dev database was changed.
