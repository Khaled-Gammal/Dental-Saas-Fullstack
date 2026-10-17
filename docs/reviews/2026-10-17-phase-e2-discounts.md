# Phase E2 review — discounts with approval, installment plans, waivers and write-offs (2026-10-17)

Scope: SRS DISC-001…003, PAY-004 and PAY-006, with the accepted defaults of CLR-02 and CLR-12. Branch:
`v4/phase-e2-discounts` (on top of E1). You asked for demo bills first: they are in your dev database (below).

## Demo data (dev only)

`pnpm --filter @dental/db seed:demo-billing` (already run on your dev database; safe to run again). Clinic A gets:
Omar — a final visit, an invoice from two of its procedures partly paid (cash + InstaPay), the consultation left
unbilled, and a draft; Nour — an invoice paid by card and transfer, one voided, and a draft whose 15 % discount waits
for your approval; منى عبد الله — a cash payment reversed as an entry error, then paid by e-wallet; كريم حسن — a card
payment partly refunded in cash, and orthodontics on six monthly installments (first paid, second overdue, last
waived). Visits and recorded money cannot be deleted by design; a database reset removes them.

## What changed

| Requirement | Change | Where |
| --- | --- | --- |
| DISC-001 | A discount on a line or the whole invoice, as an amount or a percentage, always with a reason. A percentage becomes an amount (half up); an invoice percentage follows the lines while the invoice is a draft. Only drafts change | migration 0024 (`invoice_items_derive`, `invoices_derive`); `PUT/DELETE /invoices/:id[/lines/:lineId]/discount`; invoice page |
| DISC-002 | Each role has a limit: a share of the invoice before discounts and an optional amount cap. CLR-02 starting values: receptionist 10 %, accountant 20 %, other roles 0; the owner has none. Applied to every clinic now and to new clinics at sign-up. All discounts on the invoice are measured against the limit of whoever makes a change, on every change (lines added or removed too) | `roles.max_discount_bp/minor`, `discountDecision`; `#/discounts` (role limits, set by the owner) |
| DISC-003 | Above the limit the invoice waits for approval: the owner (`discounts:approve`; the accountant does not approve, CLR-02) approves or rejects it with a note from the queue or the invoice. The database refuses issuing a pending or rejected discount, and self-approval. An earlier approval does not cover a later change. Requests and decisions are audited | `invoices_discount_settled`, `invoices_discount_self_approval`; `GET /discounts/pending`, approve/reject; "الخصومات" menu |
| PAY-004 | The open balance of an issued invoice split into dated installments: the screen proposes equal monthly amounts (remainder on the last) and lets you edit them; the server accepts only a schedule that adds up exactly, with dates in order; one active plan per invoice. Payments can go to an installment (never more than is left of it); a date can be moved; the plan completes when nothing is left. Overdue installments (unpaid after their date) have their own tab | `POST /invoices/:id/plan`, `PATCH /installments/:id`, `GET /installments/overdue`; invoice page, "أقساط متأخرة" |
| PAY-006 | CLR-12: the owner (`payments:adjust`) waives an installment or writes off part or all of an invoice's remainder, with a reason. These are rows of their own (never edits of payments or invoices), cannot be edited or deleted, are audited, and lower what is owed: balance = total − paid − adjusted | `balance_adjustments`, `invoices.adjusted_minor`; invoice page |

## Migration and its risks

`20261102000024_discounts_installments_adjustments` — **Low/medium.**
- The generated `invoices.balance_minor` is redefined to include adjustments: dropping and re-adding it rewrites the
  invoices table once (a handful of demo rows in dev; on a large table do it in a quiet window). The demo invoices kept
  the same balances (checked).
- New CHECKs are added `NOT VALID` then validated. "Discount ≤ subtotal" applies once an invoice is issued (a draft is
  built step by step). One old test inserted a discount without a reason before any line; it now gives a reason (the
  rule it tests — totals — is unchanged).
- New table `balance_adjustments` with RLS (clinic and branch), no UPDATE/DELETE for the API role.
- Rollback written (restores the E1 functions and balance definition).

Seed (fresh databases only): the receptionist role gets `discounts:apply` (SRS catalogue).

## Tests (run 2026-10-17)

| Suite | Result |
| --- | --- |
| `pnpm build`, `pnpm typecheck`, `pnpm lint` | passed |
| Database tests | **378 checks passed** (new `23_discounts_installments.sql`, 23 checks: CLR-02 starting limits, percent half up, reason required, invoice percent follows lines, pending blocks issuing, no self-approval, approved issues, discount locked once issued, schedule adds up, one plan per invoice, installment payment, waiver marks and lowers the balance, waived once, plan completes, no write-off on a draft or above the balance, full write-off settles, no void after an adjustment, adjustments not editable, audited) |
| API e2e + unit | **24 suites, 245 tests passed** (new `billing-e2.e2e-spec.ts`, 7 cases; `billing-rules.spec.ts` + 3) |
| Dashboard unit | **63 passed** (new `billing-model.test.ts`: schedule proposal; router) |
| Website unit | 20 passed |

**Browser check (on the demo data, as clinic A's owner):** invoice list with every status, an invoice page with its
payments, the A4 printout, the discounts queue with Nour's pending discount, the role limits, the overdue tab and
Karim's installment invoice (paid / overdue / due / waived, totals 6,000 − 1,000 paid − 1,000 waived = 4,000). No
console errors. While checking I saw that the receptionist and doctor limits in your dev data are 20 %: the audit log
shows they were set by the owner account through the new screen at 20:17–20:18 UTC (not by a test), so I left them.

## Decisions made in this phase (please confirm or change)

1. **One approval per invoice**: the approval covers all its discounts (lines and whole) as they stand; any later
   change is measured again against the changer's limit.
2. **The share is of the gross** (quantity × unit price before any discount), so line and invoice discounts add up
   against one limit.
3. **Installments cover the open balance** at the time the plan is made; money already paid counts as the down payment.
   Only dates can be moved later (amounts stay as agreed; a different split means a waiver or a new invoice).
4. **Plans on treatment plans** (before an invoice exists) are not built; plans are on issued invoices.

## Notes

- Doctors still cannot see discounts or approve them; only members with `discounts:apply` set them.
- The A4 invoice printout shows the discount total; line discounts show on the invoice page.
