# Phase H5 review — the platform admin panel (2026-10-20)

The owner chose the platform admin panel as the next step (ADM-01, ADM-02, ADM-04), reversing the CLR-14 default that
deferred it. Built on `v4/phase-h5-platform-admin` (from `main` b1672d7). Migration 0031, applied to the dev database.

## Decisions (owner, 2026-10-20)

1. **Suspending a clinic blocks sign-in:** its staff cannot sign in or use the API (from their very next request), and
   its website goes offline. Nothing is deleted; reactivating gives the clinic back the status it had. (Not the
   read-only variant of BIL-05.)
2. **Platform admins sign in with a password and then a 6-digit code emailed to them**, every time. The session is a
   one-hour token in an httpOnly, SameSite=Strict cookie scoped to `/platform` — never readable by JavaScript and never
   accepted by a clinic route (nor a clinic token by a platform route).

Not offered by a screen on purpose: **who is a platform admin**. That is set from the command line by someone with
database access — `pnpm --filter @dental/db platform:admin <email>` (and `--revoke`). The dev seed has
`admin@demo.test` (password `Demo@12345`; the code arrives in Mailpit).

## What changed

- **Database (0031):** every cross-clinic read and every platform write is a database function that first checks the
  caller is an active platform admin and then writes the platform audit log: clinics overview (counts only — members,
  branches, patients, appointments in the last 30 days, last sign-in, owner email; never patient records), extend a
  trial (after now, within a year, trialing clinics only), suspend (with a reason) / reactivate, change plan, notes,
  edit a plan (limits and features merge). The rule from 0004 stands: the API's database user writes no platform table
  itself. The per-request access check now also reads the clinic's status.
- **API (`modules/platform`):** `POST /platform/auth/login` (password; a clinic user and a wrong password get the same
  answer), `POST /platform/auth/verify` (code → cookie), `POST /platform/auth/logout`; `GET /platform/me`,
  `/platform/clinics`, `/platform/clinics/:id` (with notes and history), `POST …/trial`, `…/suspend`,
  `…/reactivate`, `…/plan`, `…/notes`; `GET /platform/plans`, `PATCH /platform/plans/:id`; `GET /platform/audit`.
  Sign-in is rate-limited like the clinic sign-in. Clinic sign-in and every clinic request refuse a suspended clinic
  with `clinic_suspended`.
- **Dashboard (`#/platform`):** its own sign-in (password, then code), then three tabs: **العيادات** (counts by status,
  search by name/subdomain/owner email, filter by status, table with plan, trial days left, members, patients,
  appointments, last sign-in), a clinic page (figures, extend trial, change plan, suspend with a reason / reactivate,
  notes, action history), **الخطط** (name, monthly and yearly price, trial days, limits — empty = unlimited — features,
  shown on the pricing page or not), **السجل** (everything platform admins did). Arabic throughout.

## Follow-up asked by the owner (same day, same branch)

- **A suspended clinic sends no automatic emails.** The worker cancels (not delays) any queued email of a suspended
  clinic, so a reactivated clinic gets no stale reminders.
- **A trial that ends without activation suspends the clinic automatically.** `expire_trials()` runs in the worker
  every 15 minutes; the clinic shows as «انتهت التجربة» in the panel and its staff are cut off at their next request.
- **«تفعيل الاشتراك» (activate subscription)** on the clinic page, for a clinic that paid (outside the system for now):
  the subscription becomes active for a month or a year from today. Activating, or extending the trial, lifts a
  trial-ended suspension; a manual suspension is lifted only by «إعادة تفعيل». Reactivating a clinic whose trial has
  ended is refused (it would be suspended again within 15 minutes): extend or activate instead.

## Not done in this phase

- "Add credits" (ADM-02): later, by the owner's choice (no SMS yet, D-01).
- Impersonating a clinic user (ADM-03), platform metrics (ADM-05), support tickets (ADM-06): deferred as before.
- Payment gateway, grace period, renewal at the end of a paid period, past-due handling (BIL-03/04/05): an active
  subscription stays active until the admin changes it.
- The email cancellation runs in the worker and is not covered by an automated test (the API tests do not run the
  worker; running the email job on the shared test database would send other suites' queued reminders).

## Tests (run 2026-10-20)

| Check | Result |
| --- | --- |
| `typecheck`, `lint` (API, dashboard), dashboard build | passed |
| Database tests (`pnpm db:test`) | **495 checks passed** (31 in `29_platform_admin.sql`: only admins call the functions; counts; suspension cuts off the owner's token and the website; reactivation restores; trial range; plan change; audit rows; notes and plans only through the functions; an ended trial suspends once, reactivation is then refused, extending or activating lifts it, activation for a year, only the worker runs the trial job) |
| Migration 0031 down and up again on the test database | passed |
| API unit + e2e on the fresh test database | 33 suites, **321 tests passed** (new `platform.e2e-spec.ts`, 8 cases: two-step sign-in with the emailed code and the cookie's flags; tokens of one kind never open the other's routes; the clinics list; suspension cutting off a signed-in owner, refusing sign-in and taking the site offline, then reactivation; trial, plan, notes and history; plan edits merging limits and refusing unknown keys; activation for a month, refused twice, no trial extension once active) |
| Dashboard unit | 20 files, **90 passed** (new `platform-model.test.ts`: routes, trial days left, search and status filter) |

Not checked in a browser: the extension's browsers cannot reach `localhost:5173`. To try it: open
`http://localhost:5173/#/platform`, sign in as `admin@demo.test` / `Demo@12345`, take the code from Mailpit
(`http://localhost:8025`).
