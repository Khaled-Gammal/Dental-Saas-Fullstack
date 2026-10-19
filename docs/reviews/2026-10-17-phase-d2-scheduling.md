# Phase D2 review — scheduling: moves, waiting list, my day, holidays, time off, rooms, booking rules (2026-10-17)

Scope: SRS APPT-001, APPT-003, APPT-004, APPT-005, APPT-006, APPT-009 (`docs/roadmap.md`, Phase D2). APPT-007
(follow-up booking from a visit) moved to D4, because it needs visits. Decision applied: CLR-10 default (doctors read
the whole schedule; "mine" is a filter, not a restriction). Branch: `v4/phase-d2-scheduling` (on top of D1).

## What changed

| Requirement | Change | Where |
| --- | --- | --- |
| APPT-001 | `POST /appointments/:id/move` moves a pending/confirmed booking to another time, doctor or branch, keeping its length (or a new one), under the same rules as a staff booking: on the schedule grid, or with a reason and `appointments:override`. The doctor must be active and work at the branch. The booking's own old time counts as free (`doctor_busy_intervals(…, p_exclude)`). A double booking still fails in the database. If a website booking moves to **another day**, its unused reception code is replaced and the new one emailed, so the old one stops working. The worker cancels the old reminders, queues new ones for the new time, and emails "your appointment moved" | scheduling `ManageAppointments.move`, repository, `worker/appointment-notifications.ts`; dashboard `#/appointments/<id>/edit` |
| APPT-006 | Rooms per branch (add, rename, deactivate, never delete). The same move endpoint sets or clears the chair, also after check-in. A chair of another branch or an inactive one is refused; two bookings in one chair at once fail (`room_taken`) | clinic-setup `calendar/*`; `#/branches/<id>/rooms`; the day list shows the chair |
| APPT-003 | Waiting list view: checked-in patients in arrival order with minutes waited (highlighted from 20 min), "call in" (= start), and who is with the doctor. It refreshes with the day list (30 s) | `calendar-model.ts` `waitingList`, appointments list |
| APPT-004 | `GET /appointments?mine=true` returns the signed-in doctor's own appointments (empty for non-doctors). The dashboard opens doctors on "مواعيدي"; "كل المواعيد" stays available | scheduling, appointments list |
| APPT-005 | Holidays (whole clinic or one branch, one per date and scope) and doctor time off (up to a year), add/list/delete. Each add answers with the open bookings it falls on; **nothing is cancelled automatically**, and the list links to "change" for each. Holiday changes purge the website cache (opening hours) | `/holidays`, `/doctors/:id/time-off`; `#/holidays`, `#/doctors/<id>/timeoff` |
| APPT-009 | Booking rules: auto-confirm, email verification code, minimum notice, horizon, slot step, reminder times (up to four, from fixed choices). Reads by every member; writes `settings:write`. The cancel window is not shown (it waits for BOOK-08). Online payment stays off | `/clinic/booking-settings`; `#/booking` |
| — | Audit: moves, room changes, holidays, time off, rooms and settings are audited by the existing triggers (0013/0017) | — |
| — | CI also runs on pushes to `v4/**` branches | `.github/workflows/ci.yml` |

Entry points: the Branches page has "الإجازات" and "قواعد الحجز" buttons and a "الكراسي" link per branch; each doctor
has "الإجازات".

## Migration and its risks

`20261028000018_scheduling_setup` — **Low**. The holiday unique index is preceded by a duplicate check that stops the
migration with a message instead of deleting rows. The new CHECKs are added `NOT VALID` then validated; existing
settings and time off satisfy them. `doctor_busy_intervals` is dropped and re-created with the optional fourth
argument. Its only caller is the API, deployed together, and the 3-argument call still works through the default.
Applied to the test and dev databases; types regenerated (2 new columns).

## Tests (run 2026-10-17)

| Suite | Result |
| --- | --- |
| `pnpm build`, `pnpm typecheck`, `pnpm lint` | passed |
| Database tests | **248 checks passed** (new `18_scheduling_setup.sql`: 15 checks: one holiday per scope/date, member FK, time-off length, reminder limits, a move does not block itself, chair branch and double booking) |
| API e2e + unit | **16 suites, 182 tests passed** (new `calendar.e2e-spec.ts`, 10 cases: move same day, shift onto own time, taken time even with override, refusals, website booking moved to another day with a new emailed code and the old one dead, rooms, holiday and time off with conflicts and slots, booking rules with limits and website effect, "mine" per role; 3 new worker unit tests for the reschedule messages) |
| Dashboard unit | **51 passed** (new `calendar-model.test.ts`, router tests for the new pages) |
| Website unit | 20 passed |

**Not done: the browser check.** Same limit as in D1: the connected Chrome could not open `localhost:5173`.

## Notes and follow-ups

- The move screen keeps the branch (doctors of the same branch). The API also accepts a branch change, for a later
  screen.
- Conflict times in the holiday/time-off notices are shown in Cairo time (the dashboard has no branch time zone yet).
- The dashboard copy is still bilingual until Phase F; new strings exist in Arabic and English.
- Reminder offsets that were set outside the fixed choices (e.g. by API) still show and can be removed.
