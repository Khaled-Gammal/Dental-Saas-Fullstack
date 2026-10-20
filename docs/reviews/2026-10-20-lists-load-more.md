# Invoices and expenses: "load more" (2026-10-20)

The invoices and expenses lists stopped at the API's caps (100 invoices, 200 expenses) with no way to see older ones,
which was flagged in redesign R4a. Both now have «عرض المزيد», like the patients list. Built on `v4/lists-load-more`
from `main` 6efae87.

## What changed

- **API, additive (`GET /invoices`, `GET /expenses`):**
  - **New parameter:** an optional `after=<id>` returns the rows that come after that one, in the list's own order:
    - invoices: newest first;
    - expenses: by expense date, then entry time.
  - **Tie-breaker:** the id now breaks ties in that order, so a page never repeats or skips rows that share a time.
  - **Unchanged:**
    - the response shape (invoices are still an array; expenses still `{ items, byCategory }`);
    - the filters, the `limit` caps and the permissions.
  - **Other clinics' ids:** an `after` id the clinic cannot see (row-level security) matches nothing, so the answer is
    empty. Another clinic's rows are never revealed.
- **Dashboard:**
  - **Paging:** both lists are paged queries (`useInfiniteQuery`): 100 invoices or 200 expenses at a time.
  - **Button:** a full page shows «عرض المزيد» under the table, and it disappears when a shorter page arrives.
  - **Invoice count:** it reads «100+» while more remain.
  - **Search and sort:** they work on what is loaded, as the patients list does.
- **Money:** nothing calculated changed.
  - The expenses per-item totals card still comes from the API and covers the whole period, not just the loaded rows.
  - Amounts are shown exactly as the API returns them.

## Verified (2026-10-20)

| Check | Result |
| --- | --- |
| Lint (repo), typecheck (API and dashboard), dashboard build | passed |
| Dashboard unit tests | 26 files, **118 passed** |
| API e2e, billing + finance | 18 passed, including 2 new tests. Two pages continue one another with no repeat or gap; another clinic's id returns nothing; a malformed id is refused (400) |
| API e2e, full run (local) | 35 of 39 suites passed. The other 4 (consents, catalog, onboarding, platform panel) fail **identically on unchanged `main`**, because of leftover data in the local test database. Main's CI, on a fresh database, passed on 6efae87 |
| Screenshot | with the page size briefly set to 5: «عرض المزيد» under 5 invoices, then 9 in the full list's order once clicked, and the button gone. The page size is back at 100 |
