# Dashboard redesign — R4a: the remaining lists on the DataTable (2026-10-20)

Fourth stage (plan in `2026-10-20-redesign-r1-shell.md`). R4 is split in two: **R4a (this stage) moves the remaining
list screens onto the shared DataTable**, and R4b will cover forms and inputs (the file picker, selects, checkboxes).
Built on `v4/redesign-r4-lists` from `main` 76b4492.

## What changed

Every screen keeps its filters, permissions, dialogs and API calls. Only the way rows are shown changed. The tabs and
date ranges that ask the API stay above the table. The table searches, sorts and pages what came back, and a new tab
or range starts on page 1 with no search.

- **Platform panel, clinics (`#/platform`):**
  - **Columns:** clinic (a link, with its slug), status (deletion date when one is pending), plan, trial days left,
    members, patients, appointments in 30 days, last sign-in.
  - **Search, filter and rows:** search covers slug, Arabic and English names, and the owner's email. The status filter
    moves into the table's toolbar. The whole row opens the clinic. 25 rows a page, with a count next to the title.
- **Platform panel, leads:**
  - **Columns:** received, person (kind, clinic, city, message), contact, plan, status.
  - **Kept as they were:**
    - the panel's own search, which matches phone numbers written either way;
    - the status filter;
    - the inline status change.
- **Expenses (`#/expenses`):**
  - **Columns:** date, item (with its status, who recorded, approved or voided it, and the document), branch, payment
    method and reference, amount (struck through when void).
  - **Voiding:** «إلغاء المصروف» is the row action, shown only to those with `expenses:write`, as before.
  - **Unchanged:** the pending-approval card and the per-item totals card.
- **Overdue installments (the invoices page's «أقساط متأخرة» tab):**
  - **Columns:** patient, mobile, invoice number, installment, due date, amount left.
  - **Rows:** oldest first. The row opens the invoice.
- **Team (`#/staff`):**
  - **Columns:** member (initial, name, email, «أنت»), job and doctor, branches, role (with «موقوف» when disabled).
  - **Row actions:** «تعديل» as a button, and the row opens the edit page. Invitations stay a list.
- **Follow-ups (`#/followups`):**
  - **Columns:** patient (a link), mobile (tap to call), reason, due date with its status («متأخرة» in red when
    overdue), doctor (call attempts and notes under it).
  - **Row actions:** «حجز موعد», «تسجيل مكالمة» and «إلغاء المتابعة», with the same permissions and dialogs.
  - **Sorting:** soonest first in the open tabs, latest first in «مغلقة».
  - **Patient file:** keeps its compact cards. The cards and the table share one actions component.
- **Services and prices (`#/services`):**
  - **Columns:** service, duration, status (inactive, hidden from the website, or on the website), price.
  - **Order:** the clinic's own (as on the website) until a header is clicked.
  - **Unchanged:** the catalogue card above the table.
- **Daily cash, previous days (`#/cash`):**
  - **Columns:** day (with "reopened N times"), closed by and note, expected, counted, difference.
  - **Rows:** latest first.

### A fix found on the way

Since R1, a link styled as a primary button showed teal text on a teal fill. The cause was the link colour rule
(`a:not([data-slot])`), which outranked `.btn-primary`. That was four places: «حجز موعد» on follow-ups, the patient
file and the visit page, and «نموذج جديد» on consents.

The rule is now `a:where(:not([data-slot]))`, as weak as a plain `a`, as it was before R1.

### Money

No amount is calculated differently:

- Every figure shown is the one the API returns.
- The two browser-side expressions are untouched:
  - the amount left on an installment is still `amount_minor - paid_minor`, now named `installmentLeft`;
  - the expenses per-item total is still computed as before.
- The cash history shows the expected, counted and difference values stored when the day was closed.
- Sorting only orders rows; it changes no value.

## Verified (2026-10-20)

| Check | Result |
| --- | --- |
| Typecheck, lint (repo), dashboard production build | passed |
| Dashboard unit tests | 25 files, **115 passed** |
| Diff audit | every changed line that touches an amount reviewed. Only display moved, no formula changed |
| Screenshots (headless Chrome, desktop 1440 and phone 390, both demo clinics) | follow-ups (upcoming and closed, with the three row buttons), services, expenses (with void, struck amount, pending card), team, cash with previous days, overdue installments, empty states. Phone: follow-ups and expenses |

**Not checked by screenshot:** the platform panel (clinics, leads). Its sign-in needs a password plus an emailed code,
which the screenshot script cannot do. Both typecheck, and they reuse the panel's existing filters.

## Known and left as they are

- **API row caps:** the API returns at most 100 invoices and 200 expenses per request, with no "load more". The table
  pages what arrives, so a clinic over those numbers will not see the older rows in that tab or range. This is
  unchanged from before the redesign. It needs an API change (a cursor), so it is out of scope here.
- **Follow-ups on a phone:** the table scrolls sideways inside its frame to reach the three buttons. Left for R5, the
  phone pass.

## Next

- **R4b:** forms and inputs. An Arabic file picker in place of the browser's English "Choose File", and shadcn selects
  and checkboxes where they help.
- **R5:** a pass over phones, right-to-left, accessibility and performance.
