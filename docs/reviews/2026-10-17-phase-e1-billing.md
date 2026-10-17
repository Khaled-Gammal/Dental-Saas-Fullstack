# Phase E1 review — invoices, payments, reversals, refunds, printouts, currency (2026-10-17)

Scope: SRS BILLING-001…005, PAY-001, PAY-002, PAY-003 (reversal), PAY-005, and the currency part of L10N-005. Phase E
is split into E1 (this), E2 (discounts with approval, installment plans, waivers), E3 (expenses and cash days) and E4
(reports). Branch: `v4/phase-e1-billing` (on top of D5).

**Decisions recorded:** you asked me to implement what I recommend, so the proposed defaults of CLR-02, CLR-03, CLR-04,
CLR-09, CLR-12 and CLR-17 are now the requirement (SRS Part C); only CLR-07 and CLR-08 (Arabic-only cleanup) stay open.
E1 applies CLR-05 (already accepted), CLR-09 and CLR-17.

## What changed

| Requirement | Change | Where |
| --- | --- | --- |
| BILLING-001 | Draft invoices for one patient and one branch, in the clinic currency, from the patient's **unbilled procedures** (a visit's are pre-selected from the visit page) and/or service lines (service price within its range, CLR-16) or free lines. Lines can be added/removed while draft; a draft can be deleted | `modules/billing`; `#/invoices/new`, `#/invoices/<id>/view` |
| BILLING-002 | Issue: the database assigns `{prefix}-{year}-{00001}` from a per-clinic, per-year counter in the same transaction (gap-free: a rolled-back issue gives the number back; concurrent issues queue), sets the date in the clinic time zone and the tax from `tax_rate_bp`, half up, then locks lines, number and date | migration 0023 `issue_invoice()`, `invoices_lock_number` |
| BILLING-003 | Void with a reason (`invoices:void`), only when nothing is paid; the invoice stays, its procedures become billable again | `POST /invoices/:id/void` |
| BILLING-004 | Arabic, RTL printouts from the browser (CLR-17): **A4 invoice** (clinic, logo, branch address/phone, number, date, patient and file no., lines, subtotal, tax, total, paid, balance) and **A5 receipt** per payment (amount, method, reference, date, receiver, remaining balance) | `#/invoices/<id>/print`, `#/payments/<id>/print` |
| BILLING-005 | Patient balance (sum of open invoices, derived) with the invoice list and unbilled count on the profile ("الحساب") and on the payment form. Doctors with `invoices:read:own` see it for patients they treated or booked. **Not yet at check-in** | `GET /patients/:id/billing` |
| PAY-001 | Record a payment: cash, card, bank transfer, e-wallet, InstaPay; amount ≤ balance; reference required for transfer/wallet/InstaPay (database CHECK), optional for card, dropped for cash; **the receiver is always the signed-in member**; one payment per idempotency key (a double click or retry records once). Recorded at the current time | `POST /invoices/:id/payments` |
| PAY-002 | Any number of payments; status issued → partly paid → paid, derived | database (existing) |
| PAY-003 | Reversal of a payment entered in error, with a reason: kept visible, the amount owed again. The database allows only succeeded → reversed (no refunds on it), then nothing. CLR-05: the owner any time; the member who received it, the same clinic day | `payments_guard`, `POST /payments/:id/reverse` |
| PAY-005 | Refunds (`payments:refund`: owner, accountant): amount ≤ what is left, reason, **method recorded and may differ** (CLR-05), reference, time; the branch is the payment's; the balance reopens | `refunds_validate`, `POST /payments/:id/refunds` |
| L10N-005 / CLR-09 | The clinic chooses its currency on the profile screen (default EGP); the database refuses a change once an invoice has been issued, and every invoice is in the clinic currency. One money formatter (EGP shows "ج.م") is used by the billing and clinical screens | `tenants_currency_lock`, profile "العملة" card, `money.ts` |

Navigation: "الفواتير" is now active (it was a "coming soon" placeholder) for members with `invoices:read`.

## Migration and its risks

`20261101000023_billing_payments` — **Low.** The dev database had no invoices, payments or refunds, so nothing is
rewritten; existing test data passes every new constraint. Status, reference and reversal CHECKs are added `NOT VALID`
then validated. `payments_guard` and `refunds_validate` are replaced (the D5 merge exception is kept). Kept on purpose
for compatibility: payment notes stay editable (an existing, audited rule); a refund without a method takes the
payment's (the API always sends one); the database accepts a one-letter refund reason (older tests), the API requires 3+.

Seed (fresh databases only): the receptionist role gets `payments:reverse` and the doctor role `invoices:read:own`
(both in the SRS catalogue). To give your dev data the same:
`UPDATE roles SET permissions = permissions || '{payments:reverse}' WHERE id = 'a0000000-0000-0000-0000-0000000000a2';`
`UPDATE roles SET permissions = permissions || '{invoices:read:own}' WHERE id = 'a0000000-0000-0000-0000-0000000000a3';`

## Tests (run 2026-10-17)

| Suite | Result |
| --- | --- |
| `pnpm build`, `pnpm typecheck`, `pnpm lint` | passed |
| Database tests | **355 checks passed** (new `22_billing_payments.sql`, 28 checks: clinic currency, empty invoice refused, a rolled-back issue gives its number back, number format and date, issued once, number fixed, issued line fixed, tax half up, consecutive numbers, reference required, no overpayment, partly paid → paid, reversal needs a reason, reversed no longer counts and is final, refund in another method and the payment's branch, balance reopens, refund cap, a refunded payment is not reversed, a reversed one not refunded, no void with money, void with reason, never deleted, currency locked, currency code, a clinic without issued invoices may change) |
| API e2e + unit | **23 suites, 235 tests passed** (new `billing.e2e-spec.ts`, 8 cases; `billing-rules.spec.ts`, 6 cases) |
| Dashboard unit | **60 passed** (router: billing pages) |
| Website unit | 20 passed |

**Browser check: partial.** Viewed on your dev data as clinic A's owner: the invoice list, the new-invoice form, the
patient's account card (balance 0 ج.م) and the currency card; no console errors. I did not create invoices or
payments in your dev data; the invoice page and the printouts were exercised by the tests, not clicked through, and
printing on paper is not verified.

## Notes and follow-ups

- Dating a payment in the past waits for the cash days (E3, CLR-04: no back-dating into a closed day); until then a
  payment is recorded at the current time.
- Discounts (line and invoice, with limits and approval) are E2; issuing will then refuse an invoice with a pending
  discount (BILLING-002, DISC-003).
- Balance at check-in (BILLING-005) is not shown yet; the profile and the invoice show it.
- The services price list and the public website still show "ج.م" directly; making them follow the clinic currency is
  part of Phase F (L10N-005).
