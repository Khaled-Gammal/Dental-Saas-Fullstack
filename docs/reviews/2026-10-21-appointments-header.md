# Appointments page: check-in in a dialog, «موعد جديد» in the header (2026-10-21)

The user sent a screenshot of `#/appointments` and asked for the check-in card to move into a dialog, to clean up the
page. Looking at the screenshot also showed that the page had no way to start a new appointment.

## What changed

- **«تسجيل الحضور» is a header button** that opens a dialog (shadcn Dialog, added with the CLI; its close button and
  header text use logical sides for right-to-left). The dialog holds the same form: the six-digit code, the branch when
  the clinic has more than one, and the button. A successful check-in shows its result in the dialog and clears the
  code, so reception can check in the next patient without reopening it. Closing it clears the code and the result.
  The button shows for `appointments:write`, as the card did, and not on «مواعيدي».
- **«موعد جديد» in the header and in the empty day's message.** It opens the new-appointment page on the day and
  branch being viewed. Before, an appointment could only be started from a patient's file, a follow-up, a plan or a
  visit. The form accepts `?date=` and ignores a day that has passed (it starts on today).
- **The sidebar's scrollbar is slim** (`scrollbar-width: thin`) instead of the system one with arrows, which showed when
  the open groups were taller than the screen.

## Checks

Lint, typecheck, the 123 unit tests. Screenshots: the page at 1440 px and 390 px, the open dialog, and the form opened
from «موعد جديد» on the 22nd (prefilled).
