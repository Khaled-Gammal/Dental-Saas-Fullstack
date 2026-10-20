# Phase H2 review — expense supporting documents (2026-10-20)

The last missing part of EXP-001, built on `v4/phase-h2-expense-documents` (from `v4/phase-h1-balances`, which is not
merged yet). Migration 0028, applied to the dev database.

## What changed

- **Attach:** `POST /expenses/:id/document` (multipart field `file`). PDF, JPEG, PNG or WebP, recognised by the bytes
  (whatever the file is called), up to 20 MB, counted in the plan's storage. Stored privately under
  `t/<clinic>/expenses/<file>`. The expense answer and the list now carry `document: { url, mime_type, size_bytes }`
  and `can.attach`.
- **Open:** `GET /expense-files/<clinic>/<file>?u&exp&sig`, a 5-minute link bound to the signed-in member, like
  patient files. It has its own signing scope, so an expense link never opens as a clinical file (and the reverse).
  Sent with `Cache-Control: private, no-store` and `nosniff`.
- **Database (0028):** `expenses_guard` lets `file_id` go from empty to a file **once**, while the expense is not void,
  and never changes it after. The file must be a private file of the same clinic, and one file belongs to one
  expense. Everything else about a recorded expense stays fixed, as in E3. The down migration restores the E3 guard.
- **Dashboard (`#/expenses`):** the record form has an optional «المستند» file field. The expense is saved first and
  then the document uploads; if the upload fails, the expense is kept and a notice says to attach it from the list.
  Each row shows «عرض المستند», or «إرفاق مستند» when it may still be attached. The owner's approval list shows the
  document too, so the receipt can be checked before approving. Lists refresh every 4 minutes so links never go stale.
- **Shared code:** the byte check and the signed-link class moved from the patients module to
  `shared/storage/private-files.ts`. Clinical links are unchanged (same scope and path; their tests still pass).

## Rules chosen — please confirm

| # | Rule | Why |
| --- | --- | --- |
| H2-1 | The document can be attached when the expense is recorded **or later, once**. It is never replaced or removed; a wrong one is corrected by voiding the expense and recording it again | Receipts often arrive after the money is spent; keeping it fixed afterwards matches "recorded money is not edited" (E3) |
| H2-2 | ~~Who attaches: `expenses:write`, or the member who recorded the expense (reception)~~ — **replaced by the owner's decision below**: `expenses:write` only (owner, accountant), at any status except void | — |
| H2-3 | ~~Who opens: `expenses:read`, or reception for the ones it recorded~~ — **replaced**: `expenses:read` only (owner, accountant) | — |
| H2-4 | Opening a document is **not** written to the audit log (attaching is). Patient files log every opening because they are medical records (NFR-03); expense receipts are not | Keeps the audit log for what the SRS asks; easy to add if you want it |

## Tests (run 2026-10-20)

| Check | Result |
| --- | --- |
| `typecheck`, `lint` (API, dashboard) | passed |
| Database tests (`pnpm db:test`) | **440 checks passed** (9 new in `27_expense_documents.sql`: recorded with or attached later; not replaced, not removed; not on a void expense; no public or other-clinic file; one expense per file) |
| Migration 0028 down and up again on the test database | passed |
| API unit + e2e on the fresh test database | 30 suites, **304 tests passed** (3 new unit tests for the attach rule and the link scope; one e2e case: wrong bytes, no rights, another branch's receptionist, attach, attach again, open without a session, a link moved to another member, an expense link tried as a clinical one, the owner's list, a void expense) |
| Dashboard unit | 17 files, 75 passed |

Not checked in a browser: the extension's browsers cannot reach `localhost:5173` from this machine.

## H2b — reception without expenses (owner's decision, 2026-10-20)

The owner: expenses are seen and recorded by the owner and the accountant only; reception handles bookings, patients
and patient payments. This replaces the reception part of CLR-03. Same branch, separate commit.

- **Migration 0029:** `expenses:write:cash` is retired. New clinics' receptionists no longer get it, every role loses it,
  and the members concerned get a new access version first, so a token issued with the old rights stops working at
  once (they sign in again). The down migration gives it back to system receptionist roles.
- **API:** every expense route now needs `expenses:read` (list, one expense, categories) or `expenses:write` (record,
  void, attach a document), checked before the request body is read. Recorded expenses are approved on entry. The
  reception limit endpoints (`/expenses/settings`) are gone; the `tenant_settings.reception_expense_limit_minor` column
  stays, unused (no data removed).
- **Dashboard:** «المصروفات» shows only for `expenses:read`. The reception note, cash-only method lock and the reception
  limit setting are removed; the owner's card keeps the categories.
- **Kept on purpose:**
  - Reception still opens and closes the cash box (`cash:operate`, CLR-04). The cash day shows one line, the total of
    the day's cash expenses, because the drawer cannot be counted without it; no expense details.
  - The owner's approval list stays: an expense reception recorded before today and still pending waits for the owner
    (your dev database has one, from the demo).
- **Demo seed:** the E3 demo's expenses are recorded by the accountant now; Sara still opens and closes the cash day.

| Check | Result |
| --- | --- |
| Database tests | **441 checks passed** (no role keeps the retired right; reception and doctors have no expense rights) |
| Migration 0029 down and up again on the test database | passed |
| API unit + e2e on the fresh test database | 30 suites, **300 tests passed** (the reception-flow tests became one access test: reception and the Maadi receptionist get 403 on every expense route) |
| Dashboard | typecheck, lint, 75 tests passed |
