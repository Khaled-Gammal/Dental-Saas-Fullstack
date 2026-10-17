# Phase E3 review — expenses with approval and the daily cash box (2026-10-17)

Scope: SRS EXP-001…004 and CASH-001…004, with the accepted defaults of CLR-03 and CLR-04. Branch:
`v4/phase-e3-cash` (on top of E2).

## What changed

- **Database (migration 0025, additive):**
  - expense categories get a `key` and `is_active`; every clinic gets the eight Arabic starting categories (back-fill
    plus a trigger for new clinics), and they are never deleted;
  - `expenses` gain method, reference, supplier, status (pending/approved/rejected/void), approver, decision note,
    void fields, and a guard that keeps the money fields fixed;
  - new `cash_sessions` and append-only `cash_session_reopenings`;
  - `cash_day_totals()` and the closed-day triggers on payments, refunds and expenses;
  - the reception expense limit setting;
  - receptionist and accountant permissions (below).
- **API — new `finance` module:**
  - `GET/POST /expenses`, `GET /expenses/:id`, `POST /expenses/:id/approve|reject|void`, `GET /expenses/pending`;
  - categories: `GET/POST /expenses/categories`, `PATCH /expenses/categories/:id`;
  - reception limit: `GET/PATCH /expenses/settings`;
  - cash box: `GET /cash/branches`, `GET /cash/today?branchId=`, `GET/POST /cash/sessions`, `GET /cash/sessions/:id`,
    `POST /cash/sessions/:id/close|reopen`;
  - Arabic error texts for the new codes.
- **Dashboard:**
  - `#/expenses` has: the record form, the owner's approval queue, status filter and period, a by-category total,
    void with reason, and the owner's categories and reception limit;
  - `#/cash` has: the branch picker, opening with the last count proposed, live expected cash with the other methods
    listed apart, count and close (a note when there is a difference), the owner's reopen with a reason and its
    history, and the earlier days;
  - nav entries «الخزنة اليومية» and «المصروفات».
- **Seed:**
  - receptionist role: + `expenses:write:cash` and `cash:operate`;
  - accountant role: + `cash:operate`.

  Approving expenses (`expenses:approve`) and reopening a cash day (`cash:reopen`) stay with the owner only.
- **Demo script:**
  - adds an E3 block: a closed day yesterday at Nasr City (20 short, with a note), rent by transfer, a voided entry,
    and two cash expenses by Sara (one approved, one waiting);
  - skips what would clash with a cash day someone already opened or closed.

## How the rules work (CLR-03, CLR-04)

- **Who records what:**
  - the owner and the accountant (`expenses:write`) record any expense, approved on entry;
  - reception (`expenses:write:cash`) records cash only, up to the clinic's limit (500.00 to start; 0 = none). These
    wait for the owner, who never approves their own;
  - reception sees only the expenses it recorded, and voids its own while they still wait.
- **The cash day:**
  - one session per branch per business day, in the clinic's time zone;
  - a movement belongs to its branch and date: no session id is stamped, so nothing needs a back-fill;
  - expected cash = opening + cash payments − cash refunds − cash expenses, always computed;
  - card, transfer, wallet and InstaPay are listed apart.
- **Closing:**
  - the session row is locked and the day added up, then compared with the count; a difference needs a note;
  - after that, the database refuses any payment, reversal, refund, expense or void dated into that day;
  - the lock ordering makes this race-safe: a payment saved while the day closes is either counted or refused.
- **Reopening** is the owner's only, with a reason. The figures it undoes are kept in the reopening history.

## Migration and its risks

- Additive only: new columns with defaults, two new tables, functions and triggers. Nothing is dropped or rewritten.
- Existing expenses become `approved` with no method (unknown, so nothing is guessed). "Method required" is
  `NOT VALID`, so it covers new rows only.
- **Behaviour change to know:** once a branch's day is closed, a payment there is refused until the owner reopens the
  day. This is what CLR-04 asks for. A late patient after closing means reopening (owner) or not closing yet.
- Bug found and fixed before commit: the category seeding first used `ON CONFLICT DO NOTHING`. That left categories
  without a key when a clinic already had one by that name (it happened in your dev database after I re-applied the
  migration). The seeding now adopts the same-name category, and a DB test covers running it again.
  - Your dev database was fixed in place by applying only that function, not by a rollback, because a rollback would
    have dropped the cash session you had opened.
- The down migration was run on the test database (rollback, then up again): it works.

## Tests (run 2026-10-17)

| Check | Result |
| --- | --- |
| `pnpm --filter @dental/db test` | 25 files, **404 checks passed** (new `24_expenses_cash.sql`: 25 checks — categories and re-seeding, reference and future-date rules, immutability, no self-approval, no delete, the SRS example 1 000 + 500 cash − 100 = 1 400 with card 200 apart, difference note, closed day refuses payment/reversal/refund/expense/void, a decision on a closed day still allowed, reopen only with its reason row, one open session per branch, clinic isolation) |
| API (`pnpm --filter @dental/api test`) | 26 suites, **259 tests passed** (new unit `finance-rules.spec.ts`: 7; new e2e `finance.e2e-spec.ts`: 7 — run twice in a row on the same database to check it is repeatable) |
| Dashboard / website unit | 67 / 20 passed (new `finance-model.test.ts`) |
| `pnpm build`, `pnpm typecheck`, `pnpm lint` | passed |
| CI | pending (pushed with this commit) |
| Browser | not driven by me: two Chrome browsers were connected. You were already using `#/cash` and `#/expenses` on the dev data (you opened Nasr City at 5 000, recorded a cash rent expense at Maadi, and closed at a counted 6 400 = expected 6 400). I read the same data back through the API as the owner, and it was correct |

## Decisions made in this phase (please confirm or change)

1. **A rejected expense still counts on its cash day.** The cash physically left the drawer. Only a void (recorded in
   error) changes the day. So the owner can still reject a reception expense the morning after the day was closed.
2. **Reception sees only its own expenses** and may void its own while they still wait. The accountant sees all.
3. **Categories, the reception limit and approvals** use `expenses:approve` (the owner).
4. **A cash day left open on an earlier date blocks opening today** until it is closed (`previous_session_open`).
   The screen offers to close it.
5. **No back-dating of payments in this phase.** Payments are dated "now". Expenses may be dated in the past, but
   not in the future and not into a closed day.
6. **Expense supporting documents (EXP-001) are deferred**, so EXP-001 is PARTIAL. They need the private-file upload
   from D3 to accept expense files, which is a separate small step.

## Notes

- The dev database never received the accountant demo user (`accountant.a@demo.test`, added to the seed in D4)
  because it was not reseeded. I left it alone. The test database has it.
- Next: E4 reports (REPORT-001…005), which can build on `cash_day_totals()` and the expense totals.
