# Phase F4 review — the home screen per role (2026-10-19)

Scope: SRS REPORT-006. Branch: `v4/phase-f4-home` (on top of F3). No database change.

## What changed

- **API:** `GET /reports/home` is open to every member. Each block is built only when the member's rights cover it,
  and only within their branches (row-level security, the E4 report functions):

  | Block | Who sees it | Content |
  | --- | --- | --- |
  | Today's appointments | `appointments:read` | waiting (checked in), with the doctor, still to come, completed, no-shows, total |
  | My day | doctors (write only their own appointments) | the same, for their own appointments |
  | Follow-ups due | `patients:read` | open follow-ups due by today; a doctor's own only |
  | Cash box | `cash:operate` | today's state per branch: not opened, open, closed |
  | Today's collections | `reports:read:daily` (reception) | net collections, payments, refunds, per method |
  | Revenue and expenses | `reports:read` (owner, accountant) | today and the month: invoiced, net collections, expenses, no-shows (with rate); outstanding and overdue now |

  A doctor login not linked to a doctor record gets a note instead of an empty day.
- **Dashboard:** the overview became the home screen:
  - the welcome line shows the member's role;
  - the role's blocks appear, each with a link to its screen, and refresh every minute;
  - the setup checklist and its progress art show only to the owner, and only until setup is complete;
  - the website link shows only to those who manage the website;
  - the old tiles (branch count, plan, role) are gone.

## Rules applied (please confirm or change)

1. **"My day"** means the member writes only their own appointments, the same rule as the appointments screen. An
   assistant sees the whole day.
2. **Follow-ups** go to everyone who reads patients. A doctor sees only the follow-ups assigned to them.
3. **No-shows** are shown for the month, with the rate from E4. A no-show rate for "today" would mislead while the
   day is still running, so the table shows «—» there.
4. **The figures equal the reports:** today's collections equal the daily revenue report; the month equals the
   month-so-far report; outstanding equals the outstanding report. The e2e tests check all three.

## Tests (run 2026-10-19)

| Check | Result |
| --- | --- |
| Database tests | 27 files, **431 checks passed** (no database change) |
| API unit and e2e | **30 suites, 296 tests passed**. New:<br>• `homeSections` unit tests for owner, reception, doctor, accountant and assistant;<br>• 4 e2e checks of `/reports/home`: reception, the Maadi-only member, the doctor, owner and accountant. Each block is compared with the matching report |
| Dashboard unit, typecheck, lint | 75 passed; passed |
| Browser | owner on your dev data: welcome with role; today's appointments (none today); follow-ups (none due); cash box with Nasr City and Maadi not opened; revenue and expenses with today and this month. The month (13,100 invoiced, 7,300 net, 200 expenses; 4,800 owed, 1,000 overdue) matches the E4 reports |

## Phase F status

F1–F4 are done. What's left from F, optional and needing your approval: removing the unused English half of the
dashboard dictionary and the internal `lang` parameters (L10N-008). Next is Phase G, the final verification: every
screen at phone and desktop width, a full test run, and the final report.
