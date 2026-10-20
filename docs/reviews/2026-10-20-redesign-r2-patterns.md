# Dashboard redesign — R2: shared patterns (2026-10-20)

Second stage of the redesign (plan in `2026-10-20-redesign-r1-shell.md`): the shared building blocks every page uses,
upgraded **in place** (same props), so all pages change at once; plus the new DataTable for R3. Built on
`v4/redesign-r2-patterns` from `main` 8dba2cd.

## Audit

The pages already share their building blocks: `PageHeader` (25 pages), `Breadcrumbs` (14), `FormPage` (13),
`ConfirmDialog` (19 files, 30 uses), `Badge` (32 files), the `.seg` tab bars (7 files), `EmptyState`, `Skeleton`,
`ResourceState`. So R2 upgrades those rather than adding parallel components. No table component existed (lists are
cards and `.line-list` rows; reports use a plain `.report-table`).

Bug found: `ConfirmDialog` was a native `<dialog>`, which the browser draws in its top layer, so a shadcn Select opened
inside it (the paper-consent dialog, the platform panel's dialogs) showed its options **under** the dialog.

## What changed

- **ConfirmDialog → shadcn/ui AlertDialog**, same props for all 30 uses: focus trapped and returned, Escape cancels,
  focus starts on Cancel, the confirm button never closes it by itself (a missing reason keeps it open), right-to-left
  header. Dropdowns inside it now open above it (checked).
- **Breadcrumbs → shadcn/ui Breadcrumb** (same props): chevrons point left in right-to-left, links in the brand colour on
  hover, the current page in bold.
- **PageHeader**: an optional count chip next to the title (`count`), the actions grouped and wrapping on small
  screens; `FormPage` uses the same header markup.
- **Badges**: a thin tinted border, a new `danger` tone, and `dot` for statuses (a dot before the word; the word still
  says it, colour is never the only cue).
- **Tab bars** (`.seg`, 7 pages): a light track with the chosen tab as a white raised pill, in the shadcn Tabs look; the
  labels are no longer underlined (they are links). Kept as links, not Radix Tabs: they change the page's URL (filters
  you can bookmark), they are not in-page panels.
- **Tables** (`.report-table`: reports, platform panel): a light header row, roomier cells, a row hover.
- **New `DataTable`** (`ui/data-table.tsx`, on shadcn/ui Table) for R3 and on: typed columns, sorting (aria-sort),
  search, paging, loading skeleton, empty and error states, a row-actions column, row click, columns hidden on phones,
  sideways scroll inside its frame (never the page). Its logic is pure (`table-model.ts`): search ignores alef/ya/ta
  marbuta forms, tashkeel and Arabic digits; Arabic dictionary order; empty values last. No new dependency: TanStack
  Table was not installed and these lists are small enough for the browser; a large list should page on the server and
  give the table one page.
- shadcn parts added with the CLI: `alert-dialog`, `table` (the existing button kept). No package added.
- Removed: the native dialog's and the old breadcrumbs' CSS.

## Verified (2026-10-20)

| Check | Result |
| --- | --- |
| Typecheck, lint (repo), dashboard production build | passed |
| Dashboard unit tests | 25 files, **115 passed** (new `table-model.test.ts`: sort cycle, numbers/text/empty ordering, Arabic-aware search, paging bounds) |
| Screenshots (headless Chrome) | invoices tab bar, a form page's breadcrumbs, the paper-consent dialog, and a Select opened inside it showing above the dialog |

## Left for later stages

- **R3:** patients and invoices on the DataTable (proves the abstraction on two different lists).
- **R4:**
  - the remaining modules;
  - the file picker's English browser text ("Choose File") becomes an Arabic upload button;
  - native `<select>` and checkboxes become shadcn ones, where they help.
- **R5:** mobile, RTL, accessibility, performance pass.
