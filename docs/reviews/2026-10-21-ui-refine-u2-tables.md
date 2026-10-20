# UI refinement U2: listings as tables, one «⋯» row menu (2026-10-21)

Second stage of the Untitled UI refinement (plan in `2026-10-21-ui-refine-u1-width.md`), brief phases 4–6. It is on
the same branch as U1 (`v4/ui-refine-u1`), as its own commit; the user pushes once all stages are done.

## What changed

### One row menu: `ui/row-menu.tsx` (new)

- **The control:** a «⋯» button (lucide `MoreHorizontal`) at the end of a table row, opening shadcn's `DropdownMenu`.
- **What a screen passes:** a list of actions. Each one is either a page to open (a real link: open-in-new-tab works)
  or something to do (the screen opens its own dialog).
- **Hidden actions:** an action a member may not use is `hidden`, just as the button was hidden before; the API
  remains the real gate.
- **Destructive actions:** voids, deletes and revokes come last, after a separator, in red. The screen always confirms
  them with the existing `AlertDialog`.
- **Placement:** the menu opens in its own layer, so the table frame never clips it.
- **Keyboard and screen readers:** it works from the keyboard (Radix), and each button is named «الإجراءات: <the row>».
- **No fragile focus:** it is non-modal, so a dialog opened from it never leaves the page stuck.
- **Focus style:** the site-wide focus ring is no longer drawn around pop-up panels and their items. The items already
  show focus with a highlighted background.

### Lists that became tables (were cards or loose rows)

| Page | Columns | Row menu |
| --- | --- | --- |
| Branches | branch (name, slug), status, working days | working hours, rooms, edit |
| Doctors (search added) | doctor (photo, title), specialties, branches, schedule, website status | schedule (when the doctor has a branch, as before), time off, edit |
| Consent texts | text, status, version, reviewed by, times signed | review / edit |
| Team: invitations | email (invited by), role (expired), branches, expires | resend, revoke (confirmed) |
| Roles (active and archived) | role (permissions), members (invitations), badges | edit or view, copy as new, delete (confirmed) |
| Holidays | occasion, date, branch | remove (now confirmed) |
| Doctor time off | period, reason | remove (now confirmed) |

- **Row click:** it opens the record's edit page where the member may edit it (branches, doctors, consent texts,
  roles), as the menu's first link does.
- **Feedback:** each page's actions now share one mutation and one confirmation. Their errors and success notices show
  above the table, not squeezed into a row.

### Tables that already existed: buttons moved into the menu

| Page | Row menu |
| --- | --- |
| Patients | patient file, book (hidden for blocked patients or without booking rights), edit |
| Invoices | open, print (not drafts, as on the invoice page), patient file |
| Overdue installments | open the invoice, patient file |
| Team members, services | edit |
| Expenses | void (opens the existing reason dialog) |
| Follow-ups | log a call, dismiss (confirmed). «حجز موعد» stays a visible button, because booking is what this page is for |

- **Patients on a phone:** the table now fits; it used to scroll sideways to reach «حجز موعد».

### Kept as they are, on purpose

- **Gallery:** visual, so it stays cards.
- **Appointments day view:** a workflow with check-in and visit buttons.
- **Branch rooms:** a short list with an on/off switch per room.
- **Approval queues and dashboards:** pending discounts and pending expenses (with approve/reject in sight), report
  tables (totals and CSV), and overview cards.
- **Patient file:** its sub-lists.

### Behaviour change, deliberate

- **Removing a holiday or a doctor's time off now asks first.** It used to delete on one click. The brief asks for
  every destructive action to be confirmed, and removing one reopens the day or the doctor for booking.

Nothing else changed in behaviour: the same API calls, the same permissions, and no money calculation touched. Unused
card styles (`.branch-*`, `.doctor`) were removed.

## Verified (2026-10-21)

| Check | Result |
| --- | --- |
| Typecheck, lint (repo), dashboard production build | passed |
| Dashboard unit tests | 26 files, **118 passed** |
| Screenshots (1,440 px) | branches with the menu open; doctors; patients with the menu open; team; roles with the menu open (separator, red delete) and the delete confirmation (cancel focused); consent texts; follow-ups; holidays |
| Phone (390 px) | branches, doctors, team, roles, consent texts, holidays, invoices, expenses, follow-ups, services: none scrolls sideways; patients fits |

**Not exercised:** confirming a removal in the browser. That would delete demo data, and the holiday list had no
upcoming rows to try on. The delete, revoke and remove calls themselves are the same calls as before.
