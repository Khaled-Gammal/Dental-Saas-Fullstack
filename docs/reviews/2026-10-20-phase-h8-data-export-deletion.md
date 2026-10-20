# Phase H8 review — data export and clinic deletion (2026-10-20)

NFR-08: the clinic owner exports all the clinic's data, and deletes the clinic. Built on `v4/phase-h8-data-export`
(from `main` bda0d56). Migration 0034, applied to the dev database.

## Decisions (owner, 2026-10-20)

1. **Deletion:** the owner deletes the clinic themself, confirming with their password and the clinic's name. The
   clinic closes at once. The data is kept 90 days, during which the platform admin can restore it, and is then erased
   for good, files included.
2. **Export:** one ZIP prepared in the background, with a link emailed when ready. It holds a CSV per kind of data
   (opens in Excel), a JSON copy, and every uploaded file.

## What changed

- **Dashboard, page «بيانات العيادة» (`#/data`, owner only):** no role you create can open it, whatever permissions
  it holds.
  - **Export:** the owner enters the password again (the file holds every patient), and the export is prepared in
    the background while the page updates itself. When it is ready the owner gets an email and a «تنزيل» button. The
    download link is created on the spot and works 5 minutes. Each export stays downloadable 7 days. Limits: one in
    the making at a time, 3 a day.
  - **Delete:** the card says plainly what happens (closed now, kept 90 days, then erased) and advises exporting
    first. The button stays disabled until the clinic's name is typed and the password entered, then there is a last
    confirmation. Afterwards the owner is signed out with a message giving the erase date.
- **What the ZIP contains:**
  - `csv/` and `json/`: one file per table of clinic data. Among them are patients, visits, chart, plans,
    appointments, invoices, payments, expenses, the website content and the clinic's audit trail.
  - `staff`: names, emails, phones and roles.
  - `files/<kind>/…`: every upload, indexed in `csv/files_index.csv`. Website images are exported at their largest
    size, since originals aren't kept.
  - `README.txt` in Arabic: amounts are in piasters, times are in UTC, and the file must be kept safe.
  - **Never included:** password hashes, encrypted secrets, tokens and codes, or the platform's own records (your
    notes, the platform activity log).
- **When a clinic is deleted:**
  - Every member is cut off at their next request («هذه العيادة محذوفة…»), and signing in shows the same message.
  - The website goes offline.
  - The owner gets a confirmation email with the date and how to restore.
- **Panel:**
  - The clinic list shows «بانتظار الحذف» with the erase date.
  - The clinic page shows when deletion was asked and when the data goes, with a «استعادة العيادة» button that
    returns the clinic exactly as it was.
  - The activity log names each step: requested, restored, erased.
- **Worker:**
  - Exports run on their own queue, one at a time, so reminders never wait behind a big export.
  - Nightly at 04:00, exports past their 7 days are deleted.
  - Nightly at 04:30, clinics past their 90 days are erased: first their stored files, then every row of every table,
    then the accounts that belonged to that clinic alone (not platform admins).
  - A clinic the platform has invoiced is not erased automatically. It is reported in the activity log instead, but
    no clinic is invoiced yet.
- **Database (0034):** described in `docs/database-design.md`. Two points worth knowing:
  - Links between a clinic's own tables are now checked at the end of the erase instead of row by row. Normal use
    behaves exactly as before.
  - The erase sweeps every table that has a `tenant_id`, including ones added later. A test checks that not one row of
    an erased clinic is left anywhere.

## Limits to know

- **Very large clinics:** an export is uploaded to storage in one piece, which S3 allows up to 5 GB. A bigger one
  fails and shows «تعذّر التجهيز». Multipart upload would lift the limit; add it if a clinic gets that big. Until
  then an export uses temporary disk on the worker about the size of the ZIP.
- **After deletion the owner can't download:** they can't sign in, so the page tells them to export first. If they
  forget, you can restore the clinic within the 90 days.
- **Legal retention:** medical records may have to be kept for a minimum period. The 90 days and the permanent
  erase are what you chose for the platform; whether a clinic must keep its own copy longer (the export) is for the
  clinic, and you may want your lawyer to confirm the wording.

## Tests (run 2026-10-20)

| Check | Result |
| --- | --- |
| `typecheck`, `lint` (API, dashboard, website), dashboard build, API build | passed |
| Database tests (`pnpm db:test`) | **561 checks passed**; 31 are new in `32_data_export_deletion.sql`, covering exports (one at a time, per clinic, only the worker finishes them), deletion (owner only, closes at once, website offline, audited), restore (admin only, only while waiting) and the erase. The erase uses clinic A with all its clinical and money data: refused before 90 days, the right storage keys listed, not one row left in any table, its accounts erased, other accounts and clinic B untouched, the platform log kept, the guards back on |
| Migration 0034 down and up again on the test database | passed |
| API unit + e2e on a fresh test database | 37 suites, **339 tests passed**. New `clinic-data.e2e-spec.ts`: owner only and password again; a real export built by the worker code, downloaded as a ZIP with the expected files and no secrets, a tampered link refused, another clinic refused; deletion with a wrong name or password refused, closing at once, the panel listing and restoring the clinic, deleting again, then the worker's erase removing it with its account. New `export-format.spec.ts`: secret columns, CSV safety, file paths, README, name check |
| Dashboard unit | 22 files, **100 passed** (new `clinic-data-model.test.ts`) |
| Worker process started against the dev database | boots, registers the new queue and the nightly jobs |

**Two notes from testing:**

- **Calendar suite:** one full run had a single failure in the calendar suite ("a closed day removes its slots"). It
  passed in the two runs after, and this phase doesn't touch the calendar.
- **Emailed-code limit:** the code limit (3 per address per 10 minutes) is always on. Three older suites already sign
  in the seed platform admin, so the new suite creates its own admin rather than loosening the limit.

Not checked in a browser: the extension's browsers can't reach the local addresses.
