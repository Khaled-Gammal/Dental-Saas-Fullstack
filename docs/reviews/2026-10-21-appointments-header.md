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

## The day toolbar (same day, second request)

The user asked to improve the section under the header (a screenshot of the date bar, the branch filter and the tabs).

- **One row** instead of three blocks: the views (كل المواعيد · قائمة الانتظار · مواعيدي) as a compact segmented control
  on the start side; on the end side the day and the branch.
- **A joined date stepper:** previous · date · next as one control, with arrows (the previous day on the right in
  right-to-left, its arrow pointing right) instead of the «السابق» and «التالي» text buttons. Each arrow has an
  accessible name («اليوم السابق», «اليوم التالي»).
- **«اليوم»** is an outline button, disabled when the day shown is already today.
- **The day heading** is smaller, says «اليوم» when it is today, and shows the number of appointments (not for an
  empty day, where the empty message says it, nor on the waiting list, which counts its own).
- On a phone the tabs and the stepper take the full width; the date grows between the arrows.

Checks: lint, typecheck, 123 unit tests, build; screenshots today and on the 17th (two appointments) at 1440 px, and at
390 px.
