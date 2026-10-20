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
| H2-2 | Who attaches: a member with `expenses:write` (owner, accountant), or the member who recorded the expense (reception, for its own cash expenses), at any status except void | Reception is usually the one holding the paper receipt |
| H2-3 | Who opens: whoever can see the expense (`expenses:read`, or reception for the ones it recorded) | Same visibility as the expense itself |
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
