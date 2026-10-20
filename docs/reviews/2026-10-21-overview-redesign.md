# Overview page redesign (2026-10-21)

The brief: rework the dashboard's overview for hierarchy and space, after the Untitled UI reference the user attached,
keeping the identity and every business rule. The screenshot is the Untitled UI demo, not this app, so it served as
the style reference: a compact header, a row of stat cards, a chart card and a table card. Built on
`v4/overview-redesign` from `main` 2ff86ee (PR #20 merged, main CI passed).

## Data audit: where every figure comes from

| Shown | Source (unchanged) | Who gets it |
| --- | --- | --- |
| Today's appointments: booked, waiting, with the doctor, not yet due | `/reports/home` → `appointments` | members who read appointments; a doctor sees their own day |
| Today's net collections, invoiced today | `/reports/home` → `finance.today` (owner, accountant) or `today_money` (reception) | per the API |
| This month's net collections, invoiced this month | `/reports/home` → `finance.month` | owner, accountant |
| Owed by patients, overdue installments | `/reports/home` → `finance.outstanding` | owner, accountant |
| Follow-ups due | `/reports/home` → `follow_ups` | per the API |
| Cash box per branch | `/reports/home` → `cash` | per the API |
| Today's remaining appointments (the table) | `GET /appointments?date=today`, the appointments page's own request and cache | requested only when the API sent the appointments block |
| Discounts and expenses awaiting approval | `GET /discounts/pending`, `GET /expenses/pending`, the existing queues | requested only for `discounts:approve` / `expenses:approve` |

No figure is computed in the browser: the cards and the money table show the API's numbers. The only counting is how
many of today's appointments are `pending` (unconfirmed) and how long each approval queue is.

## What changed

- **Header:** the large welcome banner (with the dental-arch illustration) becomes the shared `PageHeader`:
  - «نظرة عامة»;
  - the greeting, the member's role and «ملخص يومك في العيادة»;
  - the clinic website as compact actions: its address, Copy, «فتح الموقع» (still for `website:write` only).
- **Stat cards:** up to four, one consistent grid (four across on desktop, two on a phone), each opening its page.
  - **Owner and accountant:** today's appointments, today's net collections, this month's net collections, owed by
    patients (overdue in amber).
  - **Reception:** today's appointments, today's net collections, follow-ups.
  - **Doctor:** their day and follow-ups.
- **Today's remaining appointments:** a table (time, patient and mobile, doctor, service, status badge) with a «⋯»
  menu.
  - **Which appointments:** the statuses the appointments page treats as still ahead (checked in, with the doctor,
    awaiting confirmation, confirmed), by time. At most 8, with «و{n} مواعيد أخرى» and «كل المواعيد».
  - **Menu items:** patient file (`patients:read`), open visit (when there is one, clinical read), change
    (`appointments:write`), the same conditions as on the appointments page.
  - **States:** loading, empty and error come from the shared table.
- **«يحتاج انتباهك»:** each item opens its page:
  - patients waiting (the appointments page's waiting view);
  - bookings awaiting confirmation;
  - follow-ups due;
  - overdue installments (the invoices page's overdue tab);
  - discounts and expenses awaiting the member's approval;
  - a branch whose cash box is not opened today.

  An item shows only when its count is above zero and the member's data holds it; otherwise «لا شيء ينتظرك الآن.».
  The selection and order live in `overview-model.ts`, with tests.
- **Revenue and expenses:** the same table as before (invoiced, net collections, expenses, no-shows; today and this
  month) in a card with a link to the reports. Outstanding and overdue are no longer repeated there; they are in the
  stat cards.
- **Setup checklist (owner, until done):** unchanged; it now sits right under the header.
- **Layout:** full width; the table and the to-dos side by side from 1,100 px (two-thirds and one-third), stacked below
  that.
- **Removed:** the banner, the old block styles and the unused `.chip-btn`.
- **Small shared changes:**
  - `PageHeader`'s description accepts formatted text.
  - `useAppointments` and `usePendingDiscounts` take an optional `enabled`, so the overview doesn't ask for what a
    member may not see.

## Requested, not built (no data or backend support)

- **Branch and date-range selectors:** `/reports/home` takes no parameters; it always reports today and this month for
  the member's branches. Selectors would change nothing. This needs an API change.
- **Revenue chart:** no endpoint returns figures over time, only totals per period. A chart would need a new series
  endpoint, or many report requests.
- **New patients:** nothing in the API counts new patients.
- **Comparisons with the last period ("+12% vs last month"):** not in the data, so not invented.
- **Net income (collections minus expenses):** the system has no such definition. Collections and expenses are shown
  side by side as the reports define them, and no new formula was added.

## Verified (2026-10-21)

| Check | Result |
| --- | --- |
| Typecheck, lint (repo), dashboard production build | passed |
| Dashboard unit tests | 27 files, **121 passed** (3 new for the overview's selection) |
| Screenshots | owner, reception, doctor (seed: reception role) and accountant at 1,440 px; owner on a phone (390 px, no sideways scroll) |
| The appointments table with rows | checked by pointing it at the previous day for one screenshot (the demo has no appointments today), with the row menu open; then reverted (`h.today` again) |
