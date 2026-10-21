# Review: new-appointment page redesign (2026-10-21)

Scope: `apps/dashboard/src/screens/appointments/new.tsx`, `ui/page.tsx` (optional `aside`), `styles.css` (`.form-page.has-aside`, `.appt-*`).

## What changed (layout only)
- Four numbered steps (patient · branch/doctor/service · day/time · details); a step's number becomes a check once it is filled.
- Patient: search with an icon and «مريض جديد» beside it; results and the chosen patient show initials, file number and mobile; blocked patients are marked «محظور» (still not selectable).
- Doctors of the chosen branch as picture cards (radio group) instead of a dropdown.
- Day: date picker plus «اليوم» / «غدًا»; free times grouped by part of the day (صباحًا / بعد الظهر / مساءً) in the branch's time zone.
- Booking method as a segmented control with icons (2×2 on phones); notes hint «لا يراها المريض».
- «ملخص الموعد» beside the form (sticky; below it under 1100px): patient, branch, doctor, service with price, day, time with length, and what is still missing. Save button reads «حجز الموعد».
- `FormPage` gained an optional `aside` prop; the 14 other form pages are unchanged (no prop → same markup and class).

## Unchanged
- Booking request body, `ready` rules, override permission and reason, plan/recall linking, unsaved-changes guard, slots engine. No API or database change.

## Checks
- Dashboard typecheck, lint, 123 unit tests, production build: pass.
- Screenshots 1440px and 390px: empty, filled with a selected time, override mode (owner).
