# Dashboard redesign — R3: patients and invoices on the DataTable (2026-10-20)

Third stage (plan in `2026-10-20-redesign-r1-shell.md`): the two lists most used at reception moved onto the shared
DataTable built in R2, chosen because they are different. Patients are searched and paged by the API; invoices are
filtered by the API and then searched, sorted and paged in the browser. Built on `v4/redesign-r3-pages` from `main`
0895e62.

## What changed

- **DataTable, for lists the API searches and pages:** an optional controlled search box (the screen fetches; the
  table filters nothing itself), a footer slot ("load more"), and a busy flag while refetching. The R2 browser mode is
  unchanged.
- **Patients (`#/patients`):**
  - **Columns:** patient (avatar initial, name, file number; a link), mobile, age, sex, status (needs review, blocked,
    tags). Age, sex and status are hidden on phones.
  - **Row actions:** the whole row opens the file, and «حجز موعد» is the row action (shown only with
    `appointments:write`).
  - **Behaviour kept:**
    - the same API search over every record (name, mobile or file number), with a 250 ms debounce and the box focused
      on arrival;
    - "load more" on the API's cursor.
  - **No sorting here:** the table would only sort what has been loaded.
- **Invoices (`#/invoices`):**
  - **Columns:** number (a link) with its status badge (with a dot), patient, branch, date, total, amount still owed (in
    red). Branch and date are hidden on phones.
  - **Sorting, search and paging:** sort by number, patient, date, total or amount owed. Search covers number, patient
    name and file number, ignoring how a word was typed (أ/إ/ا, ى/ي, ة/ه, Arabic digits). 20 rows a page.
  - **Count:** next to the title.
  - **Status tabs:** unchanged; they still ask the API, and a new tab starts on page 1 with no search.
  - **Money:** amounts are exactly what the API returns; nothing is added up or recalculated in the browser. "Still
    owed" shows only on issued invoices (not drafts or void ones), as before.
- **Base styles:** shadcn tables no longer leave gaps between cells (Tailwind's reset, which is not loaded, normally
  collapses them).

## Verified (2026-10-20)

| Check | Result |
| --- | --- |
| Typecheck, lint (repo), dashboard production build | passed |
| Dashboard unit tests | 25 files, **115 passed** (the table's logic is covered by `table-model.test.ts`) |
| Screenshots (headless Chrome, desktop 1440 and phone 390) | patients table with search, badges and book buttons; invoices table with status badges, amounts owed, count, tabs; sorting by total (largest first after two clicks); on a phone the table scrolls sideways inside its frame (never the page) with the secondary columns hidden |

The local API restarted twice while screenshots were being taken (its file watcher). That was unrelated to this change:
the dashboard was the only thing edited.

## Next

- **R4:** the other list screens (appointments, staff, expenses, discounts, follow-ups, platform panel) and forms. Also
  the file picker's English browser text, and native selects and checkboxes where a shadcn one helps.
- **R5:** a pass over phones, right-to-left, accessibility and performance.
