# Phase 3 — Online booking, booking code, reception check-in

Scope: the `scheduling` module in the API (SRS 4.5, 4.10, 4.11, BOOK-01…11), the website booking wizard, the
outbox relay in the worker (email only), and the dashboard's Appointments screen. Weeks 1–4 of the SRS plan were
already in place; this is week 5 ("Scheduling") of the MVP plan in SRS 8.8.

## Architecture

The module follows the hexagonal layout the SRS reserves for scheduling and billing (8.2, 8.11):

| Layer | Files | Notes |
|---|---|---|
| `domain/` | `intervals.ts`, `availability.ts`, `clinic-time.ts`, `appointment-status.ts`, `booking-policy.ts` | Pure TypeScript, no Nest, no Kysely. `computeSlots` is the slot engine (BOOK-02); the status table mirrors the `appointments_transition` trigger; clinic time converts wall-clock ↔ instants per branch zone with Intl only. 14 unit cases in `domain/__tests__`. |
| `application/` | `ports.ts`, `get-booking-options`, `get-availability`, `hold-slot`, `book-online`, `manage-appointments` | One use case per flow step. `TenantScope` abstracts "which clinic and which transaction" so the same use case serves the website (hostname) and the dashboard (session). Ports: `SchedulingRepository`, `HoldDetailsStore`, `Clock`, `BookingCodes`. |
| `infrastructure/` | `kysely-scheduling.repository.ts`, `adapters.ts` | Kysely queries under RLS; Redis for the visitor's details while a slot is held; HMAC booking codes keyed per clinic; system clock. |
| `http/` | `public-booking.controller.ts`, `appointments.controller.ts`, `schemas.ts`, `scopes.ts` | Zod at the edge, per-IP throttles on the public endpoints, permission checks that need the row (doctor "own") delegated to the use case. |

Patterns used (SRS 8.3): Repository + Unit of Work (`Session`/`TenantScope`), pure availability function, explicit
state machine, ports + adapters, transactional outbox (`appointment.created`), idempotent notifications
(`dedupe_key`), DB constraints as the final guard (`appointments_no_doctor_overlap` → 409 `slot_taken`).

## Booking sequence (as built)

1. `GET /public/booking/options` — branches, bookable services, doctors accepting online booking, the clinic's rules.
2. `GET /public/booking/slots` — slots for a day, one doctor or "any"; computed from branch hours ∩ doctor shifts,
   minus appointments, live holds and time off; holidays close the day; minimum notice and max days ahead applied.
3. `POST /public/booking/holds` — `release_expired_holds(doctor)` then a `held` appointment for 10 minutes. The
   slot must be in today's availability; a race is settled by the exclusion constraint.
4. `POST /public/booking/holds/:id/details` — name, phone, **email**, notes kept in Redis for the life of the hold;
   a 6-digit code is **emailed** (OTP purpose `booking`, 3 per 10 minutes per address). Clinics with
   `booking_otp_required = false` are booked at once.
5. `POST /public/booking/holds/:id/confirm` — the code is consumed in the same transaction that books: patient
   matched by phone + name or created (`referral_source = website`, tag `needs_review`), status `pending` or
   `confirmed` (`booking_auto_confirm`), reception code hashed on the row and expiring at the end of the
   appointment day in the branch zone, `appointment.created` written to the outbox. After commit the reception
   code is emailed to the visitor (and shown on screen).
6. Worker: `outbox-relay` (5 s) turns `appointment.created` into `notifications` rows — patient confirmation,
   clinic email (`tenants.email`), reminders at `reminder_offsets_minutes` — all **email**; `send-notifications`
   (30 s) sends what is due with retries and cancels reminders for appointments that are no longer active.

Email is the only channel (decision 2026-10-16). SMS rows are cancelled by the sender; the SMS port stays wired
only for the existing sign-up phone verification.

## Dashboard

- `GET /appointments?date&branchId` (day in the branch zone), `POST /appointments` (staff booking, `confirmed`,
  inside the schedule unless `overrideReason` + `appointments:override`), `POST /appointments/check-in`
  (`check_in_by_code`, single-use, branch-bound), `POST /appointments/:id/{confirm,start,complete,cancel,no-show}`.
- Doctors holding only `appointments:write:own` may start/complete their own visits; everything else needs
  `appointments:write`.
- Screen `screens/appointments.tsx`: day navigation with a shadcn/ui date picker (Popover + Calendar), branch
  filter and check-in branch with shadcn/ui Select, reception check-in with the 6-digit code and the amount due,
  status badges and the allowed actions per status. The day and branch live in the URL.
- shadcn/ui is installed in the dashboard with Tailwind v4 **without preflight** (`src/shadcn.css`): the existing
  stylesheet keeps its base styles, and the shadcn colour variables map to the `@dental/ui` tokens.

## Website

- `/book` wizard (`components/site/booking/wizard.tsx`, the only other client component): service → day/slot →
  details → email code → confirmation with the reception code. `?service=` / `?doctor=` preselect from the home
  page cards. Calls go through a same-origin proxy route (`app/sites/[host]/api/booking/[...path]`), so the API is
  never exposed to the browser and no CORS is needed.
- The public site payload carries `onlineBooking`; when true every "book" CTA points at `/book`, otherwise the
  WhatsApp/phone fallbacks remain.

## Verification

- `apps/api`: typecheck, lint, 14 domain unit tests, `booking.e2e-spec.ts` (9 cases: options, slots, hold,
  cross-clinic isolation, email code, reception code, day list, check-in once, lifecycle and "own" rules, staff
  booking and override). Full suite 79/79 after `pnpm db:test` (the earlier failures were leftover test data).
- `apps/web`: typecheck, lint, 12 unit tests; browser walkthrough of the wizard on clinic-a (slot → details → code
  from Mailpit → confirmed, reception code shown and emailed).
- `apps/dashboard`: typecheck (3 pre-existing errors in the unfinished pages/doctors/services refactor remain),
  lint, 15 unit tests.

## Left for later

- Rooms/chairs are not assigned by the website; reception assigns them later (room exclusion stays enforced).
- "Any doctor" picks the first free doctor; spreading load is a refinement.
- Online payment (BOOK-04 V1): `payment_mode` is `at_clinic` for every website booking for now.
- Patient cancel/reschedule link (BOOK-08, `manage_token_hash`) and the waitlist (BOOK-12) are V1/V2.
- Marking `confirmed → no_show` automatically 2 h after the end time (SRS 4.10) belongs in the worker.
- The dashboard has no "new appointment" form yet; staff bookings exist in the API with a seeded patient id until the
  patients module (week 6) adds search/create.
