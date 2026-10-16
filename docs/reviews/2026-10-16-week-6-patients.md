# Week 6 (part 1) — Patients, audit trail, staff booking; Phase 3 review fixes

Scope: SRS DSH-03 (patients), NFR-03 / DSH-15 (access to patient records audited), BOOK-11 (patient matching
moved to its owner), SRS 4.10 (automatic no-show), the dashboard "new appointment" form, and the ten findings of the
code review of the Phase 3 booking slice.

## Code review of Phase 3 — findings and outcome

| # | Severity | Finding | Outcome |
|---|---|---|---|
| 1 | High | `/book` fetched options from the Next server's IP against a 60/min per-IP throttle: the 61st visitor in a minute got a 500. | Options are no longer throttled (read-only, like `/public/site`) and the website caches them 60 s under the site's tag. |
| 2 | High | The booking proxy passed the browser's own `X-Forwarded-For`, so per-IP throttles could be spoofed. | `lib/client-ip.ts` takes only the right-most entry (written by the edge proxy) and sends a single value; unit-tested. Without an edge proxy (local dev) every visitor shares one bucket — documented. |
| 3 | Medium | The `appointment.created` email promised a reception code and a "website booking" notice for staff bookings too. | Wording follows `source` and whether a code exists; the clinic notice is sent for website bookings only. Message building is a pure function with 5 unit tests. |
| 4 | Medium | An invalid time zone in the data threw inside the worker; after 10 retries the event was silently dropped. | `safeTimeZone` in the worker; time helpers moved to `shared/time/clinic-time.ts` (shared kernel). |
| 5 | Medium | `HoldSlot` skipped `safeTimeZone` → 500 on a bad zone. | Fixed. |
| 6 | Medium | The booking email showed the time in Cairo time, not the branch's. | `BookingSummary.timezone` carries the branch zone; the email and the website use it. |
| 7 | Medium | The wizard rendered slots in the clinic zone while the API computed them in the branch zone. | The wizard uses the zone the server returned with the slots. |
| 8 | Low | The email OTP failure log printed the full address. | Masked with `maskEmail`. |
| 9 | Low | Dead outbox events vanished without a trace. | Logged at `error` when they die and counted on every pass (`outbox_dead`). |
| 10 | Low | `screens/pages.tsx`, `screens/doctors.tsx`, `screens/services.tsx` are not imported anywhere. | **Not changed**: they hold uncommitted work-in-progress. They are also the source of the 3 remaining dashboard type errors; delete them or finish the refactor. |

Also found while verifying in the browser: shadcn/ui's theme redefined `--muted` and `--ring`, which are design
tokens (secondary text colour, focus box-shadow). Every grey caption in the dashboard became near-invisible and
focus rings disappeared. Fixed in `src/shadcn.css` (the Tailwind colours point at the tokens instead), and a unit
test now fails if `shadcn.css` ever redefines a token name.

## Patients module (API, standard module per SRS 8.11)

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /patients?q=&cursor=&limit=` | `patients:read` | One box: a full mobile in any spelling (`010…`, `+20…`, Arabic digits) is an exact match; the start of a number is a prefix match on a new `(tenant_id, phone text_pattern_ops)` index; a short bare number is a file number; anything else is a trigram-ranked name search. Without `q`: newest first, keyset cursor. |
| `POST /patients` | `patients:write` | File number from `next_tenant_counter`; plan limit `patients` enforced under the plan lock; marketing consent time recorded (PDPL). |
| `GET /patients/:id` | `patients:read` | Profile, guardian (name resolved when the guardian is a patient), last 50 appointments. `medicalHistory` only with `clinical:read`/`clinical:write`, otherwise `null` (hidden, not empty). |
| `PATCH /patients/:id` | `patients:write` | Only sent fields; `needsReview: false` clears the website-booking review tag. |
| `PUT /patients/:id/medical-history` | `clinical:write` | Lists cleaned (trimmed, unique case-insensitively). |
| `GET /patients/:id/activity` | `audit:read` (owner) | Who opened or changed the record. |

`AuditLog` (`shared/audit`) writes in the caller's transaction: `patient.create`, `patient.update` with
`{"field": [old, new]}`, `patient.medical_history.update` with field names only (`true`, never values), and
`patient.view` at most once per person per record per 10 minutes. Actor, IP and user agent come from the request
context (set by `JwtAuthGuard`).

`PatientDirectory` is the module's public API: scheduling now calls `matchOrCreateForBooking` (BOOK-11) and
`assertBookable` instead of reading or writing `patients` itself (SRS 8.2: a module touches only its own tables).

## Scheduling additions

- `GET /appointments/availability` — free times for one doctor and day, staff rules (no website notice/horizon).
- `mark_no_shows()` (migration `20261022000008`) — `pending`/`confirmed`, never checked in, ended > 2 h ago →
  `no_show`; worker job every 5 minutes; only `app_worker` may run it. Reminders for such appointments are
  cancelled by the sender, as before.

## Dashboard

- `#/patients` list with one search box and "load more"; `#/patients/new`, `#/patients/:id/edit`, `#/patients/:id/view`.
- Form: gender, preferred branch and guardian relation use shadcn **Select** (`components/choice.tsx`); date of
  birth uses the shadcn **Calendar** with month/year dropdowns (`components/date-picker.tsx`). Under 18 opens the
  guardian section; same-mobile records are listed while typing to avoid duplicates. Pure logic in
  `patient-model.ts` with unit tests.
- Profile: allergy alert at the top, contact details, guardian link, review banner, medical history card (view/edit
  by permission), visit timeline, access log (owners).
- `#/appointments/new?patient=…`: patient search or preset (allergies shown), branch/doctor/service Selects,
  Calendar day, live free slots; with `appointments:override` a time outside the schedule plus a reason.
- `screens/appointments.tsx` moved to `screens/appointments/list.tsx` next to `new.tsx`.

## Verification

| Check | Result |
|---|---|
| Database tests | 118 checks, 9 files (7 new: no-show sweep, permissions, phone index) |
| API (unit + e2e) | 110 tests, 9 suites (new: `patients.e2e-spec.ts` 13, patient rules 12, notification wording 5) |
| Dashboard | typecheck clean except the 3 pre-existing errors above; lint clean; 28 tests |
| Web | typecheck, lint, 15 tests |
| Browser (Chrome, RTL) | patients list; new patient with shadcn Select + Calendar year dropdown; profile with allergy alert; medical history edit; access log; booking from the profile with Select + Calendar + slots, landing on the day view |

## Left for later

- Arabic name normalisation in search (أ/إ/ا, ة/ه, ى/ي) needs a normalised column; trigram similarity covers most typos today.
- Merging duplicate patients (DSH-03 "merge") and patient files/attachments (needs storage).
- Visits, prescriptions and consent signing (rest of week 6).
- The dashboard copy of `zonedToUtc` mirrors `apps/api/src/shared/time/clinic-time.ts`; move both to a shared package once the API can consume TypeScript workspace packages.

## Second code review (after part 1) — findings and outcome

| # | Severity | Finding | Outcome |
|---|---|---|---|
| 1 | High | Staff bookings have no code and there was no other way to check in, so the new no-show sweep would have marked every phone/walk-in booking `no_show`. | `POST /appointments/:id/arrive`: manual check-in. A staff booking needs nothing extra; a website booking that still has a code needs a reason ("ID checked, phone lost"), as the schema requires. Dashboard: "Arrived" action, with a reason dialog only for code holders. |
| 2 | High | A blocked patient booking online got a fresh, unblocked duplicate record. | Matching now includes blocked records; a blocked match is refused with a neutral `booking_refused`. Blocking itself was not possible through the API: `isBlocked` added to the patient update and a switch on the edit form. |
| 3 | Medium | Confirmations went to the email on file, not the one the visitor had just verified. | The verified email replaces the one on file for a matched patient; audited with `actor_type = patient`, `via: website_booking`. |
| 4 | Medium | Codes on cancelled/no-show/expired appointments stayed in the unique index forever; collisions would grow into failed bookings. | Migration `20261023000009`: a trigger clears the code when an appointment reaches cancelled/no_show/expired (used codes are kept as history), plus a one-time cleanup. New codes are checked before use (up to 5 tries). 5 new database checks. |
| 5 | Medium | Online bookings created patients past the plan's patient limit. | Same `PlanLimits` check as the desk; over the limit the visitor gets the neutral refusal. |
| 6 | Medium | The API trusted forwarded addresses from loopback only, so separate web/API containers would share one throttle bucket. | `TRUST_PROXY` setting (`loopback` default; subnet list, hop count or true/false). |
| 7 | Medium | Cached booking options carried yesterday's date after midnight; the date list used the clinic zone, not the branch's. | The wizard computes "today" in the selected branch's zone on the visitor's clock (after hydration) and never offers an earlier day. |
| 8 | Medium | The worker sent email inside the transaction holding the row lock; a failed commit re-sent it and a slow mail server pinned a connection. The worker also lacked the dev email adapter. | Claim (short transaction: attempts + 1, 10-minute lease, SKIP LOCKED) → send with nothing held → mark sent. At-least-once by design. Dev adapter in the worker outside production. |
| 9 | Medium | Back from the details step kept the old hold; every re-pick held another slot. | `POST /public/booking/holds/:id/release` (idempotent, throttled). The wizard releases on Back and on picking another time (awaited, so the reloaded times already show the freed slot — a fire-and-forget first version raced the reload, caught in the browser), and on leaving the page (`sendBeacon`). |
| 10 | Low | Duplicated helpers: user-agent clipping and the `*` permission rule. | `shared/request-meta.ts` (`clipUserAgent`) and `auth/permissions.ts` (`hasPermission`), used by the guard and the use cases. |

Also: the audit context (IP, user agent) is now recorded for public requests too, so booking-time patient changes
carry the visitor's address. The booking and patient e2e suites switch per-IP throttles off like the identity suite
(all test traffic comes from 127.0.0.1).

Verification after these fixes: database 123 checks; API 119 tests in 10 suites (new: release, verified email,
blocked refusal, manual check-in, PatientDirectory unit tests); dashboard 29 tests; web 17 tests; lint clean.
