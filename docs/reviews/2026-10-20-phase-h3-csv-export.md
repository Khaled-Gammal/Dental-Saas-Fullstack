# Phase H3 review — CSV export of the reports (2026-10-20)

The owner asked for export of the reports (DSH-11 "export Excel", deferred until now). Built on
`v4/phase-h3-csv-export` (from `main` 0b597a0). No migration, no API change.

## What changed

- **`#/reports`:** every table of every report (revenue and collections, expenses, attendance, performance,
  outstanding balances and overdue installments) has a «تصدير CSV» button. One table is one file, so it opens in Excel
  as a clean sheet: a header row, the rows, and the total row when the screen shows one. The button does not print.
- **Built in the browser from the data on screen.** The file holds exactly what the member already sees, under the same
  rights: reception exports today's revenue only, a doctor their own attendance and performance, and the owner and
  accountant everything their branches allow. There is no new endpoint and nothing new to secure on the server.
- **Format (`src/csv.ts`, unit-tested):**
  - UTF-8 with a byte-order mark and CRLF line ends, so Excel shows Arabic correctly (L10N-007);
  - amounts as plain numbers in pounds (1250.5), with the currency in the column header («المبلغ (ج.م)»); counts as
    numbers; rates as percentages (12.5) with «(%)» in the header; dates as YYYY-MM-DD;
  - commas, quotes and line breaks are quoted; the Arabic comma needs no quoting;
  - a text cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading apostrophe, so a patient name or note can
    never run as a spreadsheet formula (CSV injection);
  - file names are plain: `<report>_<table>_<from>_<to>.csv`, e.g. `revenue_by-method_2026-10-01_2026-10-20.csv`
    (outstanding balances: `outstanding_patients_<today>.csv`).
- **Expenses report:** the daily breakdown (already in the report data) is now shown as a table when the period
  covers more than one day, like the revenue report, so it can be exported too.

## Rules chosen — please confirm

| # | Rule | Why |
| --- | --- | --- |
| H3-1 | CSV (opens in Excel), not an `.xlsx` file | No new library; CSV is what the SRS describes (L10N-007); Excel, Google Sheets and LibreOffice all open it |
| H3-2 | One file per table, not one file per report | A CSV holds one table; several stacked tables in one file are hard to sort or sum in Excel |
| H3-3 | Exporting is not written to the audit log | It runs in the browser on data the member already sees (viewing reports was not audited either). If you want exports of patient names and phones (outstanding balances) logged, it needs a small API call per export |
| H3-4 | Phone numbers keep their leading `+` behind an apostrophe (`'+2010…`) | Without it Excel turns the number into a figure and drops the `+`; the apostrophe also blocks formulas. Excel may show the apostrophe |

## Tests (run 2026-10-20)

| Check | Result |
| --- | --- |
| Dashboard `typecheck`, `lint` | passed |
| Dashboard unit | 18 files, **79 passed** (4 new in `csv.test.ts`: BOM and CRLF; quoting, the Arabic comma, empty cells; formula injection, negative numbers stay numbers; pounds and file names) |
| `arabic-only.test.ts` | passed (CSV and Excel added to the allowed Latin words) |
| API, database | unchanged; not re-run |

Not checked in a browser: the extension's browsers cannot reach `localhost:5173` from this machine. To try it: open
«التقارير», pick a period, press «تصدير CSV» on a table and open the file in Excel.
