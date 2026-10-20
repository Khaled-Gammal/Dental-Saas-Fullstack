# UI refinement U3: create and edit pages (2026-10-21)

Last stage of the Untitled UI refinement (plan in `2026-10-21-ui-refine-u1-width.md`), brief phases 7–8. It is on the
same branch as U1 and U2 (`v4/ui-refine-u1`), as its own commit; the user pushes once all stages are done.

## Audit: where create and edit happen

| Kind | Screens | Decision |
| --- | --- | --- |
| Already their own page, on the shared `FormPage` | patients, branches (and working hours), doctors (and schedule), services, consent texts, team (invite, edit), roles, gallery photo, appointments (new, move) | kept: breadcrumbs, title, sectioned cards, Save/Cancel footer, unsaved-changes guard |
| A substantial form that opened inside its list | **new expense**: nine fields and a document | **moved to its own page** |
| A create page with its own layout | **new invoice**: full width (since U1), no Cancel | **moved onto `FormPage`** |
| A step inside one record | an invoice line, a treatment-plan item, a visit procedure, a follow-up on a patient's file | kept inline; they belong to the record on screen |
| Short add forms that show their result in place | holidays, branch rooms, doctor time off (which also shows the appointments it affects) | kept inline, as the brief says for simple actions |
| Workflows, not forms | gallery upload, merging patients, signing a consent | kept |

## What changed

- **New expense, `#/expenses/new` (new route):**
  - **Layout:** on `FormPage`, with breadcrumbs (المصروفات › تسجيل مصروف), two sections («المصروف»: branch, item,
    amount, method, reference, date; «المورد والمستند»: supplier, description, document), and the Save/Cancel footer.
  - **Leaving with changes:** an unsaved-changes guard asks before leaving.
  - **After saving:** the member goes back to the list with «سُجّل المصروف.». If the document upload failed, the
    existing notice says the expense was saved without it.
  - **Unchanged:** the save logic. The expense is saved first, then its document, and a failed upload never loses or
    duplicates the expense.
  - **Who may open it:** `expenses:read` + `expenses:write`, the same right that showed the button and that the API
    checks (`access.ts`, `App.tsx`). Reception is refused, as before.
- **New invoice:**
  - **Layout:** on `FormPage`, keeping its breadcrumbs, patient name and «إنشاء مسودة». `FormPage` gained an optional
    `saveLabel`.
  - **New:** a Cancel back to the patient's file, and the form width.
  - **Unchanged:** the fields, the validation and what it creates.

## Verified (2026-10-21)

| Check | Result |
| --- | --- |
| Typecheck, lint (repo), dashboard production build | passed |
| Dashboard unit tests | 26 files, **118 passed** (including the access rules) |
| Screenshots | new expense (desktop and phone), new invoice (desktop and phone), the expenses list after the change, reception refused at `#/expenses/new` |
| Phone (390 px) | no sideways scroll on the new pages |

**Not exercised:** saving an expense in the browser, which would add demo data. The save code is the same code, moved;
only what happens after it changed (back to the list with a notice).

## The refinement, done

| Stage | What it did |
| --- | --- |
| U1 | the 1,120 px cap removed; settings pages get a 960 px column; overview in three columns; shared page headers |
| U2 | one «⋯» row menu; seven lists become tables; existing tables move their row buttons into it; destructive actions confirmed |
| U3 | the new expense gets its own page; the new invoice moves onto the shared form layout |

Throughout, the clinic's colours, sidebar, fonts and Arabic right-to-left layout are kept. Business logic, API calls,
permissions, tenant isolation and every money calculation are unchanged.
